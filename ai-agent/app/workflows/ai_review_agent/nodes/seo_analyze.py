from app.workflows.ai_review_agent.context import record_stage


class SeoAnalyzeNode:
    def __init__(self, seo_analysis_service):
        self.analyst = seo_analysis_service

    async def __call__(self, state):
        if state["status"] == "failed":
            return state
        blueprint = await self.analyst.analyze_seo_potential(state["game_title"], state["investigation"])
        state["accumulated_cost"] = float(state.get("accumulated_cost") or 0.0) + self.analyst.last_cost
        state["seo_blueprint"] = blueprint
        state["status"] = "analyzed"
        record_stage(state, "analyze", "completed", "SEO intelligence extracted.")
        return state
