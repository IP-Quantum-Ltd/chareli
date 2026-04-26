class DraftContentNode:
    def __init__(self, content_drafting_service):
        self.scribe = content_drafting_service

    async def __call__(self, state):
        if state["status"] == "failed":
            return state
        best_match = state["investigation"]["best_match"]
        revision_feedback = (state.get("audit_report") or {}).get("revision_instructions") or []
        article = await self.scribe.draft_from_facts(
            state["game_title"],
            {
                "source_url": best_match["url"],
                "facts": best_match.get("extracted_facts") or {},
                "source_metadata": best_match.get("metadata") or {},
                "seo": state["seo_blueprint"],
                "grounded_context": state["grounded_context"],
                "content_plan": state["outline"],
                "revision_feedback": revision_feedback,
            },
        )
        state["accumulated_cost"] += self.scribe.last_cost
        state["article"] = article
        state["status"] = "complete"
        return state
