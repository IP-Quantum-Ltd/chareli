import json
import logging
from typing import Any, Dict

from app.domain.schemas.llm_outputs import ProposedGameDataOutput
from app.infrastructure.llm.ai_executor import AIExecutor
from app.workflows.ai_review_agent.context import record_stage

logger = logging.getLogger(__name__)


class FormatProposedDataNode:
    """Final LLM step: maps pipeline output → server Game schema for proposedData submission."""

    def __init__(self, ai: AIExecutor):
        self._ai = ai

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
        best_match = (investigation.get("best_match") or {})
        extracted_facts = (best_match.get("extracted_facts") or {})

        best_match_meta = best_match.get("metadata") or {}
        faq_schema = optimization.get("faq_schema") or []
        faq_opportunities = seo_support.get("faq_opportunities") or []
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
        }

        prompt = f"""You are formatting a browser game's data for storage in a game database.
Game title: {game_title}

Research context (JSON):
{json.dumps(context_summary, indent=2)}

Article (first 2000 chars for reference):
{article[:2000]}

Return ONLY valid JSON matching this exact structure:
{{
  "title": "{game_title}",
  "description": "<the full article text verbatim — do not summarise or truncate>",
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
- description MUST be the full article text exactly as written — preserve all HTML tags, NO markdown
- howToPlay must be comprehensive HTML — include: objective, step-by-step controls for PC AND mobile separately, gameplay rules, power-up/bonus tips; use <h3>, <p>, <ul>, <li>, <strong> tags; NO markdown, only HTML
- faqOverride must be HTML — use the faq_items from context; format as <h3>FAQ</h3> followed by <h4>Q: ...</h4><p>A: ...</p> blocks; cover at least 4-6 questions about gameplay, controls, and platform; NO markdown, only HTML
- features: 3-6 short gameplay feature strings (plain text, no HTML)
- tags: 4-8 short tags relevant to the game genre and gameplay (plain text)
- seoKeywords: comma-separated list from the research context primary/secondary keywords
- developer: exact studio/developer name if known, otherwise empty string
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
            # Always use the full article — LLM may have truncated it in description
            if isinstance(result, dict):
                result["description"] = article
                result["title"] = game_title
            state["proposed_game_data"] = result
            record_stage(state, "format", "completed", f"Proposed game data formatted for '{game_title}'.")
        except Exception as exc:
            logger.warning("FormatProposedData failed, using fallback: %s", exc)
            state["proposed_game_data"] = self._build_fallback(state)
            record_stage(state, "format", "completed", "Proposed game data built from fallback.")

        return state

    def _build_fallback(self, state: Dict[str, Any]) -> Dict[str, Any]:
        game_title = state.get("game_title") or ""
        article = state.get("article") or ""
        grounded = state.get("grounded_context") or {}
        gameplay = grounded.get("grounded_gameplay") or {}
        seo_support = (grounded.get("seo_support") or {})
        investigation = state.get("investigation") or {}
        extracted_facts = ((investigation.get("best_match") or {}).get("extracted_facts") or {})
        return {
            "title": game_title,
            "description": article,
            "metadata": {
                "howToPlay": gameplay.get("how_to_play") or gameplay.get("controls") or "",
                "features": gameplay.get("features") or [],
                "tags": (seo_support.get("primary_keywords") or [])[:6],
                "seoKeywords": ", ".join((seo_support.get("primary_keywords") or [])[:10]),
                "developer": gameplay.get("developer") or extracted_facts.get("original_developer") or "",
                "platform": ["Browser"],
                "releaseDate": "",
            },
        }
