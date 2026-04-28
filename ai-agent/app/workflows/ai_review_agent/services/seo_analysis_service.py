import logging
from typing import Any, Dict, List
from urllib.parse import urlparse

from langsmith import traceable

from app.domain.schemas.llm_outputs import SeoAnalysisOutput
from app.infrastructure.llm.ai_executor import AIExecutor
from app.services.json_utils import json_dumps_safe

logger = logging.getLogger(__name__)


class SeoAnalysisService:
    def __init__(self, ai: AIExecutor):
        self.ai = ai
        self.last_cost = 0.0
        self.logger = logging.getLogger(self.__class__.__name__)

    def _trim_text(self, value: Any, limit: int = 1200) -> str:
        text = " ".join(str(value or "").split())
        return text if len(text) <= limit else text[:limit].rstrip() + "..."

    def _limit_strings(self, values: Any, count: int, text_limit: int = 240) -> List[str]:
        limited: List[str] = []
        seen = set()
        for value in values or []:
            text = self._trim_text(value, text_limit)
            if not text:
                continue
            lowered = text.lower()
            if lowered in seen:
                continue
            seen.add(lowered)
            limited.append(text)
            if len(limited) >= count:
                break
        return limited

    def _simplify_section(self, section: Any, text_limit: int = 1200) -> Dict[str, Any]:
        if not isinstance(section, dict):
            return {}
        return {
            "heading": self._trim_text(section.get("heading", ""), 180),
            "level": section.get("level", ""),
            "text": self._trim_text(section.get("text", ""), text_limit),
            "list_items": self._limit_strings(section.get("list_items"), 10, 220),
        }

    def _build_stage1_context(self, game_title: str, investigation: Dict[str, Any]) -> Dict[str, Any]:
        best_match = investigation.get("best_match") or {}
        metadata = best_match.get("metadata") or {}
        all_candidates = investigation.get("all_candidates") or []
        headings = metadata.get("headings") or []
        normalized_headings = [
            self._trim_text(heading.get("text", ""), 220) if isinstance(heading, dict) else self._trim_text(heading, 220)
            for heading in headings[:20]
        ]
        normalized_headings = [heading for heading in normalized_headings if heading]

        key_sections = metadata.get("key_sections") or {}
        simplified_sections = {
            "about": self._simplify_section(key_sections.get("about")) or {
                "heading": "About Game",
                "level": "section",
                "text": self._trim_text(metadata.get("about_game", ""), 1200),
                "list_items": [],
            },
            "how_to_play": self._simplify_section(key_sections.get("how_to_play")) or {
                "heading": "How to Play",
                "level": "section",
                "text": self._trim_text(metadata.get("how_to_play", ""), 1200),
                "list_items": [],
            },
            "controls": self._simplify_section(key_sections.get("controls")) or {
                "heading": "Instructions",
                "level": "section",
                "text": self._trim_text(metadata.get("instructions", ""), 1200),
                "list_items": [],
            },
            "faq": self._simplify_section(key_sections.get("faq")),
            "developer": self._simplify_section(key_sections.get("developer")) or {
                "heading": "Developer / Publisher",
                "level": "section",
                "text": self._trim_text(" | ".join(metadata.get("developer_publisher") or []), 1200),
                "list_items": self._limit_strings(metadata.get("developer_publisher"), 10, 160),
            },
            "features": self._simplify_section(key_sections.get("features")),
        }

        serp_signals: List[Dict[str, Any]] = []
        for candidate in all_candidates[:5]:
            candidate_metadata = candidate.get("metadata") or {}
            candidate_url = candidate.get("url", "")
            serp_signals.append(
                {
                    "domain": urlparse(candidate_url).netloc,
                    "url": candidate_url,
                    "confidence_score": candidate.get("confidence_score", 0),
                    "page_title": candidate_metadata.get("title", ""),
                    "meta_description": self._trim_text(candidate_metadata.get("meta_description", ""), 260),
                    "headings": self._limit_strings(
                        [item.get("text", "") if isinstance(item, dict) else item for item in (candidate_metadata.get("headings") or [])],
                        6,
                        160,
                    ),
                }
            )

        return {
            "game_title": game_title,
            "search_query": investigation.get("search_query", ""),
            "visual_confidence": best_match.get("confidence_score", 0),
            "best_match_url": best_match.get("url", ""),
            "best_match_domain": urlparse(best_match.get("url", "")).netloc,
            "best_match_reasoning": self._trim_text(best_match.get("reasoning", ""), 1500),
            "verified_facts": best_match.get("extracted_facts") or {},
            "page_metadata": {
                "title": metadata.get("title", ""),
                "meta_description": self._trim_text(metadata.get("meta_description", ""), 400),
                "meta_keywords": self._trim_text(metadata.get("meta_keywords", ""), 300),
                "og_title": metadata.get("og_title", ""),
                "og_description": self._trim_text(metadata.get("og_description", ""), 400),
                "categories": self._limit_strings(metadata.get("categories"), 12, 120),
                "tags": self._limit_strings(metadata.get("tags"), 15, 120),
                "developer_mentions": self._limit_strings(metadata.get("developer_publisher"), 10, 120),
                "ratings": self._limit_strings(metadata.get("ratings_and_votes"), 10, 120),
                "headings": normalized_headings,
                "faq_items": [
                    {"question": self._trim_text(item.get("question", ""), 180), "answer": self._trim_text(item.get("answer", ""), 420)}
                    for item in (metadata.get("faq_items") or [])[:10]
                    if isinstance(item, dict)
                ],
                "key_sections": simplified_sections,
                "content_blocks": self._limit_strings(
                    [metadata.get("about_game", ""), metadata.get("how_to_play", ""), metadata.get("instructions", "")],
                    10,
                    320,
                ),
                "main_text_excerpt": self._trim_text(
                    " ".join(part for part in [metadata.get("about_game", ""), metadata.get("how_to_play", ""), metadata.get("instructions", "")] if part),
                    6000,
                ),
                "structured_data": [],
            },
            "serp_signals": serp_signals,
        }

    @traceable(run_type="chain", name="SEO Intelligence Extraction")
    async def analyze_seo_potential(self, game_title: str, investigation: Dict[str, Any]) -> Dict[str, Any]:
        self.logger.info("Analyst generating SEO intelligence for: %s", game_title)
        stage1_context = self._build_stage1_context(game_title, investigation)
        prompt = f"""
        Task: Stage 1 SEO Strategic Intelligence for the ArcadeBox game '{game_title}'.
        Verified evidence:
        {json_dumps_safe(stage1_context, indent=2)}
        Return ONLY valid JSON:
        {{
            "primary_keywords": ["kw1", "kw2"],
            "secondary_keywords": ["kw3", "kw4"],
            "long_tail_keywords": ["kw5", "kw6"],
            "semantic_entities": ["entity1", "entity2"],
            "keyword_clusters": [{{"cluster_name": "string", "search_intent": "string", "keywords": ["string"]}}],
            "search_intents": ["string"],
            "audience_segments": ["string"],
            "content_angles": ["string"],
            "serp_features": ["string"],
            "faq_opportunities": [{{"question": "string", "source_signal": "string", "answer_angle": "string"}}],
            "metadata_recommendations": {{"slug": "string", "title_tag": "string", "meta_description": "string", "primary_h1": "string"}},
            "intent_strategy": "string",
            "suggested_title": "string"
        }}
        """
        fallback_slug = "-".join(chunk for chunk in "".join(ch.lower() if ch.isalnum() else "-" for ch in game_title).split("-") if chunk) or "game-guide"
        fallback_keywords = [f"{game_title} guide", f"{game_title} unblocked", f"{game_title} tips"]
        result = await self.ai.chat_completion(
            messages=[
                {"role": "system", "content": "You are a specialized SEO Intelligence Agent for ArcadeBox. Respond only with JSON and stay grounded in the verified evidence."},
                {"role": "user", "content": prompt},
            ],
            response_format={"type": "json_object"},
            pydantic_schema=SeoAnalysisOutput,
            fallback_data={
                "primary_keywords": fallback_keywords[:2],
                "secondary_keywords": [f"{game_title} online", f"{game_title} browser game"],
                "long_tail_keywords": [f"how to play {game_title}", f"{game_title} strategy guide"],
                "semantic_entities": [game_title, "browser game", "ArcadeBox"],
                "keyword_clusters": [{"cluster_name": "primary", "search_intent": "informational", "keywords": fallback_keywords}],
                "search_intents": ["informational"],
                "audience_segments": ["browser game players"],
                "content_angles": ["beginner guide"],
                "serp_features": ["faq"],
                "faq_opportunities": [],
                "metadata_recommendations": {
                    "slug": fallback_slug,
                    "title_tag": f"{game_title} Guide",
                    "meta_description": f"Learn how to play {game_title} on ArcadeBox.",
                    "primary_h1": f"{game_title} Guide",
                },
                "intent_strategy": "Use verified mechanics and controls as the core content angle.",
                "suggested_title": f"{game_title} Guide",
            },
        )
        self.last_cost = self.ai.last_cost
        return result
