import unittest

from app.workflows.ai_review_agent.services.review_mapper import ReviewMapper


class ReviewMapperTests(unittest.TestCase):
    def test_maps_success_state(self) -> None:
        mapper = ReviewMapper()
        state = {
            "status": "complete",
            "game_id": "game-1",
            "internal_imgs_paths": ["a.png", "b.png"],
            "article": "# Article",
            "outline": {"sections": []},
            "content_plan_validation": {"approved": True},
            "audit_report": {"approved": True, "factual_accuracy_score": 96, "completeness_score": 88},
            "optimization": {"evaluation": {"overall_ready": True}},
            "revision_history": [],
            "seo_blueprint": {"primary_keywords": ["foo"], "intent_strategy": "bar", "suggested_title": "baz"},
            "grounded_context": {
                "grounded_packet": {"canonical_identity": {}},
                "postgres": {"results": [1]},
                "mongo": {"results": [1, 2]},
                "mongo_persistence": {"status": "success"},
            },
            "investigation": {
                "all_candidates": [{"url": "https://example.com"}],
                "best_match": {
                    "url": "https://example.com",
                    "confidence_score": 84,
                    "reasoning": "strong match",
                    "extracted_facts": {"controls": "WASD"},
                    "deep_research_results": {},
                },
            },
            "accumulated_cost": 1.2345,
        }

        review = mapper.build_review_from_state("Example Game", state)

        self.assertEqual(review.recommendation, "accept")
        self.assertEqual(review.metrics["stage2_postgres_hits"], 1)
        self.assertEqual(review.metrics["stage2_mongo_hits"], 2)
        self.assertEqual(review.metrics["factual_accuracy_score"], 96)
        self.assertEqual(review.metrics["warning_count"], 0)
        self.assertTrue(review.screenshot_available)

    def test_maps_failure_state(self) -> None:
        mapper = ReviewMapper()
        review = mapper.build_failure_review("boom")
        self.assertEqual(review.recommendation, "decline")
        self.assertEqual(review.reasoning, "boom")
