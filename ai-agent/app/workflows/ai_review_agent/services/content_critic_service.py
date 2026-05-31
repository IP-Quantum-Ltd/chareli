import logging
from typing import Any, Dict, List

from langsmith import traceable

from app.domain.schemas.llm_outputs import ContentPlanValidationOutput
from app.infrastructure.llm.ai_executor import AIExecutor
from app.services.json_utils import json_dumps_safe
from app.services.prompt_compaction import compact_for_llm
from app.workflows.ai_review_agent.services.proposal_structure import CANONICAL_SECTIONS

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
        section_titles_list = [str(s.get("title", "")).strip() for s in sections if isinstance(s, dict)]
        section_titles_lower = [t.lower() for t in section_titles_list]
        revision_instructions = []

        # --- Structural compliance check ---
        missing_canonical: List[str] = []
        for required in CANONICAL_SECTIONS:
            if not any(required.lower() in t for t in section_titles_lower):
                missing_canonical.append(required)

        if missing_canonical:
            revision_instructions.append(
                f"The plan is missing the following required sections: {', '.join(missing_canonical)}. "
                f"All 5 sections must be present in this exact order: {', '.join(CANONICAL_SECTIONS)}."
            )

        # Check 'How to Play' and 'Controls' are distinct
        has_htp = any("how to play" in t for t in section_titles_lower)
        has_controls = any("controls" in t for t in section_titles_lower)
        if has_htp and has_controls:
            # Both present — good. Check they are not the same section.
            htp_goals = ""
            ctrl_goals = ""
            for s in sections:
                title_l = str(s.get("title", "")).lower()
                goals_text = " ".join(str(g) for g in (s.get("goals") or []))
                if "how to play" in title_l:
                    htp_goals = goals_text.lower()
                elif "controls" in title_l:
                    ctrl_goals = goals_text.lower()
            # If goals overlap heavily the sections are likely merged
            if htp_goals and ctrl_goals and len(set(htp_goals.split()) & set(ctrl_goals.split())) / max(len(set(htp_goals.split())), 1) > 0.6:
                revision_instructions.append(
                    "'How to Play' and 'Controls' sections have heavily overlapping goals. "
                    "How to Play must cover the gameplay loop/objectives only; "
                    "Controls must list only input keys/buttons."
                )
        elif not has_htp:
            revision_instructions.append("'How to Play' section is missing. It must describe the gameplay loop, objectives, and scoring.")
        elif not has_controls:
            revision_instructions.append("'Controls' section is missing. It must list all keyboard, mouse, and touch inputs.")

        # --- Fact coverage check ---
        missing_facts = []
        for fact in self._required_facts(grounded_context, seo_blueprint)[:12]:
            probe = fact.lower().split()[0]
            section_titles_str = " ".join(section_titles_lower)
            if probe and probe not in section_titles_str:
                missing_facts.append(fact)
        if missing_facts:
            revision_instructions.append("Add sections or goals that explicitly cover the missing required facts.")

        approved = not missing_canonical and len(missing_facts) <= 4
        return {
            "approved": approved,
            "coverage_score": max(0, min(100, 100 - (len(missing_canonical) * 20) - (len(missing_facts) * 8))),
            "missing_facts": missing_facts[:8],
            "missing_entities": (seo_blueprint.get("semantic_entities") or [])[:3] if missing_facts else [],
            "revision_instructions": revision_instructions,
            "reasoning": "Fallback validation: checked 5-section structure, How to Play/Controls distinctness, and grounded fact coverage.",
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
                        "You are the Stage 4 Content Critic for ArcadeBox. "
                        f"The content plan MUST include exactly these 5 sections in this order: {', '.join(CANONICAL_SECTIONS)}. "
                        "Reject any plan that omits, renames, or reorders them. "
                        "'How to Play' and 'Controls' must be SEPARATE sections — 'How to Play' covers the gameplay loop and "
                        "objectives; 'Controls' covers only input keys and buttons. "
                        "Reject plans that merge them. Also check grounded facts, user intent, and FAQ coverage. "
                        "Respond only with JSON."
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
