from app.workflows.ai_review_agent.context import record_stage


class VisualVerifyNode:
    def __init__(self, visual_verification_service):
        self.visual_librarian = visual_verification_service

    async def __call__(self, state):
        if state["status"] == "failed":
            return state
        result = await self.visual_librarian.verify_and_research(
            proposal_id=state["proposal_id"],
            game_title=state["game_title"],
            internal_screenshots=state["internal_imgs_urls"],
        )
        state["accumulated_cost"] = float(state.get("accumulated_cost") or 0.0) + self.visual_librarian.last_cost
        if result["status"] == "failed":
            state["status"] = "failed"
            state["error_message"] = result.get("reason", "Stage 0 failed.")
            record_stage(state, "research", "failed", state["error_message"])
        else:
            state["investigation"] = result
            warnings = result.get("warnings") or []
            if warnings:
                state.setdefault("warnings", []).extend(warnings)
            state["status"] = "researched"
            best_match = (result.get("best_match") or {}).get("url", "")
            tier = result.get("confidence_tier", "")
            detail = f"Best match: {best_match}"
            if tier:
                detail += f" | confidence tier: {tier}"
            record_stage(state, "research", "completed", detail)
        return state
