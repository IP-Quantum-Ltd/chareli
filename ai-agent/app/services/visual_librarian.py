import base64
import json
import logging
import os
import mimetypes
from pathlib import Path
from typing import Any, Dict, List
import re

from langsmith import get_current_run_tree, traceable
from openai import AsyncOpenAI

from app.config import settings
from app.services.base import BaseAIClient, BaseService
from app.services.browser_agent import capture_external_page

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
                    "seo_intelligence": candidate.get("seo_intelligence", {}),
                    "scoring": candidate.get("scoring", {}),
                    "comparison_triplet": candidate.get("comparison_triplet", {}),
                }
                for candidate in candidates
            ],
            "failures": failures,
        }
        findings_path.write_text(json.dumps(report, indent=4), encoding="utf-8")
        return str(findings_path)

    def _attach_artifacts_to_trace(self, artifact_paths: Dict[str, str]) -> None:
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
                attachments[name] = (mime_type, path.read_bytes())
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
    async def verify_and_research(
        self,
        proposal_id: str,
        game_title: str,
        internal_screenshots: List[str],
    ) -> Dict[str, Any]:
        proposal_dir = Path(__file__).resolve().parents[2] / "stage0_artifacts" / proposal_id
        external_dir = proposal_dir / "external"
        external_dir.mkdir(parents=True, exist_ok=True)
        internal_artifact_candidates = [
            proposal_dir / "internal" / "reference_thumbnail.png",
            proposal_dir / "internal" / "reference_gameplay_start.png",
            proposal_dir / "internal_thumbnail.png",
            proposal_dir / "internal_gameplay.png",
        ]

        if len(internal_screenshots) < 2:
            return {"status": "failed", "reason": "Stage 0 requires two internal reference screenshots."}

        search_plan = await self._build_image_weighted_search_query(game_title, internal_screenshots[0])
        exact_identity = await self._infer_exact_game_identity(game_title, internal_screenshots)
        search_query = self._compose_search_query(game_title, search_plan, exact_identity)
        search_step = await self._search_with_openai_web_search(
            title=game_title,
            internal_images=internal_screenshots,
            search_query=search_query,
            exact_identity=exact_identity,
            count=10,
        )
        raw_candidates = search_step.get("candidates") or []
        if not raw_candidates:
            return {
                "status": "failed",
                "reason": "Image + name OpenAI web search returned 0 usable candidates.",
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
                "reason": f"OpenAI web search returned only {len(search_results)} usable URLs; Stage 0 requires 5.",
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
            seo_intelligence = self._build_candidate_seo_intelligence(
                game_title=game_title,
                search_query=search_query,
                metadata=capture_result["metadata"],
            )
            scoring = self._score_candidate(correlation, seo_intelligence)

            candidate = {
                "rank": index,
                "url": url,
                "search_query": search_query,
                "screenshot_path": capture_result["screenshot_path"],
                "metadata_path": capture_result["metadata_path"],
                "metadata": capture_result["metadata"],
                "correlation": correlation,
                "seo_intelligence": seo_intelligence,
                "scoring": scoring,
                "confidence_score": scoring["confidence_score"],
                "reasoning": correlation.get("reasoning", "Unknown"),
                "extracted_facts": correlation.get("facts", {}),
                "comparison_triplet": {
                    "reference_thumbnail": "internal_screenshots[0]",
                    "internal_gameplay": "internal_screenshots[1]",
                    "external_render_path": capture_result["screenshot_path"],
                    "external_metadata_path": capture_result["metadata_path"],
                },
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
                    "seo_intelligence": candidate["seo_intelligence"],
                    "scoring": candidate["scoring"],
                    "comparison_triplet": candidate["comparison_triplet"],
                }
                for candidate in candidates
            ],
            "failures": failures,
        }
        comparison_scores_path.write_text(json.dumps(score_report, indent=2), encoding="utf-8")
        self._attach_artifacts_to_trace(
            {
                "comparison_scores_json": str(comparison_scores_path),
                **{
                    f"internal_artifact_{index+1}_{path.name.replace('.', '_')}": str(path)
                    for index, path in enumerate(internal_artifact_candidates)
                    if path.exists()
                },
                **{
                    f"candidate_{candidate['rank']:02d}_render_png": candidate["screenshot_path"]
                    for candidate in candidates
                },
                **{
                    f"candidate_{candidate['rank']:02d}_render_json": candidate["metadata_path"]
                    for candidate in candidates
                },
            }
        )

        manifest_path = proposal_dir / "stage0_manifest.json"
        manifest_path.write_text(
            json.dumps(
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
                    "comparison_scores_path": str(comparison_scores_path),
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        self._attach_artifacts_to_trace({"stage0_manifest_json": str(manifest_path)})

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
        self._attach_artifacts_to_trace({"research_findings_json": findings_path})

        return {
            "status": "success",
            "search_query": search_query,
            "search_plan": search_plan,
            "exact_identity": exact_identity,
            "search_engine": search_step.get("engine", ""),
            "search_model": search_step.get("model", ""),
            "raw_candidates": raw_candidates,
            "best_match": best_match,
            "all_candidates": candidates,
            "failures": failures,
            "comparison_scores_path": str(comparison_scores_path),
            "research_findings_path": findings_path,
        }

    def _compose_search_query(self, title: str, search_plan: Dict[str, Any], exact_identity: Dict[str, Any]) -> str:
        visual_cues = search_plan.get("visual_cues") or []
        search_terms = search_plan.get("search_terms") or []
        exact_title = str(exact_identity.get("exact_game_name") or "").strip()
        aliases = [item for item in (exact_identity.get("aliases") or []) if isinstance(item, str)]

        normalized_parts: List[str] = [f"\"{title}\""]
        seen = {title.strip().lower()}
        strongest_visual_hint = ""

        if exact_title:
            lowered_exact = exact_title.lower()
            if lowered_exact not in seen:
                normalized_parts.append(f"\"{exact_title}\"")
                seen.add(lowered_exact)

        for alias in aliases:
            cleaned_alias = " ".join(alias.strip().split())
            lowered_alias = cleaned_alias.lower()
            if cleaned_alias and lowered_alias not in seen:
                normalized_parts.append(f"\"{cleaned_alias}\"" if " " in cleaned_alias else cleaned_alias)
                seen.add(lowered_alias)
                break

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

    async def _infer_exact_game_identity(self, title: str, internal_imgs: List[str]) -> Dict[str, Any]:
        prompt = f"""
        You are identifying the exact browser game shown in two internal reference images.

        Given:
        - Database title: {title}
        - Image 1: official thumbnail
        - Image 2: gameplay/start screen

        Goal:
        - infer the most likely exact game name shown in the images
        - list title aliases or close title variants that still refer to the same exact game
        - list distinguishing features that separate this exact game from generic lookalikes
        - list misleading generic titles we should avoid matching if they refer to different games

        Return ONLY valid JSON:
        {{
          "exact_game_name": "string",
          "aliases": ["alias 1", "alias 2"],
          "distinguishing_features": ["feature 1", "feature 2"],
          "avoid_titles": ["generic wrong title 1", "generic wrong title 2"],
          "reasoning": "short explanation"
        }}
        """

        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{internal_imgs[0]}"}} ,
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{internal_imgs[1]}"}} ,
                ],
            }
        ]

        return await self.chat_completion(
            messages=messages,
            response_format={"type": "json_object"},
            fallback_data={
                "exact_game_name": title,
                "aliases": [],
                "distinguishing_features": [],
                "avoid_titles": [],
                "reasoning": "Exact identity inference unavailable.",
            },
            metadata={"stage": "exact_game_identity_inference"},
        )

    async def _search_with_openai_web_search(
        self,
        title: str,
        internal_images: List[str],
        search_query: str,
        exact_identity: Dict[str, Any],
        count: int = 10,
    ) -> Dict[str, Any]:
        client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        search_model = os.getenv("OPENAI_WEB_SEARCH_MODEL", "gpt-5.4-mini")
        exact_title = str(exact_identity.get("exact_game_name") or "").strip() or title
        aliases = [item for item in (exact_identity.get("aliases") or []) if isinstance(item, str)]
        distinguishing_features = [
            item for item in (exact_identity.get("distinguishing_features") or []) if isinstance(item, str)
        ]
        avoid_titles = [item for item in (exact_identity.get("avoid_titles") or []) if isinstance(item, str)]
        prompt = f"""
        You are finding the exact playable browser-game pages for Stage 0 verification.

        Use both provided internal images plus the title information to search the web.

        Database title: {title}
        Most likely exact game name: {exact_title}
        Allowed same-game aliases: {aliases}
        Distinguishing features: {distinguishing_features}
        Avoid mismatching to these generic or wrong titles: {avoid_titles}
        Search query hint: {search_query}

        Requirements:
        - Prefer direct playable game pages, not category pages, homepages, news, wiki, or app-store pages.
        - Prefer exact game matches, not merely similar games in the same genre.
        - Use the gameplay/start-screen image to verify the exact UI/theme/title treatment when possible.
        - Reject app stores, download pages, broad category pages, and near-match clones unless they appear to be the same exact game.
        - Return up to {count} distinct candidate URLs.
        - Keep only results that look like the same exact game shown in the images.

        Return ONLY valid JSON in this shape:
        {{
          "candidates": [
            {{
              "url": "https://example.com/game-page",
              "title": "Page title",
              "reason": "short reason this result looks like the exact same game"
            }}
          ]
        }}
        """

        fallback_data = {"candidates": []}
        try:
            response = await client.responses.create(
                model=search_model,
                reasoning={"effort": "low"},
                tools=[{"type": "web_search"}],
                tool_choice="auto",
                include=["web_search_call.action.sources"],
                input=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "input_text", "text": prompt},
                            {
                                "type": "input_image",
                                "image_url": f"data:image/png;base64,{internal_images[0]}",
                            },
                            {
                                "type": "input_image",
                                "image_url": f"data:image/png;base64,{internal_images[1]}",
                            },
                        ],
                    }
                ],
            )
            raw_output_text = getattr(response, "output_text", "") or ""
            parsed = self._parse_json_text(raw_output_text, fallback_data)
            sources = self._extract_web_search_sources(response)
            candidates = self._normalize_web_candidates(parsed.get("candidates") or [], sources, count=count)
            return {
                "engine": "openai_responses_web_search",
                "model": search_model,
                "query": search_query,
                "candidates": candidates,
                "sources": sources,
                "raw_output_text": raw_output_text,
            }
        except Exception as exc:
            logger.error("OpenAI web search failed for '%s': %s", title, exc)
            return {
                "engine": "openai_responses_web_search",
                "model": search_model,
                "query": search_query,
                "candidates": [],
                "sources": [],
                "error": str(exc),
            }

    def _parse_json_text(self, raw_text: str, fallback_data: Dict[str, Any]) -> Dict[str, Any]:
        cleaned = (raw_text or "").strip()
        if cleaned.startswith("```"):
            lines = cleaned.splitlines()
            if lines and lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].startswith("```"):
                lines = lines[:-1]
            cleaned = "\n".join(lines).strip()
        try:
            parsed = json.loads(cleaned)
            return parsed if isinstance(parsed, dict) else fallback_data
        except Exception:
            return fallback_data

    def _extract_web_search_sources(self, response: Any) -> List[Dict[str, str]]:
        try:
            payload = response.model_dump()
        except Exception:
            return []

        discovered: List[Dict[str, str]] = []

        def walk(node: Any) -> None:
            if isinstance(node, dict):
                url = node.get("url")
                title = node.get("title") or node.get("site_name") or node.get("name") or ""
                if isinstance(url, str) and url.startswith("http"):
                    discovered.append({"url": url, "title": str(title)})
                for value in node.values():
                    walk(value)
            elif isinstance(node, list):
                for item in node:
                    walk(item)

        walk(payload)

        deduped: List[Dict[str, str]] = []
        seen = set()
        for item in discovered:
            url = item["url"].strip()
            if not url or url in seen:
                continue
            seen.add(url)
            deduped.append({"url": url, "title": item.get("title", "").strip()})
        return deduped

    def _normalize_web_candidates(
        self,
        model_candidates: List[Dict[str, Any]],
        sources: List[Dict[str, str]],
        count: int = 10,
    ) -> List[Dict[str, str]]:
        normalized: List[Dict[str, str]] = []
        seen = set()
        blocked_fragments = [
            "play.google.com",
            "apps.apple.com",
            "/store/apps/",
            "microsoft.com",
            "steamcommunity.com",
            "store.steampowered.com",
            "youtube.com",
            "facebook.com",
            "instagram.com",
            "tiktok.com",
            "reddit.com",
            "pinterest.com",
            "/tag/",
            "/category/",
        ]

        for candidate in model_candidates:
            if not isinstance(candidate, dict):
                continue
            url = str(candidate.get("url", "")).strip()
            lowered_url = url.lower()
            if (
                not url.startswith("http")
                or url in seen
                or any(fragment in lowered_url for fragment in blocked_fragments)
            ):
                continue
            seen.add(url)
            normalized.append(
                {
                    "url": url,
                    "title": str(candidate.get("title", "")).strip(),
                    "reason": str(candidate.get("reason", "")).strip(),
                }
            )
            if len(normalized) >= count:
                return normalized

        for source in sources:
            url = str(source.get("url", "")).strip()
            lowered_url = url.lower()
            if (
                not url.startswith("http")
                or url in seen
                or any(fragment in lowered_url for fragment in blocked_fragments)
            ):
                continue
            seen.add(url)
            normalized.append(
                {
                    "url": url,
                    "title": str(source.get("title", "")).strip(),
                    "reason": "Recovered from OpenAI web search source list.",
                }
            )
            if len(normalized) >= count:
                break

        return normalized

    def _build_candidate_seo_intelligence(
        self,
        game_title: str,
        search_query: str,
        metadata: Dict[str, Any],
    ) -> Dict[str, Any]:
        def normalized_text(value: Any) -> str:
            return " ".join(str(value or "").split()).strip()

        title_tokens = [token.lower() for token in re.findall(r"[a-z0-9]+", game_title) if token.strip()]
        query_tokens = [token.lower() for token in re.findall(r"[a-z0-9]+", search_query) if token.strip()]

        title_text = normalized_text(metadata.get("title", ""))
        description_text = normalized_text(metadata.get("meta_description", ""))
        headings = [normalized_text(item) for item in (metadata.get("headings") or []) if normalized_text(item)]
        about_game = normalized_text(metadata.get("about_game", ""))
        how_to_play = normalized_text(metadata.get("how_to_play", ""))
        instructions = normalized_text(metadata.get("instructions", ""))
        developer_publisher = [normalized_text(item) for item in (metadata.get("developer_publisher") or []) if normalized_text(item)]
        ratings_and_votes = [normalized_text(item) for item in (metadata.get("ratings_and_votes") or []) if normalized_text(item)]
        tags = [normalized_text(item) for item in (metadata.get("tags") or []) if normalized_text(item)]
        categories = [normalized_text(item) for item in (metadata.get("categories") or []) if normalized_text(item)]
        faq_items = [item for item in (metadata.get("faq_items") or []) if isinstance(item, dict)]

        corpus = " ".join(
            [
                title_text.lower(),
                description_text.lower(),
                " ".join(heading.lower() for heading in headings),
                about_game.lower(),
                how_to_play.lower(),
                instructions.lower(),
                " ".join(item.lower() for item in tags),
                " ".join(item.lower() for item in categories),
            ]
        )

        matched_title_tokens = [token for token in title_tokens if token in corpus]
        matched_query_tokens = [token for token in query_tokens if token in corpus]
        query_alignment_score = round(100 * (len(set(matched_query_tokens)) / max(len(set(query_tokens)), 1)))

        coverage_checks = {
            "meta_description": bool(description_text),
            "about_game": bool(about_game),
            "how_to_play": bool(how_to_play),
            "instructions": bool(instructions),
            "faq_items": bool(faq_items),
            "developer_publisher": bool(developer_publisher),
            "ratings_and_votes": bool(ratings_and_votes),
            "tags": bool(tags),
            "categories": bool(categories),
        }
        metadata_quality_score = round(
            100 * (sum(1 for present in coverage_checks.values() if present) / len(coverage_checks))
        )

        content_points = 0
        if len(about_game) >= 180:
            content_points += 25
        if len(how_to_play) >= 120:
            content_points += 25
        if len(instructions) >= 120:
            content_points += 20
        if len(faq_items) >= 2:
            content_points += 15
        if len(tags) + len(categories) >= 3:
            content_points += 15
        content_depth_score = min(content_points, 100)

        faq_topics = [
            {
                "question": normalized_text(item.get("question", "")),
                "answer_preview": normalized_text(item.get("answer", ""))[:220],
            }
            for item in faq_items[:8]
            if normalized_text(item.get("question", ""))
        ]

        content_gaps: List[str] = []
        if not about_game:
            content_gaps.append("missing_about_game")
        if not how_to_play:
            content_gaps.append("missing_how_to_play")
        if not instructions:
            content_gaps.append("missing_instructions")
        if not developer_publisher:
            content_gaps.append("missing_developer_publisher")
        if not ratings_and_votes:
            content_gaps.append("missing_ratings_and_votes")
        if not tags and not categories:
            content_gaps.append("missing_tags_categories")
        if not faq_items:
            content_gaps.append("missing_faq")

        seo_score = round(
            (query_alignment_score * 0.4)
            + (metadata_quality_score * 0.35)
            + (content_depth_score * 0.25)
        )

        return {
            "matched_title_tokens": matched_title_tokens,
            "matched_query_tokens": matched_query_tokens,
            "query_alignment_score": query_alignment_score,
            "metadata_quality_score": metadata_quality_score,
            "content_depth_score": content_depth_score,
            "seo_score": seo_score,
            "faq_topics": faq_topics,
            "developer_publisher": developer_publisher[:10],
            "ratings_and_votes": ratings_and_votes[:10],
            "tags": tags[:15],
            "categories": categories[:15],
            "content_gaps": content_gaps,
        }

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

    def _score_candidate(self, correlation: Dict[str, Any], seo_intelligence: Dict[str, Any]) -> Dict[str, Any]:
        visual_similarity = int(correlation.get("visual_similarity_score", 0) or 0)
        mechanic_match = int(correlation.get("mechanic_match_score", 0) or 0)
        text_relevance = int(correlation.get("text_relevance_score", 0) or 0)
        brand_alignment = int(correlation.get("brand_alignment_score", 0) or 0)

        query_alignment = int(seo_intelligence.get("query_alignment_score", 0) or 0)
        metadata_quality = int(seo_intelligence.get("metadata_quality_score", 0) or 0)
        content_depth = int(seo_intelligence.get("content_depth_score", 0) or 0)

        image_correlation_score = round(
            (visual_similarity * 0.6)
            + (mechanic_match * 0.25)
            + (brand_alignment * 0.15)
        )
        context_relevance_score = round(
            (text_relevance * 0.55)
            + (query_alignment * 0.30)
            + (metadata_quality * 0.15)
        )

        confidence_score = round(
            (image_correlation_score * 0.60)
            + (context_relevance_score * 0.30)
            + (content_depth * 0.10)
        )

        confidence_reasoning = (
            f"Image correlation scored {image_correlation_score}/100 because the external render "
            f"shares visual similarity ({visual_similarity}), mechanic alignment ({mechanic_match}), "
            f"and brand/style alignment ({brand_alignment}) with the two internal references. "
            f"Context relevance scored {context_relevance_score}/100 because the page text matched "
            f"the search intent ({text_relevance}), query tokens ({query_alignment}), and metadata quality "
            f"({metadata_quality}). Content depth contributed {content_depth}/100 based on how much usable "
            f"about/how-to/instructions/FAQ content the page exposed. The final confidence score is "
            f"{confidence_score}/100 from these combined signals."
        )

        return {
            "triple_image_correlation": {
                "reference_thumbnail_vs_external": visual_similarity,
                "internal_gameplay_vs_external": mechanic_match,
                "brand_style_alignment": brand_alignment,
                "reasoning": correlation.get("reasoning", ""),
            },
            "context_relevance": {
                "text_relevance_score": text_relevance,
                "query_alignment_score": query_alignment,
                "metadata_quality_score": metadata_quality,
                "content_depth_score": content_depth,
            },
            "aggregate_confidence": {
                "image_correlation_score": image_correlation_score,
                "context_relevance_score": context_relevance_score,
                "confidence_score": confidence_score,
                "confidence_reasoning": confidence_reasoning,
            },
            "weights": {
                "image_correlation_score": 0.60,
                "context_relevance_score": 0.30,
                "content_depth_score": 0.10,
            },
            "confidence_score": confidence_score,
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
