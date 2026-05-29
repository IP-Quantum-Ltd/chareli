import logging
from typing import Any, Dict

from langsmith import traceable

from app.infrastructure.llm.ai_executor import AIExecutor
from app.services.json_utils import json_dumps_safe
from app.services.prompt_compaction import compact_for_llm

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
        article = await self.ai.chat_completion(
            messages=[
                {"role": "system", "content": "You are a professional Content Creator for ArcadeBox. Respond with well-structured HTML using semantic tags: <h2>, <h3>, <p>, <ul>, <li>, <strong>, <em>. No Markdown. Each section must begin with its exact <h2> heading: <h2>Overview</h2>, <h2>How to Play</h2>, <h2>Controls</h2>, <h2>Strategy</h2>, <h2>FAQ</h2>. Do not add any other <h2> tags such as the game title."},
                {"role": "user", "content": f"""Task: Write a highly engaging, SEO-optimized guide for the game '{game_title}' on ArcadeBox.\n\nFact Sheet (The Ground Truth):\n{json_dumps_safe(compact_fact_sheet, indent=2)}\n\nRules:\n- The article must contain exactly five sections in this order: Overview, How to Play, Controls, Strategy, FAQ. Do not add, rename, or repeat any sections.\n- MOST IMPORTANT RULE — zero repeated content across sections: before writing each section, mentally review every section already written above it and ensure not a single sentence, fact, mechanic, key binding, tip, or answer is restated. Each section must contain only content that has not appeared anywhere earlier in the article.\n- Overview: describe what the game IS — genre, setting, and core appeal only. Do not include gameplay instructions, control schemes, tactical advice, or FAQ content.\n- How to Play: explain the gameplay loop and objectives only — what the player is trying to achieve, how rounds or levels are structured, what resources or scoring exist, and what happens when they succeed or fail. Use bullet points. Do not mention any specific keys, buttons, mouse actions, or touch gestures — those belong exclusively in Controls. Do not repeat anything from Overview.\n- Controls: list only confirmed control inputs for PC and mobile/touch. Do not use hedging language such as 'may be used', 'if applicable', or 'possibly' — if a control is not confirmed, omit it entirely. Do not repeat objectives, mechanics, or any content from Overview or How to Play.\n- Strategy: tips and tactics only. Do not repeat anything from Overview, How to Play, or Controls — if a tip requires restating a mechanic or control, skip it.\n- FAQ: before writing each question, check whether the answer is already covered in Overview, How to Play, Controls, or Strategy — if it is, skip the question entirely. Every question must be unique with no overlap in substance. Focus on edge cases, compatibility, multiplayer vs solo, progression, accessibility. Do not introduce game concepts not mentioned in at least one earlier section. Format as <h4>Q: question text</h4><p>A: answer text</p> only.\n- Do not mention other games, game titles, developers, platforms, or external websites anywhere in the article.\n- Do not reproduce raw source content verbatim. Synthesise all facts.\n- Do not include any external URLs, links, or image references.\n\nReturn the full HTML article (only the body content, no <html>/<body> tags)."""},
            ],
            fallback_data=f"<h2>{game_title} Guide</h2>\n<p>[Drafting failed. Research data missing.]</p>",
        )
        self.last_cost = self.ai.last_cost
        return article
