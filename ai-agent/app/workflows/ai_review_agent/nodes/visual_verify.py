class VisualVerifyNode:
    def __init__(self, visual_verification_service):
        self.visual_librarian = visual_verification_service

    async def __call__(self, state):
        if state["status"] == "failed":
            return state
        result = await self.visual_librarian.verify_and_research(
            proposal_id=state["proposal_id"],
            game_title=state["game_title"],
            internal_screenshots=state["internal_imgs_base64"],
        )
        state["accumulated_cost"] = float(state.get("accumulated_cost") or 0.0) + self.visual_librarian.last_cost
        if result["status"] == "failed":
            state["status"] = "failed"
            state["error_message"] = result.get("reason", "Stage 0 failed.")
        else:
            state["investigation"] = result
            state["status"] = "researched"
        return state
