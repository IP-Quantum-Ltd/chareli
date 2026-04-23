import base64
import json
import logging
from pathlib import Path
from typing import Any, Dict, List

from langsmith import traceable

from app.services.base import BaseAIClient, BaseService
from app.services.browser_agent import capture_external_page, search_for_urls

logger = logging.getLogger(__name__)


class VisualLibrarian(BaseService, BaseAIClient):
    """
    Stage 0: Visual Librarian.
    Flow:
    Search (Image + Name) -> Browse -> Screenshot & Metadata -> Correlate -> Score
    """

    def _write_combined_research_findings(
        self,
        proposal_id: str,
        game_title: str,
        search_query: str,
        candidates: List[Dict[str, Any]],
        failures: List[Dict[str, Any]],
        best_match: Dict[str, Any] | None = None,
    ) -> str:
        findings_path = Path(__file__).resolve().parents[2] / f"research_findings_{proposal_id}.json"
        report = {
            "game_title": game_title,
            "proposal_id": proposal_id,
            "search_query": search_query,
            "total_cost_usd": getattr(self, "last_cost", 0.0),
            "best_match_url": (best_match or {}).get("url", ""),
            "visual_confidence": (best_match or {}).get("confidence_score", ""),
            "all_candidates": [
                {
                    "url": candidate.get("url", ""),
                    "confidence_score": candidate.get("confidence_score", 0),
                    "reasoning": candidate.get("reasoning", ""),
                    "extracted_facts": candidate.get("extracted_facts", {}),
                    "screenshot_path": candidate.get("screenshot_path", ""),
                    "metadata_path": candidate.get("metadata_path", ""),
                }
                for candidate in candidates
            ],
            "failures": failures,
        }
        findings_path.write_text(json.dumps(report, indent=4), encoding="utf-8")
        return str(findings_path)

    @traceable(run_type="chain", name="Visual Librarian Investigation")
    async def verify_and_research(
        self,
        proposal_id: str,
        game_title: str,
        internal_screenshots: List[str],
    ) -> Dict[str, Any]:
        proposal_dir = Path(__file__).resolve().parents[2] / "stage0_artifacts" / proposal_id
        external_dir = proposal_dir / "external"
        external_dir.mkdir(parents=True, exist_ok=True)

        if len(internal_screenshots) < 2:
            return {"status": "failed", "reason": "Stage 0 requires two internal reference screenshots."}

        search_plan = await self._build_image_weighted_search_query(game_title, internal_screenshots[0])
        search_query = self._compose_search_query(game_title, search_plan)
        search_step = await search_for_urls(
            search_query=search_query,
            output_dir=str(proposal_dir / "search"),
            count=5,
        )
        raw_candidates = search_step.get("candidates") or []
        if not raw_candidates:
            return {
                "status": "failed",
                "reason": "Image + name Playwright search returned 0 visible candidates.",
                "search_query": search_query,
            }

        search_results = [
            candidate["url"]
            for candidate in raw_candidates[:10]
            if isinstance(candidate, dict) and isinstance(candidate.get("url"), str) and candidate.get("url")
        ]
        if len(search_results) < 5:
            return {
                "status": "failed",
                "reason": f"Playwright search returned only {len(search_results)} usable URLs; Stage 0 requires 5.",
                "search_query": search_query,
                "raw_candidates": raw_candidates,
            }

        candidates: List[Dict[str, Any]] = []
        failures: List[Dict[str, Any]] = []
        comparison_scores_path = proposal_dir / "comparison_scores.json"

        for index, url in enumerate(search_results, start=1):
            screenshot_path = external_dir / f"candidate_{index:02d}_render.png"
            capture_result = await capture_external_page(url, str(screenshot_path))

            if not capture_result:
                failures.append({"rank": index, "url": url, "reason": "No playable render could be captured."})
                continue

            with open(capture_result["screenshot_path"], "rb") as handle:
                external_base64 = base64.b64encode(handle.read()).decode("utf-8")

            correlation = await self._calculate_correlation(
                title=game_title,
                internal_imgs=internal_screenshots,
                external_img=external_base64,
                url=url,
                metadata=capture_result["metadata"],
            )
            scoring = self._score_candidate(correlation)

            candidate = {
                "rank": index,
                "url": url,
                "search_query": search_query,
                "screenshot_path": capture_result["screenshot_path"],
                "metadata_path": capture_result["metadata_path"],
                "metadata": capture_result["metadata"],
                "correlation": correlation,
                "scoring": scoring,
                "confidence_score": scoring["confidence_score"],
                "reasoning": correlation.get("reasoning", "Unknown"),
                "extracted_facts": correlation.get("facts", {}),
            }
            candidates.append(candidate)
            if len(candidates) == 5:
                break

        score_report = {
            "proposal_id": proposal_id,
            "game_title": game_title,
            "search_query": search_query,
            "candidate_count": len(candidates),
            "candidates": [
                {
                    "rank": candidate["rank"],
                    "url": candidate["url"],
                    "screenshot_path": candidate["screenshot_path"],
                    "metadata_path": candidate["metadata_path"],
                    "confidence_score": candidate["confidence_score"],
                    "correlation": candidate["correlation"],
                    "scoring": candidate["scoring"],
                }
                for candidate in candidates
            ],
            "failures": failures,
        }
        comparison_scores_path.write_text(json.dumps(score_report, indent=2), encoding="utf-8")

        manifest_path = proposal_dir / "stage0_manifest.json"
        manifest_path.write_text(
            json.dumps(
                {
                    "proposal_id": proposal_id,
                    "game_title": game_title,
                    "search_query": search_query,
                    "search_plan": search_plan,
                    "search_engine": search_step.get("engine", ""),
                    "search_engines": search_step.get("engines", []),
                    "raw_candidates": raw_candidates,
                    "search_results": search_results,
                    "candidate_count": len(candidates),
                    "failures": failures,
                    "comparison_scores_path": str(comparison_scores_path),
                },
                indent=2,
            ),
            encoding="utf-8",
        )

        if len(candidates) != 5:
            findings_path = self._write_combined_research_findings(
                proposal_id=proposal_id,
                game_title=game_title,
                search_query=search_query,
                candidates=candidates,
                failures=failures,
            )
            return {
                "status": "failed",
                "reason": (
                    f"Stage 0 captured {len(candidates)} playable external renders after trying "
                    f"{len(search_results)} ranked search results; 5 are required."
                ),
                "search_query": search_query,
                "failures": failures,
                "all_candidates": candidates,
                "comparison_scores_path": str(comparison_scores_path),
                "research_findings_path": findings_path,
            }

        best_match = max(candidates, key=lambda item: item["confidence_score"])
        best_match["deep_research_results"] = {}
        if best_match["confidence_score"] > 80:
            deep_info = await self._extract_deep_content(best_match["url"])
            if deep_info and isinstance(deep_info, dict):
                best_match["deep_research_results"] = deep_info
                best_match["extracted_facts"].update(deep_info)

        findings_path = self._write_combined_research_findings(
            proposal_id=proposal_id,
            game_title=game_title,
            search_query=search_query,
            candidates=candidates,
            failures=failures,
            best_match=best_match,
        )

        return {
            "status": "success",
            "search_query": search_query,
            "search_plan": search_plan,
            "search_engine": search_step.get("engine", ""),
            "search_engines": search_step.get("engines", []),
            "raw_candidates": raw_candidates,
            "best_match": best_match,
            "all_candidates": candidates,
            "failures": failures,
            "comparison_scores_path": str(comparison_scores_path),
            "research_findings_path": findings_path,
        }

    def _compose_search_query(self, title: str, search_plan: Dict[str, Any]) -> str:
        visual_cues = search_plan.get("visual_cues") or []
        search_terms = search_plan.get("search_terms") or []

        normalized_parts: List[str] = [f"\"{title}\""]
        seen = {title.strip().lower()}
        strongest_visual_hint = ""

        for part in [*search_terms, *visual_cues]:
            if not isinstance(part, str):
                continue
            cleaned = " ".join(part.strip().split())
            if not cleaned:
                continue
            lowered = cleaned.lower()
            if lowered in seen:
                continue
            seen.add(lowered)
            strongest_visual_hint = cleaned
            break

        if strongest_visual_hint:
            normalized_parts.append(
                f"\"{strongest_visual_hint}\"" if " " in strongest_visual_hint else strongest_visual_hint
            )

        normalized_parts.extend(["browser game", "play online"])
        return " ".join(normalized_parts)

    async def _build_image_weighted_search_query(self, title: str, thumbnail_base64: str) -> Dict[str, Any]:
        prompt = f"""
        You are preparing image-driven search terms for a browser game.
        Game title: {title}

        Look at the thumbnail image and identify the strongest visual cues that would help
        distinguish this exact game from other similarly named games.

        Return ONLY valid JSON:
        {{
            "visual_cues": ["cue1", "cue2", "cue3"],
            "search_terms": ["term1", "term2", "term3"]
        }}
        """

        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{thumbnail_base64}"}},
                ],
            }
        ]

        return await self.chat_completion(
            messages=messages,
            response_format={"type": "json_object"},
            fallback_data={
                "visual_cues": [],
                "search_terms": [],
            },
            metadata={"stage": "search_query_generation"},
        )

    async def _calculate_correlation(
        self,
        title: str,
        internal_imgs: List[str],
        external_img: str,
        url: str,
        metadata: Dict[str, Any],
    ) -> Dict[str, Any]:
        prompt = f"""
        Task: Triple-Image Correlation for Stage 0 verification.

        Determine whether these three images represent the same game:
        1. Internal Image A = official ArcadeBox thumbnail/icon
        2. Internal Image B = official ArcadeBox gameplay render/start state
        3. External Image = rendered gameplay captured from {url}

        External page metadata:
        {json.dumps(metadata, indent=2)}

        Return ONLY valid JSON:
        {{
            "visual_similarity_score": int,
            "mechanic_match_score": int,
            "text_relevance_score": int,
            "brand_alignment_score": int,
            "reasoning": "detailed comparison of all three images and metadata",
            "facts": {{
                "controls": "string",
                "rules": "string",
                "original_developer": "string"
            }}
        }}
        """

        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{internal_imgs[0]}"}},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{internal_imgs[1]}"}},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{external_img}"}},
                ],
            }
        ]

        return await self.chat_completion(
            messages=messages,
            response_format={"type": "json_object"},
            fallback_data={
                "visual_similarity_score": 0,
                "mechanic_match_score": 0,
                "text_relevance_score": 0,
                "brand_alignment_score": 0,
                "reasoning": "Correlation check failed.",
                "facts": {},
            },
            metadata={"stage": "triple_image_correlation", "source_url": url},
        )

    def _score_candidate(self, correlation: Dict[str, Any]) -> Dict[str, Any]:
        weights = {
            "visual_similarity_score": 0.45,
            "mechanic_match_score": 0.20,
            "text_relevance_score": 0.20,
            "brand_alignment_score": 0.15,
        }
        weighted_total = 0.0
        breakdown: Dict[str, Any] = {}

        for key, weight in weights.items():
            raw_score = int(correlation.get(key, 0) or 0)
            weighted_total += raw_score * weight
            breakdown[key] = {
                "raw_score": raw_score,
                "weight": weight,
                "weighted_score": round(raw_score * weight, 2),
            }

        return {
            "weights": weights,
            "breakdown": breakdown,
            "confidence_score": round(weighted_total),
        }

    async def _extract_deep_content(self, url: str) -> Dict[str, Any]:
        manual_path = Path(__file__).resolve().parents[2] / "stage0_artifacts" / "deep_research_capture.png"
        capture_result = await capture_external_page(url, str(manual_path))
        if not capture_result:
            return {}

        with open(capture_result["screenshot_path"], "rb") as handle:
            screenshot_base64 = base64.b64encode(handle.read()).decode("utf-8")

        prompt = f"""
        Analyze this gameplay-render screenshot from {url}.
        Extract EXACT details for:
        - How to Play / Instructions
        - Key Game Controls (Keyboard, Mouse, Touch)
        - Unique Features or Modes

        Return a JSON object with these fields.
        """

        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{screenshot_base64}"}},
                ],
            }
        ]

        return await self.chat_completion(
            messages=messages,
            response_format={"type": "json_object"},
            fallback_data={},
            metadata={"stage": "deep_research", "source_url": url},
        )
