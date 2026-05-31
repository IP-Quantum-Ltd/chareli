import logging
from typing import Any, Dict

from langsmith import traceable

from app.infrastructure.llm.ai_executor import AIExecutor
from app.services.json_utils import json_dumps_safe
from app.services.prompt_compaction import compact_for_llm
from app.workflows.ai_review_agent.services.proposal_structure import (
    CANONICAL_SECTIONS,
    SECTION_GOALS,
)

logger = logging.getLogger(__name__)


class ContentDraftingService:
    def __init__(self, ai: AIExecutor):
        self.ai = ai
        self.last_cost = 0.0
        self.logger = logging.getLogger(self.__class__.__name__)

    @traceable(run_type="chain", name="Final Content Drafting")
    async def draft_from_facts(self, game_title: str, fact_sheet: Dict[str, Any]) -> str:
        self.logger.info("Scribe drafting article for: %s", game_title)
        compact_fact_sheet = compact_for_llm(
            fact_sheet,
            max_depth=5,
            max_list_items=8,
            max_dict_items=18,
            max_string_length=260,
        )

        # Build the per-section instruction block
        section_instructions = "\n".join(
            f"  <h2>{name}</h2>:\n" + "\n".join(f"    - {g}" for g in SECTION_GOALS[name])
            for name in CANONICAL_SECTIONS
        )

        system_prompt = (
            "You are a professional Content Writer for ArcadeBox \u2014 a browser-based gaming platform. "
            f"You MUST write exactly {len(CANONICAL_SECTIONS)} sections in this exact order, each opened "
            f"with its <h2> heading: "
            + ", ".join(f"<h2>{s}</h2>" for s in CANONICAL_SECTIONS)
            + ". "
            "CRITICAL RULES:\n"
            "1. STRUCTURE: Do not skip, rename, combine, or reorder any section.\n"
            "2. NO REPETITION: Each section must cover ONLY its own unique topic. Do not repeat facts, "
            "phrases, or sentences across sections. If something is covered in Overview, it must NOT appear "
            "in How to Play, Controls, Strategy, or FAQ.\n"
            "3. NO TRADEMARKS: Never mention competitor brand names, trademarks, IP titles, or other game "
            "franchise names by name. Describe mechanics generically (e.g. 'collect power-ups' not "
            "'like in [Brand]'). This includes game names, character names, and publisher/developer brands "
            "that do not belong to this game.\n"
            "4. NO HALLUCINATION: Only write facts explicitly present in the Fact Sheet. If a detail is "
            "unknown, write 'not publicly specified' rather than inventing it.\n"
            "5. FAQ FORMAT: The FAQ section must use exactly this HTML structure \u2014 "
            "<h3>[Game Name] FAQ</h3> then for each item: <h4>Q: [question]</h4><p>[answer]</p>. "
            "FAQ questions must address what a real player asks AFTER reading the first 4 sections \u2014 "
            "never repeat content already covered above.\n"
            "6. HTML ONLY: Respond with body HTML only. Use <h2>, <h3>, <h4>, <p>, <ul>, <li>, "
            "<strong>, <em>. No Markdown, no <html>/<body> wrapper tags, no external URLs or links."
        )

        user_prompt = (
            f"Task: Write the complete 5-section ArcadeBox guide for '{game_title}'.\n\n"
            f"Fact Sheet (ground truth \u2014 do not invent facts beyond this):\n"
            f"{json_dumps_safe(compact_fact_sheet, indent=2)}\n\n"
            f"Section-by-section writing goals:\n{section_instructions}\n\n"
            "Remember:\n"
            f"- Start with <h2>Overview</h2> and end with <h2>FAQ</h2>.\n"
            "- No content from one section may appear in another.\n"
            "- No brand names, trademarks, or competitor game titles.\n"
            "- FAQ questions must be unique, creative, and not repeat content from the 4 sections above.\n"
            "Return the full article HTML now."
        )

        fallback = (
            f"<h2>Overview</h2>\n<p>{game_title} is an exciting browser game available on ArcadeBox.</p>\n"
            f"<h2>How to Play</h2>\n<p>Use the on-screen instructions to play {game_title}.</p>\n"
            f"<h2>Controls</h2>\n<ul><li>Use your keyboard or mouse to control the game.</li></ul>\n"
            f"<h2>Strategy</h2>\n<p>Focus on the core objectives to achieve a high score.</p>\n"
            f"<h2>FAQ</h2>\n<h3>{game_title} FAQ</h3>\n"
            f"<h4>Q: Is {game_title} free to play?</h4><p>Yes, it is free on ArcadeBox.</p>\n"
        )

        article = await self.ai.chat_completion(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            fallback_data=fallback,
        )
        self.last_cost = self.ai.last_cost
        return article
