import logging
from typing import Any, Dict, List

from langsmith import traceable

from app.domain.schemas.llm_outputs import ContentPlanValidationOutput
from app.infrastructure.llm.ai_executor import AIExecutor
from app.services.json_utils import json_dumps_safe
from app.services.prompt_compaction import compact_for_llm

logger = logging.getLogger(__name__)


class ContentCriticService:
    def __init__(self, ai: AIExecutor):
        self.ai = ai
        self.last_cost = 0.0

    def _required_facts(self, grounded_context: Dict[str, Any], seo_blueprint: Dict[str, Any]) -> List[str]:
        packet = grounded_context.get("grounded_packet") or {}
        grounded_gameplay = packet.get("grounded_gameplay") or {}
        facts = [
            grounded_gameplay.get("controls", ""),
            grounded_gameplay.get("rules", ""),
            grounded_gameplay.get("objective", ""),
            grounded_gameplay.get("how_to_play", ""),
            grounded_gameplay.get("developer", ""),
            grounded_gameplay.get("publisher", ""),
        ]
        facts.extend(seo_blueprint.get("semantic_entities") or [])
        return [str(fact).strip() for fact in facts if str(fact).strip()]

    def _fallback_validation(self, outline: Dict[str, Any], grounded_context: Dict[str, Any], seo_blueprint: Dict[str, Any]) -> Dict[str, Any]:
        sections = outline.get("sections") or []
        section_titles = " ".join(str(section.get("title", "")) for section in sections if isinstance(section, dict)).lower()
        missing = []
        for fact in self._required_facts(grounded_context, seo_blueprint)[:12]:
            probe = fact.lower().split()[0]
            if probe and probe not in section_titles:
                missing.append(fact)
        approved = bool(sections) and len(missing) <= 4
        revision_instructions = []
        if missing:
            revision_instructions.append("Add sections or subsection goals that explicitly cover the missing required facts.")
        if not any("faq" in str(section.get("title", "")).lower() for section in sections if isinstance(section, dict)):
            revision_instructions.append("Add an FAQ section to cover intent and SERP coverage.")
        return {
            "approved": approved,
            "coverage_score": max(0, min(100, 100 - (len(missing) * 12))),
            "missing_facts": missing[:8],
            "missing_entities": (seo_blueprint.get("semantic_entities") or [])[:3] if missing else [],
            "revision_instructions": revision_instructions,
            "reasoning": "Fallback validation based on outline section coverage against grounded facts and entity expectations.",
        }

    @traceable(run_type="chain", name="Content Plan Critic")
    async def validate_outline(
        self,
        game_title: str,
        outline: Dict[str, Any],
        grounded_context: Dict[str, Any],
        seo_blueprint: Dict[str, Any],
    ) -> Dict[str, Any]:
        fallback = self._fallback_validation(outline, grounded_context, seo_blueprint)
        compact_seo_blueprint = compact_for_llm(seo_blueprint, max_depth=4, max_list_items=6, max_dict_items=14, max_string_length=240)
        compact_grounded_context = compact_for_llm(grounded_context, max_depth=5, max_list_items=6, max_dict_items=16, max_string_length=240)
        compact_outline = compact_for_llm(outline, max_depth=4, max_list_items=10, max_dict_items=16, max_string_length=220)
        result = await self.ai.chat_completion(
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are the Stage 4 Critic for ArcadeBox. Reject plans that omit grounded facts, user intent, FAQ coverage, "
                        "or entity coverage. Respond only with JSON."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Task: Validate this content plan for '{game_title}'.\n"
                        f"SEO blueprint:\n{json_dumps_safe(compact_seo_blueprint, indent=2)}\n"
                        f"Grounded context:\n{json_dumps_safe(compact_grounded_context, indent=2)}\n"
                        f"Outline:\n{json_dumps_safe(compact_outline, indent=2)}\n"
                        "Return ONLY valid JSON with keys: approved, coverage_score, missing_facts, missing_entities, "
                        "revision_instructions, reasoning."
                    ),
                },
            ],
            response_format={"type": "json_object"},
            pydantic_schema=ContentPlanValidationOutput,
            fallback_data=fallback,
            metadata={"stage": "critic"},
        )
        self.last_cost = self.ai.last_cost
        return result
