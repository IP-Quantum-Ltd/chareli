from app.workflows.ai_review_agent.context import record_stage


class CriticPlanNode:
    def __init__(self, content_critic_service, min_coverage_score: int = 70):
        self.critic = content_critic_service
        self.min_coverage_score = max(0, min(min_coverage_score, 100))

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
        approved = bool(validation.get("approved"))
        coverage_score = int(validation.get("coverage_score") or 0)
        if approved:
            state["status"] = "plan_approved"
            record_stage(state, "critic", "completed", "Content plan approved.")
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
        if coverage_score >= self.min_coverage_score and state["plan_revision_count"] >= state["max_plan_revisions"]:
            warning = (
                f"Stage 4 Critic requested more revisions, but the plan reached an acceptable coverage score of "
                f"{coverage_score}. Continuing with warnings."
            )
            state.setdefault("warnings", []).append(warning)
            state["status"] = "plan_approved_with_warnings"
            record_stage(state, "critic", "completed_with_warnings", warning)
        elif state["plan_revision_count"] > state["max_plan_revisions"]:
            state["status"] = "failed"
            state["error_message"] = "Stage 4 Critic rejected the content plan after the maximum revision attempts."
            record_stage(state, "critic", "failed", state["error_message"])
        else:
            state["status"] = "plan_revise"
            record_stage(state, "critic", "revision_requested", "Critic requested plan revisions.")
        return state
