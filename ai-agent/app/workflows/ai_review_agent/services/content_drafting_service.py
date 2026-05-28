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
                {"role": "user", "content": f"""Task: Write a highly engaging, SEO-optimized guide for the game '{game_title}' on ArcadeBox.\n\nFact Sheet (The Ground Truth):\n{json_dumps_safe(compact_fact_sheet, indent=2)}\n\nRules:\n- The article must contain exactly five sections in this order: Overview, How to Play, Controls, Strategy, FAQ. Do not add, rename, or repeat any sections.\n- Be concise. Each section covers only its own scope — do not restate facts from other sections.\n- Overview: describe what the game IS — genre, setting, and core appeal only. Do not include how to do well, tactical advice, or anything that belongs in Strategy. No controls, no tips, no FAQ.\n- How to Play: explain the concrete mechanics of the game — how the core gameplay loop works, what resources or currency exist, how waves or levels are structured, and what actions the player takes to progress. Use bullet points for clarity. No control schemes.\n- Controls: list only confirmed control inputs for PC and mobile/touch. Do not use hedging language such as 'may be used', 'if applicable', or 'possibly' — if a control is not confirmed, omit it entirely. No objectives or tips.\n- Strategy: tips and tactics only. Do not repeat anything already stated in Overview. No controls, no objectives, no FAQ.\n- FAQ: each question must cover something not already explained in Overview, How to Play, Controls, or Strategy — if the answer exists in any other section, skip the question entirely. Every question in the FAQ must be unique — no two questions should address the same topic or overlap in substance. Answers must not restate controls, objectives, mechanics, or strategy tips already written above. Focus on edge cases, compatibility, multiplayer vs solo, progression, what happens when something goes wrong, age/accessibility suitability. Do not introduce game concepts (e.g. power-ups, modes) in FAQ that are not mentioned in at least one other section. Format each FAQ entry as <h4>Q: question text</h4><p>A: answer text</p> — do not use blockquote or h3 for FAQ entries.\n- Do not mention other games, game titles, developers, platforms, or external websites anywhere in the article.\n- Do not reproduce raw source content verbatim. Synthesise all facts.\n- Do not include any external URLs, links, or image references.\n\nReturn the full HTML article (only the body content, no <html>/<body> tags)."""},
            ],
            fallback_data=f"<h2>{game_title} Guide</h2>\n<p>[Drafting failed. Research data missing.]</p>",
        )
        self.last_cost = self.ai.last_cost
        return article
