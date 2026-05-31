import logging
from typing import Any, Dict

from langsmith import traceable

from app.domain.schemas.llm_outputs import ContentPlanOutput
from app.infrastructure.llm.ai_executor import AIExecutor
from app.services.json_utils import json_dumps_safe
from app.services.prompt_compaction import compact_for_llm
from app.workflows.ai_review_agent.services.proposal_structure import (
    CANONICAL_SECTIONS,
    SECTION_GOALS,
)

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

        # Build per-section goals block for the prompt
        goals_block = "\n".join(
            f"  {name}:\n" + "\n".join(f"    - {g}" for g in SECTION_GOALS[name])
            for name in CANONICAL_SECTIONS
        )

        # Build the canonical JSON schema hint
        sections_schema = ", ".join(
            f'{{"title": "{name}", "goals": ["string"]}}'
            for name in CANONICAL_SECTIONS
        )

        result = await self.ai.chat_completion(
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a Content Architect specialising in gaming SEO for ArcadeBox. "
                        f"You MUST return exactly {len(CANONICAL_SECTIONS)} sections in this exact order: "
                        f"{', '.join(CANONICAL_SECTIONS)}. "
                        "Each section must cover ONLY its own unique topic — never combine, rename, or skip sections. "
                        "How to Play and Controls are DIFFERENT sections and must never be merged. "
                        "Respond only with JSON."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Task: Design a Content Plan for a high-ranking SEO guide on '{game_title}'.\n"
                        f"Research Verification:\n{json_dumps_safe(compact_research_data, indent=2)}\n\n"
                        f"Per-section writing goals:\n{goals_block}\n\n"
                        "Return ONLY valid JSON:\n"
                        f'{{"sections": [{sections_schema}], '
                        '"estimated_word_count": int, "formatting_requirements": ["list"]}'
                    ),
                },
            ],
            response_format={"type": "json_object"},
            pydantic_schema=ContentPlanOutput,
            fallback_data={
                "sections": [
                    {"title": name, "goals": SECTION_GOALS[name]}
                    for name in CANONICAL_SECTIONS
                ],
                "estimated_word_count": 700,
                "formatting_requirements": [
                    "Use H2 headers for each of the 5 sections",
                    "FAQ must use H3 title + H4 Q: headings + P answers",
                    "No section content may repeat in another section",
                ],
            },
        )
        self.last_cost = self.ai.last_cost
        return result
