import logging

logger = logging.getLogger(__name__)


class GroundedRetrieveNode:
    def __init__(self, grounded_retrieval_service):
        self.librarian = grounded_retrieval_service

    async def __call__(self, state):
        if state["status"] == "failed":
            return state
        try:
            grounded_context = await self.librarian.build_grounded_context(
                state["game_title"],
                state["investigation"],
                state["seo_blueprint"],
            )
            state["accumulated_cost"] += self.librarian.last_cost
            state["grounded_context"] = grounded_context
            state["status"] = "grounded"
        except Exception as exc:
            logger.error("Librarian Stage Failed: %s", exc)
            state["status"] = "failed"
            state["error_message"] = f"CRITICAL: Stage 2 grounded retrieval failed. Detail: {exc}"
        return state
