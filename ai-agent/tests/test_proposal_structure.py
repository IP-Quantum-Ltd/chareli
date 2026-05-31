"""Tests for proposal_structure.py — canonical sections, ArticleSectionExtractor."""

import unittest

from app.workflows.ai_review_agent.services.proposal_structure import (
    CANONICAL_SECTIONS,
    FAQ_SECTIONS,
    HOW_TO_PLAY_SECTIONS,
    SECTION_GOALS,
    ArticleSectionExtractor,
    _reformat_faq_html,
)

SAMPLE_ARTICLE = """
<h2>Overview</h2>
<p>This is an exciting puzzle game where you match coloured tiles on a grid.</p>
<p>The objective is to clear all tiles before the timer runs out.</p>

<h2>How to Play</h2>
<p>Each round presents a new grid of tiles. You must select matching pairs to remove them.</p>
<p>Clearing all pairs earns you bonus points and advances to the next level.</p>

<h2>Controls</h2>
<ul>
<li><strong>Mouse:</strong> Click to select tiles</li>
<li><strong>Keyboard:</strong> Arrow keys to navigate, Enter to select</li>
<li><strong>Mobile:</strong> Tap tiles to select</li>
</ul>

<h2>Strategy</h2>
<p>Start from the corners to uncover hidden tiles. Focus on clearing the densest clusters first.</p>

<h2>FAQ</h2>
<h3>Game FAQ</h3>
<h4>Q: Is this game free?</h4>
<p>Yes, completely free on ArcadeBox.</p>
<h4>Q: Can I play on mobile?</h4>
<p>Yes, touch support is available.</p>
"""


class TestCanonicalSections(unittest.TestCase):
    def test_five_sections_defined(self):
        self.assertEqual(len(CANONICAL_SECTIONS), 5)

    def test_correct_section_names(self):
        self.assertIn("Overview", CANONICAL_SECTIONS)
        self.assertIn("How to Play", CANONICAL_SECTIONS)
        self.assertIn("Controls", CANONICAL_SECTIONS)
        self.assertIn("Strategy", CANONICAL_SECTIONS)
        self.assertIn("FAQ", CANONICAL_SECTIONS)

    def test_correct_order(self):
        self.assertEqual(CANONICAL_SECTIONS[0], "Overview")
        self.assertEqual(CANONICAL_SECTIONS[1], "How to Play")
        self.assertEqual(CANONICAL_SECTIONS[2], "Controls")
        self.assertEqual(CANONICAL_SECTIONS[3], "Strategy")
        self.assertEqual(CANONICAL_SECTIONS[4], "FAQ")

    def test_section_goals_defined_for_all(self):
        for section in CANONICAL_SECTIONS:
            self.assertIn(section, SECTION_GOALS)
            self.assertGreater(len(SECTION_GOALS[section]), 0)

    def test_field_routing_constants(self):
        self.assertEqual(HOW_TO_PLAY_SECTIONS, ["How to Play", "Controls", "Strategy"])
        self.assertEqual(FAQ_SECTIONS, ["FAQ"])


class TestArticleSectionExtractor(unittest.TestCase):
    def setUp(self):
        self.extractor = ArticleSectionExtractor(SAMPLE_ARTICLE)

    def test_detects_all_five_sections(self):
        missing = self.extractor.missing_sections()
        self.assertEqual(missing, [], f"Missing sections: {missing}")

    def test_description_is_overview_only(self):
        desc = self.extractor.get_description_html()
        self.assertIn("Overview", desc)
        self.assertIn("match coloured tiles", desc)
        self.assertNotIn("How to Play", desc)
        self.assertNotIn("Controls", desc)
        self.assertNotIn("Strategy", desc)
        self.assertNotIn("FAQ", desc)

    def test_how_to_play_contains_three_sections(self):
        htp = self.extractor.get_how_to_play_html()
        self.assertIn("How to Play", htp)
        self.assertIn("Controls", htp)
        self.assertIn("Strategy", htp)
        self.assertNotIn("Overview", htp)
        self.assertNotIn("FAQ", htp)

    def test_faq_section_extracted(self):
        faq = self.extractor.get_faq_section()
        self.assertIn("Is this game free", faq)
        self.assertIn("Can I play on mobile", faq)

    def test_faq_format_has_h4_questions(self):
        faq = self.extractor.get_faq_section()
        self.assertIn("<h4>Q:", faq)
        self.assertIn("<p>", faq)

    def test_missing_section_detection(self):
        partial = "<h2>Overview</h2><p>intro</p><h2>FAQ</h2><h3>FAQs</h3><h4>Q: test?</h4><p>ans</p>"
        ext = ArticleSectionExtractor(partial)
        missing = ext.missing_sections()
        self.assertIn("How to Play", missing)
        self.assertIn("Controls", missing)
        self.assertIn("Strategy", missing)

    def test_no_cross_section_duplicates_in_sample(self):
        duplicates = self.extractor.detect_cross_section_duplicates()
        # Sample article has no duplicates
        self.assertEqual(duplicates, [])

    def test_cross_section_duplicate_detection(self):
        # Use a long sentence (>=6 words) that appears verbatim in both Overview and How to Play
        shared = "select matching pairs of tiles to remove them and score points"
        duplicated_article = f"""
        <h2>Overview</h2>
        <p>You {shared} in this exciting game.</p>
        <h2>How to Play</h2>
        <p>You {shared} in this exciting game.</p>
        <h2>Controls</h2>
        <ul><li>Click to select</li></ul>
        <h2>Strategy</h2>
        <p>Focus on corners first for best results.</p>
        <h2>FAQ</h2>
        <h3>FAQ</h3>
        <h4>Q: Is it free?</h4><p>Yes.</p>
        """
        ext = ArticleSectionExtractor(duplicated_article)
        duplicates = ext.detect_cross_section_duplicates()
        self.assertGreater(len(duplicates), 0)


class TestReformatFaqHtml(unittest.TestCase):
    def test_reformats_h4_questions(self):
        raw = "<h2>FAQ</h2><h4>Q: Is it free?</h4><p>Yes, free on ArcadeBox.</p>"
        result = _reformat_faq_html(raw)
        self.assertIn("<h3>", result)
        self.assertIn("<h4>Q:", result)
        self.assertIn("<p>", result)

    def test_skips_empty_answers(self):
        raw = "<h2>FAQ</h2><h4>Q: </h4><p></p><h4>Q: Real question?</h4><p>Real answer.</p>"
        result = _reformat_faq_html(raw)
        # Only the real Q&A should appear
        self.assertIn("Real question", result)

    def test_empty_input_returns_empty(self):
        self.assertEqual(_reformat_faq_html(""), "")


if __name__ == "__main__":
    unittest.main()
