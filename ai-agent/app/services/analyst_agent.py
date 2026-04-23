import json
import logging
from typing import Any, Dict, List
from urllib.parse import urlparse

from langsmith import traceable

from app.services.base import BaseAIClient, BaseService

logger = logging.getLogger(__name__)


class AnalystAgent(BaseService, BaseAIClient):
    """
    Stage 1: SEO Intelligence.
    Performs keyword clustering, entity extraction, and intent alignment using
    the verified Stage 0 evidence pack.
    """

    def _trim_text(self, value: Any, limit: int = 1200) -> str:
        text = " ".join(str(value or "").split())
        if len(text) <= limit:
            return text
        return text[:limit].rstrip() + "..."

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
        normalized_headings: List[str] = []
        for heading in headings[:20]:
            if isinstance(heading, dict):
                normalized_headings.append(self._trim_text(heading.get("text", ""), 220))
            else:
                normalized_headings.append(self._trim_text(heading, 220))
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
                        [
                            item.get("text", "") if isinstance(item, dict) else item
                            for item in (candidate_metadata.get("headings") or [])
                        ],
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
                    {
                        "question": self._trim_text(item.get("question", ""), 180),
                        "answer": self._trim_text(item.get("answer", ""), 420),
                    }
                    for item in (metadata.get("faq_items") or [])[:10]
                    if isinstance(item, dict)
                ],
                "key_sections": simplified_sections,
                "content_blocks": self._limit_strings(
                    [
                        metadata.get("about_game", ""),
                        metadata.get("how_to_play", ""),
                        metadata.get("instructions", ""),
                    ],
                    10,
                    320,
                ),
                "main_text_excerpt": self._trim_text(
                    " ".join(
                        part for part in [
                            metadata.get("about_game", ""),
                            metadata.get("how_to_play", ""),
                            metadata.get("instructions", ""),
                        ] if part
                    ),
                    6000,
                ),
                "structured_data": [],
            },
            "serp_signals": serp_signals,
        }

    @traceable(run_type="chain", name="SEO Intelligence Extraction")
    async def analyze_seo_potential(self, game_title: str, investigation: Dict[str, Any]) -> Dict[str, Any]:
        """
        Generates a Stage 1 SEO blueprint from the verified Stage 0 evidence pack.
        """
        self.logger.info(f"Analyst generating SEO intelligence for: {game_title}")

        stage1_context = self._build_stage1_context(game_title, investigation)

        prompt = f"""
        Task: Stage 1 SEO Strategic Intelligence for the ArcadeBox game '{game_title}'.

        Use the verified Stage 0 evidence below to produce a grounded SEO blueprint.
        Do not invent mechanics, developer names, or features that are not supported by the evidence.
        Optimize for ArcadeBox's browser-game and unblocked-game audience, but keep recommendations
        aligned with the actual verified game identity and on-page language.

        Verified evidence:
        {json.dumps(stage1_context, indent=2)}

        Requirements:
        1. Build keyword clusters tied to real search intent, not generic SEO filler.
        2. Extract semantic entities that should appear naturally in the article.
        3. Identify the most relevant audience segments and content angles.
        4. Turn visible FAQ/instruction signals into grounded FAQ opportunities.
        5. Suggest metadata that is realistic for an ArcadeBox guide page.

        Return ONLY valid JSON:
        {{
            "primary_keywords": ["kw1", "kw2"],
            "secondary_keywords": ["kw3", "kw4"],
            "long_tail_keywords": ["kw5", "kw6"],
            "semantic_entities": ["entity1", "entity2"],
            "keyword_clusters": [
                {{
                    "cluster_name": "string",
                    "search_intent": "string",
                    "keywords": ["string"]
                }}
            ],
            "search_intents": ["string"],
            "audience_segments": ["string"],
            "content_angles": ["string"],
            "serp_features": ["string"],
            "faq_opportunities": [
                {{
                    "question": "string",
                    "source_signal": "string",
                    "answer_angle": "string"
                }}
            ],
            "metadata_recommendations": {{
                "slug": "string",
                "title_tag": "string",
                "meta_description": "string",
                "primary_h1": "string"
            }},
            "intent_strategy": "string",
            "suggested_title": "string"
        }}
        """

        messages = [
            {
                "role": "system",
                "content": (
                    "You are a specialized SEO Intelligence Agent for ArcadeBox. "
                    "Respond only with JSON and stay grounded in the verified evidence."
                ),
            },
            {"role": "user", "content": prompt},
        ]

        fallback_slug = "-".join(
            chunk for chunk in "".join(ch.lower() if ch.isalnum() else "-" for ch in game_title).split("-") if chunk
        ) or "game-guide"
        fallback_keywords = [
            f"{game_title} guide",
            f"{game_title} unblocked",
            f"{game_title} tips",
        ]

        return await self.chat_completion(
            messages=messages,
            response_format={"type": "json_object"},
            fallback_data={
                "primary_keywords": fallback_keywords[:2],
                "secondary_keywords": [f"{game_title} online", f"{game_title} browser game"],
                "long_tail_keywords": [
                    f"how to play {game_title}",
                    f"{game_title} strategy guide",
                    f"{game_title} controls",
                ],
                "semantic_entities": [game_title, "browser game", "arcade game", "unblocked game"],
                "keyword_clusters": [
                    {
                        "cluster_name": "core guide intent",
                        "search_intent": "guide",
                        "keywords": fallback_keywords,
                    },
                    {
                        "cluster_name": "gameplay help",
                        "search_intent": "how-to",
                        "keywords": [f"{game_title} controls", f"{game_title} how to play"],
                    },
                ],
                "search_intents": ["guide", "how-to", "tips"],
                "audience_segments": ["players looking for quick mastery help", "users searching for unblocked gameplay"],
                "content_angles": ["controls and mechanics", "tips for better scores", "browser-play accessibility"],
                "serp_features": ["FAQ", "how-to snippets"],
                "faq_opportunities": [
                    {
                        "question": f"How do you play {game_title}?",
                        "source_signal": "verified gameplay and page instructions",
                        "answer_angle": "Explain the controls, objective, and first actions a new player should take.",
                    },
                    {
                        "question": f"What are the best tips for {game_title}?",
                        "source_signal": "strategy/tips intent",
                        "answer_angle": "Summarize practical advice for scoring better and avoiding beginner mistakes.",
                    },
                ],
                "metadata_recommendations": {
                    "slug": f"{fallback_slug}-guide",
                    "title_tag": f"{game_title} Guide: Tips, Controls, and How to Play",
                    "meta_description": (
                        f"Learn how to play {game_title}, understand the controls, and get quick tips "
                        "for better runs on ArcadeBox."
                    ),
                    "primary_h1": f"{game_title} Guide",
                },
                "intent_strategy": "A mastery-first guide targeting how-to, tips, and unblocked browser-play intent.",
                "suggested_title": f"{game_title} Guide: How to Play, Controls, and Winning Tips",
            },
            metadata={"stage": "seo_intelligence"},
        )
