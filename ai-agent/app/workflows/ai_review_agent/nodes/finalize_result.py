import logging
from typing import Any, Awaitable, Callable

try:
    from langsmith import traceable
except ModuleNotFoundError:  # pragma: no cover
    def traceable(*args: Any, **kwargs: Any) -> Callable[[Callable[..., Awaitable[Any]]], Callable[..., Awaitable[Any]]]:
        def decorator(func: Callable[..., Awaitable[Any]]) -> Callable[..., Awaitable[Any]]:
            return func
        return decorator

from app.workflows.ai_review_agent.context import record_stage

logger = logging.getLogger(__name__)


class FinalizeResultNode:
    def __init__(self, review_mapper):
        self.review_mapper = review_mapper

    @traceable(run_type="chain", name="Finalize Agent Result")
    async def __call__(self, state):
        game_title = state.get("game_title") or state.get("game_id") or state.get("proposal_id") or ""
        review = self.review_mapper.build_review_from_state(game_title, state)
        state["review"] = review.model_dump(exclude_none=True)
        state["result_payload"] = {
            "game_id": state.get("game_id"),
            "game_title": state.get("game_title"),
            "status": state.get("status"),
            "current_stage": state.get("current_stage"),
            "error_message": state.get("error_message", ""),
            "recommendation": review.recommendation,
            "confidence_score": review.confidence_score,
            "metrics": review.metrics,
            "review": state["review"],
            "proposed_game_data": state.get("proposed_game_data") or {},
            "optimization": state.get("optimization") or {},
            "final_article": state.get("article") or "",
            "audit_report": state.get("audit_report") or {},
            "content_plan_validation": state.get("content_plan_validation") or {},
            "revision_history": state.get("revision_history") or [],
            "warnings": state.get("warnings") or [],
            "stage_trace": state.get("stage_trace") or [],
        }
        record_stage(
            state,
            "finalize",
            "completed" if state.get("status") != "failed" else "failed",
            f"Recommendation: {review.recommendation}",
        )
        return state
