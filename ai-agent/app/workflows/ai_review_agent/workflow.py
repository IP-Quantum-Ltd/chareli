import logging
from typing import Any, Awaitable, Callable

try:
    from langgraph.graph import END, StateGraph
except ModuleNotFoundError:  # pragma: no cover - exercised in lightweight test environments
    END = "__end__"
    StateGraph = None

try:
    from langsmith import traceable
except ModuleNotFoundError:  # pragma: no cover - exercised in lightweight test environments
    def traceable(*args: Any, **kwargs: Any) -> Callable[[Callable[..., Awaitable[Any]]], Callable[..., Awaitable[Any]]]:
        def decorator(func: Callable[..., Awaitable[Any]]) -> Callable[..., Awaitable[Any]]:
            return func

        return decorator

from app.infrastructure.external.arcade_api_client import ArcadeApiClient
from app.infrastructure.db.repositories.game_repository import GameRepository
from app.workflows.ai_review_agent.context import AgentState, build_initial_state
from app.workflows.ai_review_agent.nodes.audit_content import AuditContentNode
from app.workflows.ai_review_agent.nodes.capture_internal_assets import CaptureInternalAssetsNode
from app.workflows.ai_review_agent.nodes.critic_plan import CriticPlanNode
from app.workflows.ai_review_agent.nodes.draft_content import DraftContentNode
from app.workflows.ai_review_agent.nodes.grounded_retrieve import GroundedRetrieveNode
from app.workflows.ai_review_agent.nodes.initialize_agent import InitializeAgentNode
from app.workflows.ai_review_agent.nodes.optimize_content import OptimizeContentNode
from app.workflows.ai_review_agent.nodes.plan_content import PlanContentNode
from app.workflows.ai_review_agent.nodes.seo_analyze import SeoAnalyzeNode
from app.workflows.ai_review_agent.nodes.visual_verify import VisualVerifyNode
from app.workflows.ai_review_agent.services.proposal_context_builder import ProposalContextBuilder
from app.workflows.ai_review_agent.services.review_mapper import ReviewMapper

logger = logging.getLogger(__name__)


class _SequentialCompiledGraph:
    def __init__(self, workflow: "AiReviewAgentWorkflow"):
        self._workflow = workflow

    async def ainvoke(self, state: dict[str, Any]) -> dict[str, Any]:
        current_state = state
        while True:
            current_state = await self._workflow.initialize_node(current_state)
            if current_state["status"] == "failed":
                return current_state
            current_state = await self._workflow.capture_node(current_state)
            if current_state["status"] == "failed":
                return current_state
            current_state = await self._workflow.visual_verify_node(current_state)
            if current_state["status"] == "failed":
                return current_state
            current_state = await self._workflow.seo_analyze_node(current_state)
            if current_state["status"] == "failed":
                return current_state
            current_state = await self._workflow.grounded_retrieve_node(current_state)
            if current_state["status"] == "failed":
                return current_state
            while True:
                current_state = await self._workflow.plan_content_node(current_state)
                if current_state["status"] == "failed":
                    return current_state
                current_state = await self._workflow.critic_plan_node(current_state)
                if current_state["status"] == "failed":
                    return current_state
                if current_state["status"] != "plan_revise":
                    break
            while True:
                current_state = await self._workflow.draft_content_node(current_state)
                if current_state["status"] == "failed":
                    return current_state
                current_state = await self._workflow.audit_content_node(current_state)
                if current_state["status"] == "failed":
                    return current_state
                if current_state["status"] != "draft_revise":
                    break
            current_state = await self._workflow.optimize_content_node(current_state)
            return current_state


class AiReviewAgentWorkflow:
    def __init__(
        self,
        arcade_client: ArcadeApiClient,
        game_repository: GameRepository,
        proposal_context_builder: ProposalContextBuilder,
        review_mapper: ReviewMapper,
        initialize_node: InitializeAgentNode,
        capture_node: CaptureInternalAssetsNode,
        visual_verify_node: VisualVerifyNode,
        seo_analyze_node: SeoAnalyzeNode,
        grounded_retrieve_node: GroundedRetrieveNode,
        plan_content_node: PlanContentNode,
        draft_content_node: DraftContentNode,
        critic_plan_node: CriticPlanNode,
        audit_content_node: AuditContentNode,
        optimize_content_node: OptimizeContentNode,
        max_plan_revisions: int = 2,
        max_draft_revisions: int = 2,
    ):
        self.arcade_client = arcade_client
        self.game_repository = game_repository
        self.proposal_context_builder = proposal_context_builder
        self.review_mapper = review_mapper
        self.initialize_node = initialize_node
        self.capture_node = capture_node
        self.visual_verify_node = visual_verify_node
        self.seo_analyze_node = seo_analyze_node
        self.grounded_retrieve_node = grounded_retrieve_node
        self.plan_content_node = plan_content_node
        self.draft_content_node = draft_content_node
        self.critic_plan_node = critic_plan_node
        self.audit_content_node = audit_content_node
        self.optimize_content_node = optimize_content_node
        self.max_plan_revisions = max_plan_revisions
        self.max_draft_revisions = max_draft_revisions
        self.graph = self._build_graph()

    def _route_after_critic(self, state: dict[str, Any]) -> str:
        if state["status"] == "plan_revise":
            return "architect"
        if state["status"] == "plan_approved":
            return "scribe"
        return END

    def _route_after_initialize(self, state: dict[str, Any]) -> str:
        if state.get("status") == "failed":
            return END
        return "capture"

    def _route_after_auditor(self, state: dict[str, Any]) -> str:
        if state["status"] == "draft_revise":
            return "scribe"
        if state["status"] == "audited":
            return "optimizer"
        return END

    def _build_graph(self):
        if StateGraph is None:
            return _SequentialCompiledGraph(self)
        workflow = StateGraph(AgentState)
        workflow.add_node("initialize", self.initialize_node)
        workflow.add_node("capture", self.capture_node)
        workflow.add_node("research", self.visual_verify_node)
        workflow.add_node("analyze", self.seo_analyze_node)
        workflow.add_node("librarian", self.grounded_retrieve_node)
        workflow.add_node("architect", self.plan_content_node)
        workflow.add_node("critic", self.critic_plan_node)
        workflow.add_node("scribe", self.draft_content_node)
        workflow.add_node("auditor", self.audit_content_node)
        workflow.add_node("optimizer", self.optimize_content_node)
        workflow.set_entry_point("initialize")
        workflow.add_conditional_edges("initialize", self._route_after_initialize, {"capture": "capture", END: END})
        workflow.add_edge("capture", "research")
        workflow.add_edge("research", "analyze")
        workflow.add_edge("analyze", "librarian")
        workflow.add_edge("librarian", "architect")
        workflow.add_edge("architect", "critic")
        workflow.add_conditional_edges("critic", self._route_after_critic, {"architect": "architect", "scribe": "scribe", END: END})
        workflow.add_edge("scribe", "auditor")
        workflow.add_conditional_edges("auditor", self._route_after_auditor, {"scribe": "scribe", "optimizer": "optimizer", END: END})
        workflow.add_edge("optimizer", END)
        return workflow.compile()

    @traceable(run_type="chain", name="ArcadeBox SEO Pipeline")
    async def run_stages(self, payload: dict[str, Any]):
        initial_state = build_initial_state(
            proposal_id=str(payload.get("proposal_id", "") or ""),
            game_id=str(payload.get("game_id", "") or ""),
            submit_review=bool(payload.get("submit_review", False)),
            max_plan_revisions=self.max_plan_revisions,
            max_draft_revisions=self.max_draft_revisions,
        )
        final_state = await self.graph.ainvoke(initial_state)
        logger.info(
            "Pipeline finished with status: %s | Total Cost: $%.4f",
            final_state["status"],
            final_state["accumulated_cost"],
        )
        return final_state

    def _build_result_payload(self, final_state: dict[str, Any], review) -> dict[str, Any]:
        return {
            "game_id": final_state.get("game_id"),
            "game_title": final_state.get("game_title"),
            "status": final_state.get("status"),
            "error_message": final_state.get("error_message", ""),
            "recommendation": review.recommendation,
            "confidence_score": review.confidence_score,
            "metrics": review.metrics,
            "review": review.model_dump(exclude_none=True),
            "optimization": final_state.get("optimization") or {},
            "audit_report": final_state.get("audit_report") or {},
            "content_plan_validation": final_state.get("content_plan_validation") or {},
            "revision_history": final_state.get("revision_history") or [],
        }

    async def run_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        final_state = await self.run_stages(payload)
        review = self.review_mapper.build_review_from_state(final_state.get("game_title", ""), final_state)
        submit_review = bool(final_state.get("submit_review", payload.get("submit_review", False)))
        proposal_id = str(final_state.get("proposal_id") or payload.get("proposal_id") or "")
        game_id = str(final_state.get("game_id") or payload.get("game_id") or "")
        if submit_review and proposal_id and proposal_id != game_id:
            await self.arcade_client.submit_review(proposal_id, review.model_dump(exclude_none=True))
        logger.info(
            "[agent] Pipeline complete for context %s with recommendation '%s'",
            final_state.get("proposal_id") or final_state.get("game_id"),
            review.recommendation,
        )
        return self._build_result_payload(final_state, review)

    async def run_game(self, game_id: str, submit_review: bool = False) -> dict[str, Any]:
        logger.info("[agent] Starting pipeline for game %s", game_id)
        try:
            return await self.run_payload({"game_id": game_id, "submit_review": submit_review})
        except Exception as exc:
            logger.error("[agent] Pipeline failed for game %s: %s", game_id, exc, exc_info=True)
            review = self.review_mapper.build_failure_review(
                f"Visual-first verification failed before completion for game {game_id}: {exc}"
            )
            return {
                "game_id": game_id,
                "game_title": game_id,
                "status": "failed",
                "error_message": str(exc),
                "recommendation": review.recommendation,
                "confidence_score": review.confidence_score,
                "metrics": review.metrics,
                "review": review.model_dump(exclude_none=True),
            }

    async def run_proposal(self, proposal_id: str, submit_review: bool = True) -> dict[str, Any]:
        logger.info("[agent] Starting pipeline for proposal %s", proposal_id)
        try:
            return await self.run_payload({"proposal_id": proposal_id, "submit_review": submit_review})
        except Exception as exc:
            logger.error("[agent] Pipeline failed for proposal %s: %s", proposal_id, exc, exc_info=True)
            review = self.review_mapper.build_failure_review(
                f"Visual-first verification failed before completion for proposal {proposal_id}: {exc}"
            )
            if submit_review:
                await self.arcade_client.submit_review(proposal_id, review.model_dump(exclude_none=True))
            return {
                "game_id": "",
                "game_title": proposal_id,
                "status": "failed",
                "error_message": str(exc),
                "recommendation": review.recommendation,
                "confidence_score": review.confidence_score,
                "metrics": review.metrics,
                "review": review.model_dump(exclude_none=True),
            }
