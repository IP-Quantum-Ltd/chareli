class CriticPlanNode:
    def __init__(self, content_critic_service):
        self.critic = content_critic_service

    async def __call__(self, state):
        if state["status"] == "failed":
            return state
        validation = await self.critic.validate_outline(
            state["game_title"],
            state["outline"],
            state["grounded_context"],
            state["seo_blueprint"],
        )
        state["accumulated_cost"] = float(state.get("accumulated_cost") or 0.0) + self.critic.last_cost
        state["content_plan_validation"] = validation
        if validation.get("approved"):
            state["status"] = "plan_approved"
            return state
        state["plan_revision_count"] = int(state.get("plan_revision_count") or 0) + 1
        state.setdefault("revision_history", []).append(
            {
                "stage": "critic",
                "revision_count": state["plan_revision_count"],
                "instructions": validation.get("revision_instructions") or [],
                "reasoning": validation.get("reasoning", ""),
            }
        )
        if state["plan_revision_count"] > state["max_plan_revisions"]:
            state["status"] = "failed"
            state["error_message"] = "Stage 4 Critic rejected the content plan after the maximum revision attempts."
        else:
            state["status"] = "plan_revise"
        return state
