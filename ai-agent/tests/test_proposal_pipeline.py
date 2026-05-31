import unittest
from unittest.mock import AsyncMock

from app.workflows.ai_review_agent.services.proposal_context_builder import ProposalContextBuilder
from app.workflows.ai_review_agent.services.proposal_structure import (
    CANONICAL_SECTIONS,
    ArticleSectionExtractor,
)
from app.workflows.ai_review_agent.services.review_mapper import ReviewMapper
from app.workflows.ai_review_agent.workflow import AiReviewAgentWorkflow

_STRUCTURED_ARTICLE = """
<h2>Overview</h2>
<p>A fun tile-matching puzzle game available free on ArcadeBox.</p>

<h2>How to Play</h2>
<p>Select pairs of matching tiles to remove them before the timer runs out.</p>

<h2>Controls</h2>
<ul><li>Mouse: click to select</li><li>Mobile: tap to select</li></ul>

<h2>Strategy</h2>
<p>Start from corners and clear the densest clusters first.</p>

<h2>FAQ</h2>
<h3>Tile Match FAQ</h3>
<h4>Q: Is this game free?</h4>
<p>Yes, completely free on ArcadeBox.</p>
<h4>Q: Can I play on mobile?</h4>
<p>Yes, touch support is available.</p>
<h4>Q: Does it save my progress?</h4>
<p>Progress is saved in your browser local storage.</p>
"""


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
        format_proposed_data_node = AsyncMock()

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
            format_proposed_data_node=format_proposed_data_node,
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

        workflow.run_stages.assert_awaited_once()
        call_payload = workflow.run_stages.call_args.args[0]
        self.assertEqual(call_payload["proposal_id"], "proposal-1")
        self.assertTrue(call_payload["submit_review"])
        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["final_article"], "# Article")

    def test_article_section_extractor_field_mapping(self) -> None:
        """
        Verify the 5-section article is split into the correct DB fields:
          description  -> Overview section only
          howToPlay    -> How to Play + Controls + Strategy
          faqOverride  -> FAQ section with parseFAQ-compatible structure
        """
        extractor = ArticleSectionExtractor(_STRUCTURED_ARTICLE)

        # All 5 sections present
        missing = extractor.missing_sections(CANONICAL_SECTIONS)
        self.assertEqual(missing, [], f"Missing sections: {missing}")

        # description = Overview only
        description = extractor.get_description_html()
        self.assertIn("Overview", description)
        self.assertIn("tile-matching puzzle", description)
        self.assertNotIn("How to Play", description)
        self.assertNotIn("Controls", description)
        self.assertNotIn("FAQ", description)

        # howToPlay = How to Play + Controls + Strategy
        how_to_play = extractor.get_how_to_play_html()
        self.assertIn("How to Play", how_to_play)
        self.assertIn("Controls", how_to_play)
        self.assertIn("Strategy", how_to_play)
        self.assertNotIn("Overview", how_to_play)
        self.assertNotIn("FAQ", how_to_play)

        # faqOverride = FAQ section in parseFAQ-compatible format
        faq_override = extractor.get_faq_section()
        self.assertIn("<h3>", faq_override)
        self.assertIn("<h4>Q:", faq_override)
        self.assertIn("<p>", faq_override)
        self.assertIn("Is this game free", faq_override)
        self.assertIn("Can I play on mobile", faq_override)
        self.assertIn("Does it save my progress", faq_override)


if __name__ == "__main__":
    unittest.main()
