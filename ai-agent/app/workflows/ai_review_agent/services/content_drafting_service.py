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
                {"role": "system", "content": "You are a professional Content Creator for ArcadeBox. Respond with well-structured HTML using semantic tags: <h2>, <h3>, <p>, <ul>, <li>, <strong>, <em>, <blockquote>. No Markdown."},
                {"role": "user", "content": f"Task: Write a highly engaging, SEO-optimized guide for the game '{game_title}' on ArcadeBox.\n\nFact Sheet (The Ground Truth):\n{json_dumps_safe(compact_fact_sheet, indent=2)}\n\nRules:\n- The article must contain exactly four sections in this order: Overview, How to Play, Strategy, FAQ. Do not add, rename, or repeat any sections.\n- Controls and gameplay instructions belong only in the How to Play section. Do not repeat them in Overview, Strategy, or FAQ.\n- FAQ-style question and answer pairs belong only in the FAQ section at the end of the article. Do not include FAQ content in any other section.\n- Do not reproduce raw source content verbatim. Synthesise all facts into your own writing within the four sections.\n- Do not include any external URLs, links, or image references in the article.\n\nReturn the full HTML article (only the body content, no <html>/<body> tags)."},
            ],
            fallback_data=f"<h2>{game_title} Guide</h2>\n<p>[Drafting failed. Research data missing.]</p>",
        )
        self.last_cost = self.ai.last_cost
        return article
