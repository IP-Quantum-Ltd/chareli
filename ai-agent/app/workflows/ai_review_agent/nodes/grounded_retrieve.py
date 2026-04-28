import logging

from app.workflows.ai_review_agent.context import record_stage

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
            state["accumulated_cost"] = float(state.get("accumulated_cost") or 0.0) + self.librarian.last_cost
            state["grounded_context"] = grounded_context
            state["status"] = "grounded"
            warnings = grounded_context.get("warnings") or []
            if warnings:
                state.setdefault("warnings", []).extend(warnings)
            stage_status = "completed_with_warnings" if warnings else "completed"
            record_stage(state, "librarian", stage_status, "Grounded context packet built.")
        except Exception as exc:
            logger.error("Librarian Stage Failed: %s", exc)
            state["status"] = "failed"
            state["error_message"] = f"CRITICAL: Stage 2 grounded retrieval failed. Detail: {exc}"
            record_stage(state, "librarian", "failed", state["error_message"])
        return state
