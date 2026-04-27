from pathlib import Path
from typing import Optional

from app.config import RuntimeConfig, get_runtime_config
from app.infrastructure.browser.browser_session_factory import BrowserSessionFactory
from app.infrastructure.browser.external_capture import ExternalCaptureService
from app.infrastructure.browser.internal_capture import InternalCaptureService
from app.infrastructure.db.mongo_provider import MongoProvider
from app.infrastructure.db.postgres_provider import PostgresProvider
from app.infrastructure.db.repositories.game_repository import GameRepository
from app.infrastructure.external.arcade_api_client import ArcadeApiClient
from app.infrastructure.llm.client_factory import AIClientFactory
from app.infrastructure.storage.artifact_store import ArtifactStore
from app.services.job_store import InMemoryJobStore
from app.services.queue import InMemoryJobQueue
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
from app.workflows.ai_review_agent.services.content_auditor_service import ContentAuditorService
from app.workflows.ai_review_agent.services.content_drafting_service import ContentDraftingService
from app.workflows.ai_review_agent.services.content_critic_service import ContentCriticService
from app.workflows.ai_review_agent.services.content_planning_service import ContentPlanningService
from app.workflows.ai_review_agent.services.grounded_retrieval_service import GroundedRetrievalService
from app.workflows.ai_review_agent.services.proposal_context_builder import ProposalContextBuilder
from app.workflows.ai_review_agent.services.review_mapper import ReviewMapper
from app.workflows.ai_review_agent.services.seo_optimizer_service import SeoOptimizerService
from app.workflows.ai_review_agent.services.seo_analysis_service import SeoAnalysisService
from app.workflows.ai_review_agent.services.visual_correlation_service import VisualCorrelationService
from app.workflows.ai_review_agent.services.visual_search_service import VisualSearchService
from app.workflows.ai_review_agent.services.visual_verification_service import VisualVerificationService
from app.workflows.ai_review_agent.workflow import AiReviewAgentWorkflow


class ApplicationRuntime:
    def __init__(self, config: RuntimeConfig):
        self.config = config
        self.job_store = InMemoryJobStore(retention_hours=config.queue.job_retention_hours)
        self.queue = InMemoryJobQueue()
        self.postgres_provider = PostgresProvider(config.postgres)
        self.mongo_provider = MongoProvider(config.mongo)
        self.game_repository = GameRepository(self.postgres_provider)
        self.arcade_client = ArcadeApiClient(config.arcade_api)
        self.ai_factory = AIClientFactory(config.llm, config.observability)
        self.artifact_store = ArtifactStore(Path(__file__).resolve().parents[0])
        self.browser_factory = BrowserSessionFactory(config.browser)
        self.internal_capture = InternalCaptureService(config.browser, self.browser_factory, self.game_repository)
        self.external_capture = ExternalCaptureService(config.browser, self.browser_factory)

        self.visual_search = VisualSearchService(self.ai_factory.create_executor())
        self.visual_correlation = VisualCorrelationService()
        self.visual_verification = VisualVerificationService(
            ai=self.ai_factory.create_executor(),
            search_service=self.visual_search,
            correlation_service=self.visual_correlation,
            external_capture_service=self.external_capture,
            artifact_store=self.artifact_store,
            required_candidates=config.queue.stage0_required_candidates,
            max_search_results=config.queue.stage0_max_search_results,
            candidate_capture_timeout_seconds=config.queue.stage0_candidate_capture_timeout_seconds,
        )
        self.analyst = SeoAnalysisService(self.ai_factory.create_executor())
        self.librarian = GroundedRetrievalService(
            ai=self.ai_factory.create_executor(),
            postgres_provider=self.postgres_provider,
            mongo_provider=self.mongo_provider,
            mongo_config=config.mongo,
        )
        self.architect = ContentPlanningService(self.ai_factory.create_executor())
        self.critic = ContentCriticService(self.ai_factory.create_executor())
        self.scribe = ContentDraftingService(self.ai_factory.create_executor())
        self.auditor = ContentAuditorService(self.ai_factory.create_executor())
        self.optimizer = SeoOptimizerService(
            self.ai_factory.create_executor(),
            mongo_provider=self.mongo_provider,
            mongo_config=config.mongo,
        )

        self.agent_workflow = AiReviewAgentWorkflow(
            arcade_client=self.arcade_client,
            game_repository=self.game_repository,
            proposal_context_builder=ProposalContextBuilder(),
            review_mapper=ReviewMapper(),
            initialize_node=InitializeAgentNode(
                arcade_client=self.arcade_client,
                game_repository=self.game_repository,
                proposal_context_builder=ProposalContextBuilder(),
            ),
            capture_node=CaptureInternalAssetsNode(self.internal_capture, self.artifact_store),
            visual_verify_node=VisualVerifyNode(self.visual_verification),
            seo_analyze_node=SeoAnalyzeNode(self.analyst),
            grounded_retrieve_node=GroundedRetrieveNode(self.librarian),
            plan_content_node=PlanContentNode(self.architect),
            draft_content_node=DraftContentNode(self.scribe),
            critic_plan_node=CriticPlanNode(self.critic),
            audit_content_node=AuditContentNode(self.auditor),
            optimize_content_node=OptimizeContentNode(self.optimizer),
            max_plan_revisions=config.queue.max_plan_revisions,
            max_draft_revisions=config.queue.max_draft_revisions,
        )

    async def process_job(self, job_id: str) -> None:
        job = self.job_store.mark_running(job_id)
        if job is None:
            return
        try:
            if job.job_type == "game_review":
                result = await self.agent_workflow.run_game(job.target_id, submit_review=job.submit_review)
            else:
                result = await self.agent_workflow.run_proposal(job.target_id, submit_review=job.submit_review)
            if result.get("status") == "failed":
                self.job_store.mark_failed(job_id, result.get("error_message", "Job failed."), result=result)
            else:
                self.job_store.mark_completed(job_id, result)
        except Exception as exc:
            self.job_store.mark_failed(job_id, str(exc))
            raise

    async def shutdown(self) -> None:
        await self.mongo_provider.close()
        await self.postgres_provider.close()


_runtime: Optional[ApplicationRuntime] = None


def init_runtime(config: RuntimeConfig | None = None) -> ApplicationRuntime:
    global _runtime
    if _runtime is None:
        _runtime = ApplicationRuntime(config or get_runtime_config())
    return _runtime


def get_runtime() -> ApplicationRuntime:
    if _runtime is None:
        return init_runtime()
    return _runtime


async def shutdown_runtime() -> None:
    global _runtime
    if _runtime is not None:
        await _runtime.shutdown()
        _runtime = None
