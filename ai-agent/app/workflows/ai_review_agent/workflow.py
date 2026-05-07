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
from app.workflows.ai_review_agent.context import AgentState, build_initial_state, ensure_state_defaults
from app.workflows.ai_review_agent.nodes.audit_content import AuditContentNode
from app.workflows.ai_review_agent.nodes.capture_internal_assets import CaptureInternalAssetsNode
from app.workflows.ai_review_agent.nodes.critic_plan import CriticPlanNode
from app.workflows.ai_review_agent.nodes.draft_content import DraftContentNode
from app.workflows.ai_review_agent.nodes.finalize_result import FinalizeResultNode
from app.workflows.ai_review_agent.nodes.format_proposed_data import FormatProposedDataNode
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

    async def _finalize(self, state: dict[str, Any]) -> dict[str, Any]:
        state = await self._workflow.format_proposed_data_node(state)
        return await self._workflow.finalize_result_node(state)

    async def ainvoke(self, state: dict[str, Any]) -> dict[str, Any]:
        current_state = ensure_state_defaults(state)
        while True:
            current_state = await self._workflow.initialize_node(current_state)
            if current_state["status"] == "failed":
                return await self._finalize(current_state)
            current_state = await self._workflow.capture_node(current_state)
            if current_state["status"] == "failed":
                return await self._finalize(current_state)
            current_state = await self._workflow.visual_verify_node(current_state)
            if current_state["status"] == "failed":
                return await self._finalize(current_state)
            current_state = await self._workflow.seo_analyze_node(current_state)
            if current_state["status"] == "failed":
                return await self._finalize(current_state)
            current_state = await self._workflow.grounded_retrieve_node(current_state)
            if current_state["status"] == "failed":
                return await self._finalize(current_state)
            while True:
                current_state = await self._workflow.plan_content_node(current_state)
                if current_state["status"] == "failed":
                    return await self._finalize(current_state)
                current_state = await self._workflow.critic_plan_node(current_state)
                if current_state["status"] == "failed":
                    return await self._finalize(current_state)
                if current_state["status"] != "plan_revise":
                    break
            while True:
                current_state = await self._workflow.draft_content_node(current_state)
                if current_state["status"] == "failed":
                    return await self._finalize(current_state)
                current_state = await self._workflow.audit_content_node(current_state)
                if current_state["status"] == "failed":
                    return await self._finalize(current_state)
                if current_state["status"] != "draft_revise":
                    break
            current_state = await self._workflow.optimize_content_node(current_state)
            return await self._finalize(current_state)


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
        format_proposed_data_node: FormatProposedDataNode,
        finalize_result_node: FinalizeResultNode,
        max_plan_revisions: int = 2,
        max_draft_revisions: int = 2,
        max_pipeline_retries: int = 3,
        pipeline_data_completeness_threshold: int = 65,
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
        self.format_proposed_data_node = format_proposed_data_node
        self.finalize_result_node = finalize_result_node
        self.max_plan_revisions = max_plan_revisions
        self.max_draft_revisions = max_draft_revisions
        self.max_pipeline_retries = max_pipeline_retries
        self.pipeline_data_completeness_threshold = pipeline_data_completeness_threshold / 100.0
        self.graph = self._build_graph()

    def _route_after_critic(self, state: dict[str, Any]) -> str:
        if state["status"] == "plan_revise":
            return "architect"
        if state["status"] in {"plan_approved", "plan_approved_with_warnings"}:
            return "scribe"
        if state["status"] == "failed":
            return "format"
        return END

    def _route_after_initialize(self, state: dict[str, Any]) -> str:
        if state.get("status") == "failed":
            return "format"
        return "capture"

    def _route_after_auditor(self, state: dict[str, Any]) -> str:
        if state["status"] == "draft_revise":
            return "scribe"
        if state["status"] in {"audited", "audited_with_warnings"}:
            return "optimizer"
        if state["status"] == "failed":
            return "format"
        return END

    def _route_after_stage(self, state: dict[str, Any], success_target: str) -> str:
        if state.get("status") == "failed":
            return "format"
        return success_target

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
        workflow.add_node("format", self.format_proposed_data_node)
        workflow.add_node("finalize", self.finalize_result_node)
        workflow.set_entry_point("initialize")
        workflow.add_conditional_edges("initialize", self._route_after_initialize, {"capture": "capture", "format": "format", END: END})
        workflow.add_conditional_edges("capture", lambda state: self._route_after_stage(state, "research"), {"research": "research", "format": "format"})
        workflow.add_conditional_edges("research", lambda state: self._route_after_stage(state, "analyze"), {"analyze": "analyze", "format": "format"})
        workflow.add_conditional_edges("analyze", lambda state: self._route_after_stage(state, "librarian"), {"librarian": "librarian", "format": "format"})
        workflow.add_conditional_edges("librarian", lambda state: self._route_after_stage(state, "architect"), {"architect": "architect", "format": "format"})
        workflow.add_conditional_edges("architect", lambda state: self._route_after_stage(state, "critic"), {"critic": "critic", "format": "format"})
        workflow.add_conditional_edges("critic", self._route_after_critic, {"architect": "architect", "scribe": "scribe", "format": "format", END: END})
        workflow.add_conditional_edges("scribe", lambda state: self._route_after_stage(state, "auditor"), {"auditor": "auditor", "format": "format"})
        workflow.add_conditional_edges("auditor", self._route_after_auditor, {"scribe": "scribe", "optimizer": "optimizer", "format": "format", END: END})
        workflow.add_edge("optimizer", "format")
        workflow.add_edge("format", "finalize")
        workflow.add_edge("finalize", END)
        return workflow.compile()

    async def _submit_proposal(self, final_state: dict[str, Any]) -> None:
        """Try updating the existing PENDING proposal; fall back to creating a new one."""
        proposal_id = final_state.get("proposal_id") or ""
        game_id = final_state.get("game_id") or ""
        proposed_game_data = final_state.get("proposed_game_data") or {}
        review = final_state.get("review") or {}
        seo_meta = final_state.get("seo_meta") or {}

        # Case 1: existing proposal (not same as game_id) — try PUT /game-proposals/:id
        if proposal_id and proposal_id != game_id:
            try:
                await self.arcade_client.submit_review(proposal_id, review, proposed_game_data, seo_meta)
                logger.info("[workflow] Updated proposal %s with enriched data", proposal_id)
                return
            except Exception as exc:
                logger.warning("[workflow] Could not update proposal %s (%s) — will create new proposal", proposal_id, exc)

        # Case 2: game_review run OR existing proposal not PENDING — create via game endpoint
        if not game_id:
            logger.warning("[workflow] No game_id — cannot create fallback proposal")
            return
        try:
            new_proposal = await self.arcade_client.create_game_proposal(game_id, proposed_game_data)
            new_proposal_id = (new_proposal or {}).get("id") or ""
            logger.info("[workflow] Created new proposal %s for game %s", new_proposal_id, game_id)
            if new_proposal_id:
                await self.arcade_client.submit_review(new_proposal_id, review, {}, seo_meta)
                logger.info("[workflow] Attached aiReview to new proposal %s", new_proposal_id)
        except Exception as exc:
            logger.warning("[workflow] Failed to create proposal for game %s: %s", game_id, exc)

    @staticmethod
    def _data_completeness(proposed_game_data: dict[str, Any]) -> float:
        if not proposed_game_data:
            return 0.0
        meta = proposed_game_data.get("metadata") or {}
        checks = {
            "description": len((proposed_game_data.get("description") or "").strip()) > 100,
            "howToPlay": len((meta.get("howToPlay") or "").strip()) > 50,
            "faqOverride": len((meta.get("faqOverride") or "").strip()) > 50,
            "features": len(meta.get("features") or []) >= 2,
            "tags": len(meta.get("tags") or []) >= 2,
            "seoKeywords": bool((meta.get("seoKeywords") or "").strip()),
            "developer": bool((meta.get("developer") or "").strip()),
            "platform": bool(meta.get("platform")),
        }
        return sum(checks.values()) / len(checks)

    @traceable(run_type="chain", name="ArcadeBox SEO Pipeline")
    async def run_stages(self, payload: dict[str, Any]):
        submit_review = bool(payload.get("submit_review", False))
        base_payload = {
            "proposal_id": str(payload.get("proposal_id", "") or ""),
            "game_id": str(payload.get("game_id", "") or ""),
            "submit_review": False,  # never submit inside the pipeline
        }
        final_state: dict[str, Any] = {}
        passed = False
        for attempt in range(1, self.max_pipeline_retries + 1):
            initial_state = build_initial_state(
                **base_payload,
                max_plan_revisions=self.max_plan_revisions,
                max_draft_revisions=self.max_draft_revisions,
            )
            ensure_state_defaults(initial_state)
            final_state = await self.graph.ainvoke(initial_state)
            score = self._data_completeness(final_state.get("proposed_game_data") or {})
            logger.info(
                "Pipeline attempt %d/%d | status: %s | data completeness: %.0f%% | cost: $%.4f",
                attempt, self.max_pipeline_retries,
                final_state["status"], score * 100, final_state["accumulated_cost"],
            )
            if score >= self.pipeline_data_completeness_threshold:
                passed = True
                break
            if attempt < self.max_pipeline_retries:
                logger.warning(
                    "Data completeness %.0f%% below threshold %.0f%% — retrying pipeline (attempt %d/%d)",
                    score * 100, self.pipeline_data_completeness_threshold * 100,
                    attempt, self.max_pipeline_retries,
                )
            else:
                logger.warning(
                    "Max retries reached. Data completeness %.0f%% never reached %.0f%% threshold — proposal NOT submitted",
                    score * 100, self.pipeline_data_completeness_threshold * 100,
                )

        if passed and submit_review:
            await self._submit_proposal(final_state)
        elif not passed and submit_review:
            logger.warning("[workflow] Skipping proposal submission — data completeness insufficient after all retries")

        return final_state

    def _build_result_payload(self, final_state: dict[str, Any], review) -> dict[str, Any]:
        finalized_payload = final_state.get("result_payload")
        if isinstance(finalized_payload, dict) and finalized_payload:
            return finalized_payload
        return {
            "game_id": final_state.get("game_id"),
            "game_title": final_state.get("game_title"),
            "status": final_state.get("status"),
            "current_stage": final_state.get("current_stage"),
            "error_message": final_state.get("error_message", ""),
            "recommendation": review.recommendation,
            "confidence_score": review.confidence_score,
            "metrics": review.metrics,
            "review": review.model_dump(exclude_none=True),
            "proposed_game_data": final_state.get("proposed_game_data") or {},
            "optimization": final_state.get("optimization") or {},
            "final_article": final_state.get("article") or "",
            "audit_report": final_state.get("audit_report") or {},
            "content_plan_validation": final_state.get("content_plan_validation") or {},
            "revision_history": final_state.get("revision_history") or [],
            "warnings": final_state.get("warnings") or [],
            "stage_trace": final_state.get("stage_trace") or [],
        }

    async def run_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        final_state = await self.run_stages(payload)
        review = self.review_mapper.build_review_from_state(final_state.get("game_title", ""), final_state)
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
