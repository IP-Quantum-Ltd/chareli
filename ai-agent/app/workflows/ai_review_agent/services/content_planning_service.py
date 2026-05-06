import logging
from typing import Any, Dict

from langsmith import traceable

from app.domain.schemas.llm_outputs import ContentPlanOutput
from app.infrastructure.llm.ai_executor import AIExecutor
from app.services.json_utils import json_dumps_safe
from app.services.prompt_compaction import compact_for_llm

logger = logging.getLogger(__name__)


class ContentPlanningService:
    def __init__(self, ai: AIExecutor):
        self.ai = ai
        self.last_cost = 0.0
        self.logger = logging.getLogger(self.__class__.__name__)

    @traceable(run_type="chain", name="Content Architecture Planning")
    async def build_outline(self, game_title: str, research_data: Dict[str, Any]) -> Dict[str, Any]:
        self.logger.info("Architect designing content plan for: %s", game_title)
        compact_research_data = compact_for_llm(
            research_data,
            max_depth=5,
            max_list_items=6,
            max_dict_items=16,
            max_string_length=280,
        )
        result = await self.ai.chat_completion(
            messages=[
                {"role": "system", "content": "You are a Content Architect specializing in gaming SEO. Respond only with JSON."},
                {"role": "user", "content": f"""Task: Design a Content Plan for a high-ranking SEO guide on '{game_title}'. Research Verification: {json_dumps_safe(compact_research_data, indent=2)}
Return ONLY valid JSON:
{{"sections": [{{"title": "Overview", "goals": ["string"]}}, {{"title": "Controls", "goals": ["string"]}}, {{"title": "Strategy", "goals": ["string"]}}, {{"title": "FAQ", "goals": ["string"]}}], "estimated_word_count": int, "formatting_requirements": ["list"]}}"""},
            ],
            response_format={"type": "json_object"},
            pydantic_schema=ContentPlanOutput,
            fallback_data={"sections": [{"title": "Introduction", "goals": ["Engage user"]}], "estimated_word_count": 500, "formatting_requirements": ["Use H2 headers"]},
        )
        self.last_cost = self.ai.last_cost
        return result
