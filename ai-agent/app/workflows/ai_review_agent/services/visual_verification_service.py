import asyncio
import logging
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from langsmith import get_current_run_tree, traceable

from app.domain.dto import CandidateCapture, Stage0Investigation
from app.domain.schemas.llm_outputs import (
    CorrelationOutput,
    DeepContentOutput,
    ExactGameIdentityOutput,
    SearchPlanOutput,
)
from app.infrastructure.browser.external_capture import ExternalCaptureService
from app.infrastructure.llm.ai_executor import AIExecutor
from app.infrastructure.storage.artifact_store import ArtifactStore
from app.workflows.ai_review_agent.services.visual_correlation_service import VisualCorrelationService
from app.workflows.ai_review_agent.services.visual_search_service import VisualSearchService

logger = logging.getLogger(__name__)


class VisualVerificationService:
    def __init__(
        self,
        ai: AIExecutor,
        search_service: VisualSearchService,
        correlation_service: VisualCorrelationService,
        external_capture_service: ExternalCaptureService,
        artifact_store: ArtifactStore,
        min_candidates: int = 3,
        required_candidates: int = 5,
        max_search_results: int = 5,
        candidate_capture_timeout_seconds: int = 30,
        medium_confidence_threshold: int = 75,
        high_confidence_threshold: int = 90,
    ):
        self.ai = ai
        self.search_service = search_service
        self.correlation_service = correlation_service
        self.external_capture_service = external_capture_service
        self.artifact_store = artifact_store
        self.min_candidates = max(1, min(min_candidates, required_candidates))
        self.required_candidates = max(1, required_candidates)
        self.max_search_results = max(self.required_candidates, max_search_results)
        self.candidate_capture_timeout_seconds = max(5, candidate_capture_timeout_seconds)
        self.medium_confidence_threshold = max(0, min(medium_confidence_threshold, 100))
        self.high_confidence_threshold = max(self.medium_confidence_threshold, min(high_confidence_threshold, 100))
        self.last_cost = 0.0

    def _determine_confidence_tier(self, confidence_score: int) -> str:
        if confidence_score >= self.high_confidence_threshold:
            return "high"
        if confidence_score >= self.medium_confidence_threshold:
            return "medium"
        return "low"

    def _has_confident_consensus(self, candidates: List[CandidateCapture]) -> bool:
        if len(candidates) < self.min_candidates:
            return False
        confident = [c for c in candidates if int(c.confidence_score or 0) >= self.medium_confidence_threshold]
        if len(confident) < self.min_candidates:
            return False
        top_two = sorted(confident, key=lambda c: int(c.confidence_score or 0), reverse=True)[:2]
        if len(top_two) < 2:
            return False
        return abs(int(top_two[0].confidence_score or 0) - int(top_two[1].confidence_score or 0)) <= 10

    def _image_prompt_parts(self, image_urls: List[str]) -> List[Dict[str, Any]]:
        return [
            {"type": "image_url", "image_url": {"url": url}}
            for url in image_urls
            if url
        ]

    async def _attach_artifacts_to_trace(self, s3_refs: Optional[Dict[str, str]] = None) -> None:
        """Record S3 artifact keys as metadata on the active LangSmith run."""
        run_tree = get_current_run_tree()
        if run_tree is None or not s3_refs:
            return
        metadata = dict(getattr(run_tree, "metadata", {}) or {})
        s3_artifact_refs = dict(metadata.get("stage0_s3_refs", {}) or {})
        s3_artifact_refs.update(s3_refs)
        run_tree.metadata.update({"stage0_s3_refs": s3_artifact_refs})
        try:
            run_tree.patch()
        except Exception as exc:
            logger.warning("Failed to patch LangSmith run metadata: %s", exc)

    @traceable(run_type="chain", name="Visual Librarian Investigation")
    async def verify_and_research(
        self, proposal_id: str, game_title: str, internal_screenshots: List[str]
    ) -> Dict[str, Any]:
        logger.info(
            "Research start | proposal=%s game=%s internal_images=%s",
            proposal_id, game_title, len(internal_screenshots),
        )
        self.last_cost = 0.0

        if len(internal_screenshots) < 1:
            return Stage0Investigation(
                status="failed",
                reason="Stage 0 requires at least one internal reference screenshot.",
            ).to_dict()

        search_plan = await self._build_image_weighted_search_query(game_title, internal_screenshots[0])
        exact_identity = await self._infer_exact_game_identity(game_title, internal_screenshots)
        search_query = self._compose_search_query(game_title, search_plan, exact_identity)
        logger.info("Research search | proposal=%s query=%s", proposal_id, search_query)

        search_step = await self.search_service.search_candidates(
            game_title,
            internal_screenshots,
            search_query,
            exact_identity,
            count=self.max_search_results,
        )
        raw_candidates = search_step.get("candidates") or []
        if not raw_candidates:
            return Stage0Investigation(
                status="failed",
                reason="Image + name OpenAI web search returned 0 usable candidates.",
                search_query=search_query,
            ).to_dict()

        search_results = [
            c["url"]
            for c in raw_candidates[: self.max_search_results]
            if isinstance(c, dict) and isinstance(c.get("url"), str) and c.get("url")
        ]
        if len(search_results) < self.min_candidates:
            return Stage0Investigation(
                status="failed",
                reason=(
                    f"OpenAI web search returned only {len(search_results)} usable URLs; "
                    f"Stage 0 requires at least {self.min_candidates}."
                ),
                search_query=search_query,
                raw_candidates=raw_candidates,
            ).to_dict()

        candidates: List[CandidateCapture] = []
        failures: List[Dict[str, Any]] = []

        for index, url in enumerate(search_results, start=1):
            logger.info("Research candidate start | proposal=%s rank=%s url=%s", proposal_id, index, url)
            try:
                capture_result = await asyncio.wait_for(
                    self.external_capture_service.capture_external_page(url, proposal_id, index),
                    timeout=self.candidate_capture_timeout_seconds,
                )
            except asyncio.TimeoutError:
                failures.append({"rank": index, "url": url, "reason": "External page capture timed out."})
                logger.warning("Research candidate timeout | proposal=%s rank=%s url=%s", proposal_id, index, url)
                continue

            if not capture_result:
                failures.append({"rank": index, "url": url, "reason": "No playable render could be captured."})
                logger.info("Research candidate skipped | proposal=%s rank=%s url=%s", proposal_id, index, url)
                continue

            correlation = await self._calculate_correlation(
                game_title, internal_screenshots, capture_result["screenshot_url"], url, capture_result["metadata"]
            )
            seo_intelligence = self.correlation_service.build_candidate_seo_intelligence(
                game_title, search_query, capture_result["metadata"]
            )
            scoring = self.correlation_service.score_candidate(correlation, seo_intelligence)

            candidates.append(
                CandidateCapture(
                    rank=index,
                    url=url,
                    search_query=search_query,
                    screenshot_path=capture_result["screenshot_path"],
                    metadata_path=capture_result["metadata_path"],
                    metadata=capture_result["metadata"],
                    correlation=correlation,
                    seo_intelligence=seo_intelligence,
                    scoring=scoring,
                    confidence_score=scoring["confidence_score"],
                    reasoning=correlation.get("reasoning", "Unknown"),
                    extracted_facts=correlation.get("facts", {}),
                    comparison_triplet={
                        "reference_thumbnail": internal_screenshots[0] if internal_screenshots else "",
                        "internal_gameplay": internal_screenshots[1] if len(internal_screenshots) > 1 else "",
                        "external_render_path": capture_result["screenshot_path"],
                        "external_metadata_path": capture_result["metadata_path"],
                    },
                )
            )
            logger.info(
                "Research candidate scored | proposal=%s rank=%s url=%s confidence=%s",
                proposal_id, index, url, scoring["confidence_score"],
            )

            if len(candidates) >= self.required_candidates:
                break
            if self._has_confident_consensus(candidates):
                break

        comparison_scores_key = await self.artifact_store.write_comparison_scores(
            proposal_id, game_title, search_query, candidates, failures
        )

        manifest_key = await self.artifact_store.write_manifest(
            proposal_id,
            {
                "proposal_id": proposal_id,
                "game_title": game_title,
                "search_query": search_query,
                "search_plan": search_plan,
                "exact_identity": exact_identity,
                "search_engine": search_step.get("engine", ""),
                "search_model": search_step.get("model", ""),
                "raw_candidates": raw_candidates,
                "web_search_sources": search_step.get("sources", []),
                "search_results": search_results,
                "candidate_count": len(candidates),
                "failures": failures,
                "comparison_scores_key": comparison_scores_key,
            },
        )

        await self._attach_artifacts_to_trace(
            s3_refs={
                "comparison_scores": comparison_scores_key,
                "manifest": manifest_key,
            },
        )

        if len(candidates) < self.min_candidates:
            findings_key = await self.artifact_store.write_research_findings(
                proposal_id, game_title, search_query, candidates, failures, self.last_cost
            )
            return Stage0Investigation(
                status="failed",
                reason=(
                    f"Stage 0 captured {len(candidates)} playable external renders after trying "
                    f"{len(search_results)} ranked search results; at least {self.min_candidates} are required."
                ),
                search_query=search_query,
                failures=failures,
                all_candidates=candidates,
                comparison_scores_path=comparison_scores_key,
                research_findings_path=findings_key,
            ).to_dict()

        best_match = max(candidates, key=lambda c: c.confidence_score)
        confidence_tier = self._determine_confidence_tier(int(best_match.confidence_score or 0))
        warnings: List[str] = []
        if len(candidates) < self.required_candidates:
            warnings.append(
                f"Stage 0 reached confident consensus with {len(candidates)} candidates; ideal target is {self.required_candidates}."
            )
        if confidence_tier == "medium":
            warnings.append("Visual verification confidence is moderate; downstream stages should remain conservative.")
        if confidence_tier == "low":
            warnings.append("Visual verification confidence is low; downstream output should be treated as provisional.")

        if best_match.confidence_score >= self.medium_confidence_threshold:
            deep_info = await self._extract_deep_content(best_match.url)
            if isinstance(deep_info, dict):
                best_match.deep_research_results = deep_info
                best_match.extracted_facts.update(deep_info)

        findings_key = await self.artifact_store.write_research_findings(
            proposal_id, game_title, search_query, candidates, failures, self.last_cost, best_match.to_dict()
        )
        await self._attach_artifacts_to_trace(s3_refs={"research_findings": findings_key})

        logger.info(
            "Research success | proposal=%s candidates=%s best=%s",
            proposal_id, len(candidates), best_match.url,
        )
        return Stage0Investigation(
            status="success",
            confidence_tier=confidence_tier,
            search_query=search_query,
            search_plan=search_plan,
            exact_identity=exact_identity,
            search_engine=search_step.get("engine", ""),
            search_model=search_step.get("model", ""),
            raw_candidates=raw_candidates,
            best_match=best_match,
            all_candidates=candidates,
            failures=failures,
            comparison_scores_path=comparison_scores_key,
            research_findings_path=findings_key,
            warnings=warnings,
        ).to_dict()

    def _compose_search_query(self, title: str, search_plan: Dict[str, Any], exact_identity: Dict[str, Any]) -> str:
        visual_cues = search_plan.get("visual_cues") or []
        search_terms = search_plan.get("search_terms") or []
        exact_title = str(exact_identity.get("exact_game_name") or "").strip()
        aliases = [a for a in (exact_identity.get("aliases") or []) if isinstance(a, str)]
        normalized_parts: List[str] = [f"\"{title}\""]
        seen = {title.strip().lower()}

        def add(value: str) -> None:
            cleaned = " ".join(value.strip().split())
            lowered = cleaned.lower()
            if cleaned and lowered not in seen:
                normalized_parts.append(f"\"{cleaned}\"" if " " in cleaned else cleaned)
                seen.add(lowered)

        if exact_title:
            add(exact_title)
        for alias in aliases[:1]:
            add(alias)
        for part in [*search_terms, *visual_cues]:
            if isinstance(part, str):
                add(part)
                break
        normalized_parts.extend(["browser game", "play online"])
        return " ".join(normalized_parts)

    async def _build_image_weighted_search_query(self, title: str, thumbnail_url: str) -> Dict[str, Any]:
        result = await self.ai.chat_completion(
            messages=[{"role": "user", "content": [
                {"type": "text", "text": f"You are planning a web search query for the exact browser game '{title}'. Return ONLY valid JSON: {{\"search_terms\": [\"term 1\"], \"visual_cues\": [\"cue 1\"], \"reasoning\": \"short explanation\"}}"},
                {"type": "image_url", "image_url": {"url": thumbnail_url}},
            ]}],
            response_format={"type": "json_object"},
            pydantic_schema=SearchPlanOutput,
            fallback_data={"search_terms": [title], "visual_cues": [], "reasoning": "Fallback search plan."},
            metadata={"stage": "stage0_search_plan"},
        )
        self.last_cost += self.ai.last_cost
        return result

    async def _infer_exact_game_identity(self, title: str, internal_imgs: List[str]) -> Dict[str, Any]:
        image_parts = self._image_prompt_parts(internal_imgs)
        result = await self.ai.chat_completion(
            messages=[{"role": "user", "content": [
                {"type": "text", "text": f"You are identifying the exact browser game shown in the provided internal reference images. Database title: {title}. Return ONLY valid JSON: {{\"exact_game_name\": \"string\", \"aliases\": [\"alias 1\"], \"distinguishing_features\": [\"feature 1\"], \"avoid_titles\": [\"wrong title 1\"], \"reasoning\": \"short explanation\"}}"},
                *image_parts,
            ]}],
            response_format={"type": "json_object"},
            pydantic_schema=ExactGameIdentityOutput,
            fallback_data={"exact_game_name": title, "aliases": [], "distinguishing_features": [], "avoid_titles": [], "reasoning": "Exact identity inference unavailable."},
            metadata={"stage": "exact_game_identity_inference"},
        )
        self.last_cost += self.ai.last_cost
        return result

    async def _calculate_correlation(
        self, title: str, internal_imgs: List[str], external_img_url: str, url: str, metadata: Dict[str, Any]
    ) -> Dict[str, Any]:
        image_parts = self._image_prompt_parts(internal_imgs)
        result = await self.ai.chat_completion(
            messages=[{"role": "user", "content": [
                {"type": "text", "text": f"Compare the provided internal game reference images against one external page screenshot. Game title: {title}. External URL: {url}. External metadata: {metadata}. Return ONLY valid JSON: {{\"confidence_score\": 0, \"visual_match_score\": 0, \"reasoning\": \"short explanation\", \"facts\": {{\"controls\": \"string\", \"rules\": \"string\", \"objective\": \"string\", \"original_developer\": \"string\"}}}}"},
                *image_parts,
                {"type": "image_url", "image_url": {"url": external_img_url}},
            ]}],
            response_format={"type": "json_object"},
            pydantic_schema=CorrelationOutput,
            fallback_data={"confidence_score": 0, "visual_match_score": 0, "reasoning": f"Correlation unavailable for {urlparse(url).netloc}.", "facts": {}},
            metadata={"stage": "stage0_correlation"},
        )
        self.last_cost += self.ai.last_cost
        return result

    async def _extract_deep_content(self, url: str) -> Dict[str, Any]:
        result = await self.ai.chat_completion(
            messages=[
                {"role": "system", "content": "Respond only with JSON and do not guess unknown facts."},
                {"role": "user", "content": f"Extract only grounded, concise game facts from this URL: {url}. Return ONLY valid JSON: {{\"objective\": \"string\", \"controls\": \"string\", \"rules\": \"string\", \"original_developer\": \"string\"}}"},
            ],
            response_format={"type": "json_object"},
            pydantic_schema=DeepContentOutput,
            fallback_data={},
            metadata={"stage": "stage0_deep_extract"},
        )
        self.last_cost += self.ai.last_cost
        return result
