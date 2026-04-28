import unittest
from unittest.mock import AsyncMock

from app.workflows.ai_review_agent.services.proposal_context_builder import ProposalContextBuilder
from app.workflows.ai_review_agent.services.review_mapper import ReviewMapper
from app.workflows.ai_review_agent.workflow import AiReviewAgentWorkflow


class ProposalPipelineServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_runs_pipeline_and_submits_review(self) -> None:
        arcade_client = AsyncMock()
        game_repository = AsyncMock()
        review_mapper = ReviewMapper()

        initialize_node = AsyncMock()
        capture_node = AsyncMock()
        visual_verify_node = AsyncMock()
        seo_analyze_node = AsyncMock()
        grounded_retrieve_node = AsyncMock()
        plan_content_node = AsyncMock()
        draft_content_node = AsyncMock()
        critic_plan_node = AsyncMock()
        audit_content_node = AsyncMock()
        optimize_content_node = AsyncMock()
        finalize_result_node = AsyncMock()

        arcade_client.get_proposal.return_value = {
            "id": "proposal-1",
            "gameId": "game-1",
            "proposedData": {"title": "Game Title"},
            "game": {"id": "game-1", "title": "Game Title"},
        }
        game_repository.get_game_record.return_value = {"id": "game-1", "title": "Game Title"}

        workflow = AiReviewAgentWorkflow(
            arcade_client=arcade_client,
            game_repository=game_repository,
            proposal_context_builder=ProposalContextBuilder(),
            review_mapper=review_mapper,
            initialize_node=initialize_node,
            capture_node=capture_node,
            visual_verify_node=visual_verify_node,
            seo_analyze_node=seo_analyze_node,
            grounded_retrieve_node=grounded_retrieve_node,
            plan_content_node=plan_content_node,
            draft_content_node=draft_content_node,
            critic_plan_node=critic_plan_node,
            audit_content_node=audit_content_node,
            optimize_content_node=optimize_content_node,
            finalize_result_node=finalize_result_node,
        )
        workflow.run_stages = AsyncMock(
            return_value={
                "status": "complete",
                "game_id": "game-1",
                "internal_imgs_paths": ["a.png", "b.png"],
                "article": "# Article",
                "outline": {"sections": []},
                "content_plan_validation": {"approved": True},
                "audit_report": {"approved": True, "factual_accuracy_score": 100, "completeness_score": 100},
                "optimization": {"evaluation": {"overall_ready": True}},
                "revision_history": [],
                "seo_blueprint": {"primary_keywords": ["foo"], "intent_strategy": "bar", "suggested_title": "baz"},
                "grounded_context": {"grounded_packet": {}, "postgres": {"results": []}, "mongo": {"results": []}, "mongo_persistence": {}},
                "investigation": {"all_candidates": [], "best_match": {"url": "https://example.com", "confidence_score": 90, "reasoning": "match", "extracted_facts": {}}},
                "accumulated_cost": 0.1,
            }
        )

        result = await workflow.run_proposal("proposal-1")

        arcade_client.submit_review.assert_awaited_once()
        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["final_article"], "# Article")
