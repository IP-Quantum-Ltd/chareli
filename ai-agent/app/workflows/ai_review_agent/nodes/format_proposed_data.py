import json
import logging
import re
from typing import Any, Dict, Optional

from app.domain.schemas.llm_outputs import ProposedGameDataOutput
from app.infrastructure.llm.ai_executor import AIExecutor
from app.workflows.ai_review_agent.context import record_stage
from app.workflows.ai_review_agent.services.submission_reconciler import (
    SubmissionReconciler,
    merge_faq_content,
)

logger = logging.getLogger(__name__)

_H2_SPLIT = re.compile(r'(?=<h2[\s>])', re.IGNORECASE)


_H2_TAG = re.compile(r'^<h2[^>]*>.*?</h2>\s*', re.IGNORECASE | re.DOTALL)


def _split_article_sections(article: str) -> dict[str, tuple[str, str]]:
    """Return a dict of lowercased section title → (full block with h2, body without h2)."""
    sections: dict[str, tuple[str, str]] = {}
    for block in _H2_SPLIT.split(article):
        block = block.strip()
        if not block:
            continue
        title_match = re.match(r'<h2[^>]*>(.*?)</h2>', block, re.IGNORECASE | re.DOTALL)
        if title_match:
            title = re.sub(r'<[^>]+>', '', title_match.group(1)).strip().lower()
            body = _H2_TAG.sub('', block).strip()
            sections[title] = (block, body)
    return sections


class FormatProposedDataNode:
    """Final LLM step: maps pipeline output → server Game schema for proposedData submission."""

    def __init__(self, ai: AIExecutor):
        self._ai = ai
        self._submission_reconciler = SubmissionReconciler()

    async def __call__(self, state: Dict[str, Any]) -> Dict[str, Any]:
        game_title = state.get("game_title") or ""
        logger.info("Node: Format | Game: %s | pipeline_status: %s", game_title, state.get("status"))

        article = state.get("article") or ""

        if not article:
            # Nothing to format yet — use whatever is available
            state["proposed_game_data"] = self._build_fallback(state)
            record_stage(state, "format", "completed", "Proposed game data built from fallback (no article available).")
            return state

        grounded = state.get("grounded_context") or {}
        gameplay = (grounded.get("grounded_gameplay") or {})
        seo_support = (grounded.get("seo_support") or {})
        optimization = state.get("optimization") or {}
        investigation = state.get("investigation") or {}
        current_game = ((state.get("proposal_snapshot") or {}).get("game") or {})
        current_metadata = (current_game.get("metadata") or {}) if isinstance(current_game, dict) else {}
        current_seo = (current_game.get("seoMeta") or {}) if isinstance(current_game, dict) else {}
        best_match = (investigation.get("best_match") or {})
        extracted_facts = (best_match.get("extracted_facts") or {})

        best_match_meta = best_match.get("metadata") or {}
        faq_schema = optimization.get("faq_schema") or []
        faq_opportunities = seo_support.get("faq_opportunities") or []
        merged_existing_faq = merge_faq_content(
            current_metadata.get("faqOverride"),
            "",
            current_seo.get("faq_schema"),
        )
        # Merge optimizer FAQ schema with research FAQ opportunities
        faq_items = [{"question": f.get("question", ""), "answer": f.get("answer", "")} for f in faq_schema if f.get("question")]
        if not faq_items:
            faq_items = [{"question": f.get("question", ""), "answer": f.get("answer_angle", "")} for f in faq_opportunities if f.get("question")]

        # Build a rich context pulling from all research sources
        context_summary = {
            "game_title": game_title,
            "objective": gameplay.get("objective") or extracted_facts.get("objective") or "",
            "developer": gameplay.get("developer") or extracted_facts.get("original_developer") or "",
            "features": gameplay.get("features") or [],
            "controls_pc": extracted_facts.get("controls") or gameplay.get("controls") or "",
            "controls_mobile": best_match_meta.get("instructions") or "",
            "how_to_play_raw": best_match_meta.get("how_to_play") or gameplay.get("how_to_play") or "",
            "rules": extracted_facts.get("rules") or "",
            "primary_keywords": seo_support.get("primary_keywords") or [],
            "secondary_keywords": seo_support.get("secondary_keywords") or [],
            "content_angles": seo_support.get("content_angles") or [],
            "meta_description": optimization.get("meta_description") or "",
            "best_match_url": best_match.get("url") or "",
            "faq_items": faq_items,
            "existing_game": {
                "title": current_game.get("title") or "",
                "description": current_game.get("description") or "",
                "categoryId": current_game.get("categoryId") or "",
                "metadata": {
                    "howToPlay": current_metadata.get("howToPlay") or "",
                    "features": current_metadata.get("features") or [],
                    "tags": current_metadata.get("tags") or [],
                    "seoKeywords": current_metadata.get("seoKeywords") or "",
                    "developer": current_metadata.get("developer") or "",
                    "platform": current_metadata.get("platform") or [],
                    "releaseDate": current_metadata.get("releaseDate") or "",
                },
                "seoMeta": {
                    "title_tag": current_seo.get("title_tag") or "",
                    "meta_description": current_seo.get("meta_description") or "",
                    "primary_h1": current_seo.get("primary_h1") or "",
                    "primary_keywords": current_seo.get("primary_keywords") or [],
                },
                "faq_items": merged_existing_faq,
            },
        }

        prompt = f"""You are formatting a browser game's data for storage in a game database.
Game title: {game_title}

Research context (JSON):
{json.dumps(context_summary, indent=2, default=str)}

Article (first 2000 chars for reference):
{article[:2000]}

Return ONLY valid JSON matching this exact structure:
{{
  "title": "{game_title}",
  "description": "<the full article text verbatim — do not summarise or truncate>",
  "categoryId": "<preserve the current categoryId when one already exists, otherwise empty string>",
  "metadata": {{
    "howToPlay": "<rich HTML how-to-play section>",
    "faqOverride": "<HTML FAQ section>",
    "features": ["<feature 1>", "<feature 2>", "<feature 3>"],
    "tags": ["<tag1>", "<tag2>", "<tag3>", "<tag4>", "<tag5>"],
    "seoKeywords": "<comma-separated primary and secondary keywords>",
    "developer": "<original developer name or empty string>",
    "platform": ["Browser"],
    "releaseDate": ""
  }}
}}

Rules:
- description MUST contain only the Overview and Strategy sections from the article — preserve all HTML tags, NO markdown; do NOT include How to Play or FAQ content in description
- use existing_game as the current source of truth; if the new evidence is weak, empty, placeholder-like, or instruction-like, keep the existing value instead of inventing one
- preserve existing_game.categoryId exactly when it exists
- howToPlay must be comprehensive HTML — include: objective, step-by-step controls for PC AND mobile separately, gameplay rules, power-up/bonus tips; use <h3>, <p>, <ul>, <li>, <strong> tags; NO markdown, only HTML
- faqOverride must be HTML — merge existing_game.faq_items with new validated FAQ evidence; format as <h3>FAQ</h3> followed by <h4>Q: ...</h4><p>A: ...</p> blocks; do not overwrite existing valid FAQ entries; append distinct new ones; NO markdown, only HTML
- never emit FAQ answers that read like instructions to a writer, such as "Provide a detailed..." or "Explain..."; drop those instead
- features: 3-6 short gameplay feature strings (plain text, no HTML)
- tags: 4-8 short tags relevant to the game genre and gameplay (plain text)
- seoKeywords: comma-separated list from the research context primary/secondary keywords
- developer: exact studio/developer name if known and trustworthy; remove domains like ".com"; if the result is only a low-signal site label such as plays, gamepix, silvergames, primarygames, game-game, or yad, output empty string or keep the existing developer instead
- platform: always ["Browser"]"""

        try:
            result = await self._ai.chat_completion(
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
                pydantic_schema=ProposedGameDataOutput,
                fallback_data={
                    "title": game_title,
                    "description": article,
                    "metadata": {
                        "howToPlay": best_match_meta.get("how_to_play") or gameplay.get("how_to_play") or "",
                        "features": gameplay.get("features") or [],
                        "tags": (seo_support.get("primary_keywords") or [])[:6],
                        "seoKeywords": ", ".join((seo_support.get("primary_keywords") or [])[:10]),
                        "developer": gameplay.get("developer") or extracted_facts.get("original_developer") or "",
                        "platform": ["Browser"],
                        "releaseDate": "",
                    },
                },
                metadata={"stage": "format_proposed_data"},
            )
            # Split article into sections and route each to the correct field.
            # description gets Overview + Strategy only; dedicated fields get How to Play and FAQ.
            if isinstance(result, dict):
                sections = _split_article_sections(article)
                # description keeps h2 headings; dedicated fields strip them (page renders its own heading)
                overview_full = sections.get("overview", ("", ""))[0]
                strategy_full = sections.get("strategy", ("", ""))[0]
                result["description"] = (
                    (overview_full + "\n" + strategy_full).strip() or article
                )
                result["title"] = game_title
                meta = result.setdefault("metadata", {})
                how_to_play_body = sections.get("how to play", ("", ""))[1]
                faq_body = sections.get("faq", ("", ""))[1]
                if how_to_play_body:
                    meta["howToPlay"] = how_to_play_body
                if faq_body:
                    meta["faqOverride"] = faq_body
            reconciled_game_data, reconciled_seo = self._submission_reconciler.reconcile(
                result,
                state.get("seo_meta") or {},
                current_game,
            )
            state["proposed_game_data"] = reconciled_game_data
            state["seo_meta"] = reconciled_seo
            record_stage(state, "format", "completed", f"Proposed game data formatted for '{game_title}'.")
        except Exception as exc:
            logger.warning("FormatProposedData failed, using fallback: %s", exc)
            fallback = self._build_fallback(state)
            reconciled_game_data, reconciled_seo = self._submission_reconciler.reconcile(
                fallback,
                state.get("seo_meta") or {},
                current_game,
            )
            state["proposed_game_data"] = reconciled_game_data
            state["seo_meta"] = reconciled_seo
            record_stage(state, "format", "completed", "Proposed game data built from fallback.")

        return state

    def _build_fallback(self, state: Dict[str, Any]) -> Dict[str, Any]:
        game_title = state.get("game_title") or ""
        article = state.get("article") or ""
        grounded = state.get("grounded_context") or {}
        gameplay = grounded.get("grounded_gameplay") or {}
        seo_support = (grounded.get("seo_support") or {})
        investigation = state.get("investigation") or {}
        current_game = ((state.get("proposal_snapshot") or {}).get("game") or {})
        current_metadata = (current_game.get("metadata") or {}) if isinstance(current_game, dict) else {}
        extracted_facts = ((investigation.get("best_match") or {}).get("extracted_facts") or {})
        return {
            "title": game_title,
            "description": article or (current_game.get("description") or ""),
            "categoryId": current_game.get("categoryId") or "",
            "metadata": {
                "howToPlay": gameplay.get("how_to_play") or gameplay.get("controls") or current_metadata.get("howToPlay") or "",
                "features": gameplay.get("features") or current_metadata.get("features") or [],
                "tags": (seo_support.get("primary_keywords") or [])[:6] or current_metadata.get("tags") or [],
                "seoKeywords": ", ".join((seo_support.get("primary_keywords") or [])[:10]) or (current_metadata.get("seoKeywords") or ""),
                "developer": gameplay.get("developer") or extracted_facts.get("original_developer") or current_metadata.get("developer") or "",
                "platform": ["Browser"],
                "releaseDate": current_metadata.get("releaseDate") or "",
            },
        }
