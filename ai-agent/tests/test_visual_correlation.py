import unittest

from app.workflows.ai_review_agent.services.visual_correlation_service import VisualCorrelationService


class VisualCorrelationTests(unittest.TestCase):
    def test_scores_candidate_deterministically(self) -> None:
        service = VisualCorrelationService()
        score = service.score_candidate(
            {"visual_match_score": 80, "confidence_score": 70},
            {"relevance_score": 60, "exact_title_match": True, "source_quality": "high"},
        )
        self.assertEqual(score["confidence_score"], 89)

    def test_builds_seo_intelligence(self) -> None:
        service = VisualCorrelationService()
        result = service.build_candidate_seo_intelligence(
            "Pacman",
            "\"Pacman\" browser game",
            {"title": "Pacman browser game", "meta_description": "Play Pacman online", "headings": ["Pacman"]},
        )
        self.assertTrue(result["exact_title_match"])
        self.assertGreater(result["relevance_score"], 0)
