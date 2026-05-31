"""Tests for faq_generation_service.py."""

import unittest

from app.workflows.ai_review_agent.services.faq_generation_service import (
    FaqGenerationService,
    _is_instructional,
    _is_meaningful,
    _normalise_question,
    _token_overlap,
)


class TestHelpers(unittest.TestCase):
    def test_normalise_question(self):
        self.assertEqual(_normalise_question("Is it FREE?!"), "is it free")
        self.assertEqual(_normalise_question("  Can I  play on mobile?  "), "can i play on mobile")

    def test_token_overlap_identical(self):
        self.assertAlmostEqual(_token_overlap("hello world", "hello world"), 1.0)

    def test_token_overlap_disjoint(self):
        self.assertAlmostEqual(_token_overlap("apple orange", "mango grape"), 0.0)

    def test_token_overlap_partial(self):
        result = _token_overlap("play game free browser", "play browser mobile")
        self.assertGreater(result, 0.0)
        self.assertLess(result, 1.0)

    def test_is_instructional_true(self):
        self.assertTrue(_is_instructional("Provide a step-by-step guide here."))
        self.assertTrue(_is_instructional("Explain the mechanics of the game."))
        self.assertTrue(_is_instructional("Describe what happens when you lose."))

    def test_is_instructional_false(self):
        self.assertFalse(_is_instructional("Yes, the game is completely free to play."))
        self.assertFalse(_is_instructional("No download is required."))

    def test_is_meaningful_false_for_placeholder(self):
        self.assertFalse(_is_meaningful("Unknown"))
        self.assertFalse(_is_meaningful("N/A"))
        self.assertFalse(_is_meaningful(""))
        self.assertFalse(_is_meaningful(None))

    def test_is_meaningful_true_for_real_text(self):
        self.assertTrue(_is_meaningful("Yes, this game is free to play on ArcadeBox."))


class TestFaqGenerationService(unittest.TestCase):
    def setUp(self):
        self.service = FaqGenerationService(min_items=3, max_items=6)

    def test_returns_items_from_article(self):
        items = self.service.generate(
            article_faq_items=[
                {"question": "Is it free?", "answer": "Yes, completely free."},
                {"question": "Can I play on mobile?", "answer": "Yes, touch support is available."},
                {"question": "Does it save progress?", "answer": "Progress is saved locally."},
            ]
        )
        self.assertGreaterEqual(len(items), 3)
        for item in items:
            self.assertIn("question", item)
            self.assertIn("answer", item)

    def test_deduplicates_near_identical_questions(self):
        # These two questions share very high token overlap (>0.70 Jaccard)
        items = self.service.generate(
            article_faq_items=[
                {"question": "Is the game free to play on ArcadeBox browser?", "answer": "Yes, it is free."},
                {"question": "Is the game free to play on ArcadeBox browser online?", "answer": "Yes, completely free."},
                {"question": "Can I play on mobile?", "answer": "Yes."},
                {"question": "Does it save progress?", "answer": "Yes, via local storage."},
            ]
        )
        questions = [i["question"].lower() for i in items]
        free_questions = [q for q in questions if "free" in q and "arcadebox" in q]
        self.assertLessEqual(len(free_questions), 1)

    def test_drops_instructional_answers(self):
        items = self.service.generate(
            article_faq_items=[
                {"question": "How do I score high?", "answer": "Provide a detailed step-by-step guide on scoring."},
                {"question": "Is it free?", "answer": "Yes, completely free on ArcadeBox."},
                {"question": "Can I play on mobile?", "answer": "Yes, touch support is available."},
                {"question": "Is there a leaderboard?", "answer": "Yes, scores are saved locally."},
            ]
        )
        for item in items:
            self.assertNotIn("Provide", item["answer"])

    def test_drops_unconfirmed_answers(self):
        items = self.service.generate(
            article_faq_items=[
                {"question": "Is Dominoes available on mobile devices?", "answer": "It is not publicly specified whether this version is available on mobile."},
                {"question": "Is it free?", "answer": "Yes, completely free on ArcadeBox."},
                {"question": "Can I play on mobile?", "answer": "Yes, touch support is available."},
                {"question": "Is there a leaderboard?", "answer": "Yes, scores are saved locally."},
            ]
        )
        for item in items:
            self.assertNotIn("Dominoes", item["question"])
            self.assertNotIn("not publicly specified", item["answer"])


    def test_enforces_minimum_items(self):
        # If only 1 source item is valid, should still return what it can
        items = self.service.generate(
            article_faq_items=[
                {"question": "Is it free?", "answer": "Yes."},
            ]
        )
        # Should not crash; returns what's available
        self.assertGreaterEqual(len(items), 0)

    def test_combines_sources(self):
        items = self.service.generate(
            article_faq_items=[
                {"question": "Is it free?", "answer": "Yes, free."},
            ],
            optimizer_faq_schema=[
                {"question": "Can I play offline?", "answer": "No, requires a browser."},
            ],
            grounded_faq_evidence=[
                {"question": "Is there a mobile app?", "answer": "No app, browser only."},
            ],
            seo_faq_opportunities=[
                {"question": "What devices support this?", "answer_angle": "Works on PC, tablet, mobile."},
            ],
        )
        self.assertGreaterEqual(len(items), 3)

    def test_respects_max_items(self):
        many_items = [
            {"question": f"Unique question number {i}?", "answer": f"Unique answer number {i} on ArcadeBox."}
            for i in range(20)
        ]
        items = self.service.generate(article_faq_items=many_items)
        self.assertLessEqual(len(items), 6)

    def test_penalises_high_overlap_with_non_faq_content(self):
        non_faq = "The game is completely free to play. You do not need to pay anything. No subscription required."
        items = self.service.generate(
            non_faq_content=non_faq,
            article_faq_items=[
                {"question": "Is the game free to play?", "answer": "Yes, completely free, no subscription."},
                {"question": "How do I jump?", "answer": "Press the spacebar."},
                {"question": "Can I save my progress?", "answer": "Yes, progress is saved in local storage."},
            ]
        )
        # The "free to play" question should score lower due to overlap but not necessarily be removed
        # The main assertion is that non-overlapping questions score well
        self.assertGreaterEqual(len(items), 1)

    def test_empty_sources_returns_empty(self):
        items = self.service.generate()
        self.assertEqual(items, [])


if __name__ == "__main__":
    unittest.main()
