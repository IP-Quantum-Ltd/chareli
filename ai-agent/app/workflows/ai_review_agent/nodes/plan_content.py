from app.workflows.ai_review_agent.context import record_stage


class PlanContentNode:
    def __init__(self, content_planning_service):
        self.architect = content_planning_service

    async def __call__(self, state):
        if state["status"] == "failed":
            return state
        best_match = state["investigation"]["best_match"]
        revision_feedback = (state.get("content_plan_validation") or {}).get("revision_instructions") or []
        outline = await self.architect.build_outline(
            state["game_title"],
            {
                "visual_description": best_match["reasoning"],
                "canonical_url": best_match["url"],
                "verified_facts": best_match.get("extracted_facts") or {},
                "source_metadata": best_match.get("metadata") or {},
                "seo_blueprint": state["seo_blueprint"],
                "grounded_context": state["grounded_context"],
                "revision_feedback": revision_feedback,
            },
        )
        state["accumulated_cost"] = float(state.get("accumulated_cost") or 0.0) + self.architect.last_cost
        state["outline"] = outline
        state["status"] = "architected"
        record_stage(state, "architect", "completed", "Structured content plan generated.")
        return state
