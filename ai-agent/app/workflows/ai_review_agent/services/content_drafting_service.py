import logging
from typing import Any, Dict

from langsmith import traceable

from app.infrastructure.llm.ai_executor import AIExecutor
from app.services.json_utils import json_dumps_safe

logger = logging.getLogger(__name__)


class ContentDraftingService:
    def __init__(self, ai: AIExecutor):
        self.ai = ai
        self.last_cost = 0.0
        self.logger = logging.getLogger(self.__class__.__name__)

    @traceable(run_type="chain", name="Final Content Drafting")
    async def draft_from_facts(self, game_title: str, fact_sheet: Dict[str, Any]) -> str:
        self.logger.info("Scribe drafting article for: %s", game_title)
        article = await self.ai.chat_completion(
            messages=[
                {"role": "system", "content": "You are a professional Content Creator for ArcadeBox. Respond with high-quality Markdown."},
                {"role": "user", "content": f"Task: Write a highly engaging, SEO-optimized guide for the game '{game_title}' on ArcadeBox.\n\nFact Sheet (The Ground Truth):\n{json_dumps_safe(fact_sheet, indent=2)}\n\nReturn the full Markdown article."},
            ],
            fallback_data=f"# {game_title} Guide\n\n[Drafting failed. Research data missing.]",
        )
        self.last_cost = self.ai.last_cost
        return article
