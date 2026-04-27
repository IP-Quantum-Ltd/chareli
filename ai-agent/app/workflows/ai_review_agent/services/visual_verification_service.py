import asyncio
import base64
import logging
import mimetypes
from pathlib import Path
from typing import Any, Dict, List
from urllib.parse import urlparse

from langsmith import get_current_run_tree, traceable

from app.domain.dto import CandidateCapture, Stage0Investigation
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
        required_candidates: int = 5,
        max_search_results: int = 5,
        candidate_capture_timeout_seconds: int = 30,
    ):
        self.ai = ai
        self.search_service = search_service
        self.correlation_service = correlation_service
        self.external_capture_service = external_capture_service
        self.artifact_store = artifact_store
        self.required_candidates = max(1, required_candidates)
        self.max_search_results = max(self.required_candidates, max_search_results)
        self.candidate_capture_timeout_seconds = max(5, candidate_capture_timeout_seconds)
        self.last_cost = 0.0

    def _image_prompt_parts(self, images_b64: List[str]) -> List[Dict[str, Any]]:
        return [
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_b64}"}}
            for image_b64 in images_b64
            if image_b64
        ]

    async def _attach_artifacts_to_trace(self, artifact_paths: Dict[str, str]) -> None:
        run_tree = get_current_run_tree()
        if run_tree is None:
            return
        attachments = dict(getattr(run_tree, "attachments", {}) or {})
        metadata = dict(getattr(run_tree, "metadata", {}) or {})
        traced_artifacts = dict(metadata.get("stage0_artifacts", {}) or {})
        for name, path_str in artifact_paths.items():
            if not path_str:
                continue
            path = Path(path_str)
            if not path.exists() or not path.is_file():
                continue
            mime_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            try:
                file_bytes = await asyncio.to_thread(path.read_bytes)
                attachments[name] = (mime_type, file_bytes)
                traced_artifacts[name] = str(path)
            except Exception as exc:
                logger.warning("Failed to attach artifact %s (%s): %s", name, path, exc)
        run_tree.attachments = attachments
        run_tree.metadata.update({"stage0_artifacts": traced_artifacts})
        try:
            run_tree.patch()
        except Exception as exc:
            logger.warning("Failed to patch LangSmith run with attachments: %s", exc)

    @traceable(run_type="chain", name="Visual Librarian Investigation")
    async def verify_and_research(self, proposal_id: str, game_title: str, internal_screenshots: List[str]) -> Dict[str, Any]:
        logger.info("Research start | proposal=%s game=%s internal_images=%s", proposal_id, game_title, len(internal_screenshots))
        self.last_cost = 0.0
        proposal_dir, external_dir = await self.artifact_store.ensure_proposal_dirs(proposal_id)
        internal_artifact_candidates = [
            proposal_dir / "internal" / "reference_thumbnail.png",
            proposal_dir / "internal" / "reference_gameplay_start.png",
            proposal_dir / "internal_thumbnail.png",
            proposal_dir / "internal_gameplay.png",
        ]
        if len(internal_screenshots) < 1:
            return Stage0Investigation(status="failed", reason="Stage 0 requires at least one internal reference screenshot.").to_dict()

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
            return Stage0Investigation(status="failed", reason="Image + name OpenAI web search returned 0 usable candidates.", search_query=search_query).to_dict()

        search_results = [
            candidate["url"]
            for candidate in raw_candidates[: self.max_search_results]
            if isinstance(candidate, dict) and isinstance(candidate.get("url"), str) and candidate.get("url")
        ]
        if len(search_results) < self.required_candidates:
            return Stage0Investigation(
                status="failed",
                reason=(
                    f"OpenAI web search returned only {len(search_results)} usable URLs; "
                    f"Stage 0 requires {self.required_candidates}."
                ),
                search_query=search_query,
                raw_candidates=raw_candidates,
            ).to_dict()

        candidates: List[CandidateCapture] = []
        failures: List[Dict[str, Any]] = []
        for index, url in enumerate(search_results, start=1):
            logger.info("Research candidate start | proposal=%s rank=%s url=%s", proposal_id, index, url)
            screenshot_path = external_dir / f"candidate_{index:02d}_render.png"
            try:
                capture_result = await asyncio.wait_for(
                    self.external_capture_service.capture_external_page(url, str(screenshot_path)),
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
            screenshot_bytes = await asyncio.to_thread(Path(capture_result["screenshot_path"]).read_bytes)
            external_base64 = base64.b64encode(screenshot_bytes).decode("utf-8")
            correlation = await self._calculate_correlation(game_title, internal_screenshots, external_base64, url, capture_result["metadata"])
            seo_intelligence = self.correlation_service.build_candidate_seo_intelligence(game_title, search_query, capture_result["metadata"])
            scoring = self.correlation_service.score_candidate(correlation, seo_intelligence)
            candidates.append(CandidateCapture(rank=index, url=url, search_query=search_query, screenshot_path=capture_result["screenshot_path"], metadata_path=capture_result["metadata_path"], metadata=capture_result["metadata"], correlation=correlation, seo_intelligence=seo_intelligence, scoring=scoring, confidence_score=scoring["confidence_score"], reasoning=correlation.get("reasoning", "Unknown"), extracted_facts=correlation.get("facts", {}), comparison_triplet={"reference_thumbnail": "internal_screenshots[0]", "internal_gameplay": "internal_screenshots[1]" if len(internal_screenshots) > 1 else "", "external_render_path": capture_result["screenshot_path"], "external_metadata_path": capture_result["metadata_path"]}))
            logger.info("Research candidate scored | proposal=%s rank=%s url=%s confidence=%s", proposal_id, index, url, scoring["confidence_score"])
            if len(candidates) == self.required_candidates:
                break

        comparison_scores_path = await self.artifact_store.write_comparison_scores(proposal_dir, proposal_id, game_title, search_query, candidates, failures)
        await self._attach_artifacts_to_trace(
            {"comparison_scores_json": comparison_scores_path, **{f"internal_artifact_{index + 1}_{path.name.replace('.', '_')}": str(path) for index, path in enumerate(internal_artifact_candidates) if path.exists()}, **{f"candidate_{candidate.rank:02d}_render_png": candidate.screenshot_path for candidate in candidates}, **{f"candidate_{candidate.rank:02d}_render_json": candidate.metadata_path for candidate in candidates}}
        )
        manifest_path = await self.artifact_store.write_manifest(
            proposal_dir,
            {"proposal_id": proposal_id, "game_title": game_title, "search_query": search_query, "search_plan": search_plan, "exact_identity": exact_identity, "search_engine": search_step.get("engine", ""), "search_model": search_step.get("model", ""), "raw_candidates": raw_candidates, "web_search_sources": search_step.get("sources", []), "search_results": search_results, "candidate_count": len(candidates), "failures": failures, "comparison_scores_path": comparison_scores_path},
        )
        await self._attach_artifacts_to_trace({"stage0_manifest_json": manifest_path})

        if len(candidates) != self.required_candidates:
            findings_path = await self.artifact_store.write_research_findings(proposal_id, game_title, search_query, candidates, failures, self.last_cost)
            return Stage0Investigation(
                status="failed",
                reason=(
                    f"Stage 0 captured {len(candidates)} playable external renders after trying "
                    f"{len(search_results)} ranked search results; {self.required_candidates} are required."
                ),
                search_query=search_query,
                failures=failures,
                all_candidates=candidates,
                comparison_scores_path=comparison_scores_path,
                research_findings_path=findings_path,
            ).to_dict()

        best_match = max(candidates, key=lambda item: item.confidence_score)
        if best_match.confidence_score > 80:
            deep_info = await self._extract_deep_content(best_match.url)
            if isinstance(deep_info, dict):
                best_match.deep_research_results = deep_info
                best_match.extracted_facts.update(deep_info)

        findings_path = await self.artifact_store.write_research_findings(proposal_id, game_title, search_query, candidates, failures, self.last_cost, best_match.to_dict())
        await self._attach_artifacts_to_trace({"research_findings_json": findings_path})
        logger.info("Research success | proposal=%s candidates=%s best=%s", proposal_id, len(candidates), best_match.url)
        return Stage0Investigation(status="success", search_query=search_query, search_plan=search_plan, exact_identity=exact_identity, search_engine=search_step.get("engine", ""), search_model=search_step.get("model", ""), raw_candidates=raw_candidates, best_match=best_match, all_candidates=candidates, failures=failures, comparison_scores_path=comparison_scores_path, research_findings_path=findings_path).to_dict()

    def _compose_search_query(self, title: str, search_plan: Dict[str, Any], exact_identity: Dict[str, Any]) -> str:
        visual_cues = search_plan.get("visual_cues") or []
        search_terms = search_plan.get("search_terms") or []
        exact_title = str(exact_identity.get("exact_game_name") or "").strip()
        aliases = [item for item in (exact_identity.get("aliases") or []) if isinstance(item, str)]
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

    async def _build_image_weighted_search_query(self, title: str, thumbnail_b64: str) -> Dict[str, Any]:
        result = await self.ai.chat_completion(
            messages=[{"role": "user", "content": [{"type": "text", "text": f"You are planning a web search query for the exact browser game '{title}'. Return ONLY valid JSON: {{\"search_terms\": [\"term 1\"], \"visual_cues\": [\"cue 1\"], \"reasoning\": \"short explanation\"}}"}, {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{thumbnail_b64}"}}]}],
            response_format={"type": "json_object"},
            fallback_data={"search_terms": [title], "visual_cues": [], "reasoning": "Fallback search plan."},
            metadata={"stage": "stage0_search_plan"},
        )
        self.last_cost += self.ai.last_cost
        return result

    async def _infer_exact_game_identity(self, title: str, internal_imgs: List[str]) -> Dict[str, Any]:
        image_parts = self._image_prompt_parts(internal_imgs)
        result = await self.ai.chat_completion(
            messages=[{"role": "user", "content": [{"type": "text", "text": f"You are identifying the exact browser game shown in the provided internal reference images. Database title: {title}. Return ONLY valid JSON: {{\"exact_game_name\": \"string\", \"aliases\": [\"alias 1\"], \"distinguishing_features\": [\"feature 1\"], \"avoid_titles\": [\"wrong title 1\"], \"reasoning\": \"short explanation\"}}"}, *image_parts]}],
            response_format={"type": "json_object"},
            fallback_data={"exact_game_name": title, "aliases": [], "distinguishing_features": [], "avoid_titles": [], "reasoning": "Exact identity inference unavailable."},
            metadata={"stage": "exact_game_identity_inference"},
        )
        self.last_cost += self.ai.last_cost
        return result

    async def _calculate_correlation(self, title: str, internal_imgs: List[str], external_img: str, url: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
        image_parts = self._image_prompt_parts(internal_imgs)
        result = await self.ai.chat_completion(
            messages=[{"role": "user", "content": [{"type": "text", "text": f"Compare the provided internal game reference images against one external page screenshot. Game title: {title}. External URL: {url}. External metadata: {metadata}. Return ONLY valid JSON: {{\"confidence_score\": 0, \"visual_match_score\": 0, \"reasoning\": \"short explanation\", \"facts\": {{\"controls\": \"string\", \"rules\": \"string\", \"objective\": \"string\", \"original_developer\": \"string\"}}}}"}, *image_parts, {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{external_img}"}}]}],
            response_format={"type": "json_object"},
            fallback_data={"confidence_score": 0, "visual_match_score": 0, "reasoning": f"Correlation unavailable for {urlparse(url).netloc}.", "facts": {}},
            metadata={"stage": "stage0_correlation"},
        )
        self.last_cost += self.ai.last_cost
        return result

    async def _extract_deep_content(self, url: str) -> Dict[str, Any]:
        result = await self.ai.chat_completion(
            messages=[{"role": "system", "content": "Respond only with JSON and do not guess unknown facts."}, {"role": "user", "content": f"Extract only grounded, concise game facts from this URL: {url}. Return ONLY valid JSON: {{\"objective\": \"string\", \"controls\": \"string\", \"rules\": \"string\", \"original_developer\": \"string\"}}"}],
            response_format={"type": "json_object"},
            fallback_data={},
            metadata={"stage": "stage0_deep_extract"},
        )
        self.last_cost += self.ai.last_cost
        return result
