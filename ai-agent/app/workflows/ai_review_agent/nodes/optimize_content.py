class OptimizeContentNode:
    def __init__(self, seo_optimizer_service):
        self.optimizer = seo_optimizer_service

    async def __call__(self, state):
        if state["status"] == "failed":
            return state
        optimization = await self.optimizer.optimize(
            state["game_id"],
            state["game_title"],
            state["article"],
            state["seo_blueprint"],
            state["outline"],
            state["audit_report"],
        )
        state["accumulated_cost"] = float(state.get("accumulated_cost") or 0.0) + self.optimizer.last_cost
        state["optimization"] = optimization
        state["status"] = "complete"
        return state
