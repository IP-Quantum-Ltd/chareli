"""Tests for trademark_guard.py."""

import unittest

from app.workflows.ai_review_agent.services.trademark_guard import (
    has_trademark_violations,
    redact_trademarks,
    scan_for_trademarks,
)


class TestScanForTrademarks(unittest.TestCase):
    def test_detects_minecraft(self):
        hits = scan_for_trademarks("This game is similar to Minecraft but simpler.")
        self.assertIn("Minecraft", hits)

    def test_detects_tetris_case_insensitive(self):
        hits = scan_for_trademarks("It plays like TETRIS in a 3D environment.")
        self.assertTrue(any(t.lower() == "tetris" for t in hits))

    def test_detects_multi_word_term(self):
        hits = scan_for_trademarks("Play among us with your friends online for free.")
        self.assertTrue(any("among us" in t.lower() for t in hits))

    def test_returns_empty_for_clean_text(self):
        hits = scan_for_trademarks("A fun browser puzzle game where you match tiles.")
        self.assertEqual(hits, [])

    def test_ignores_partial_word_match(self):
        # 'mine' should not trigger 'Minecraft'
        hits = scan_for_trademarks("You must mine resources carefully in this game.")
        self.assertNotIn("Minecraft", hits)

    def test_detects_in_html(self):
        # Should scan plain text inside HTML tags
        hits = scan_for_trademarks("<p>A game inspired by Pac-Man mechanics.</p>")
        self.assertTrue(any("pac" in t.lower() for t in hits))

    def test_empty_input(self):
        self.assertEqual(scan_for_trademarks(""), [])
        self.assertEqual(scan_for_trademarks(None), [])  # type: ignore[arg-type]


class TestRedactTrademarks(unittest.TestCase):
    def test_redacts_minecraft(self):
        result = redact_trademarks("This game is similar to Minecraft in many ways.")
        self.assertNotIn("Minecraft", result)
        self.assertIn("similar to", result)

    def test_redacts_tetris(self):
        result = redact_trademarks("Stack blocks like in Tetris to clear rows.")
        self.assertNotIn("Tetris", result)

    def test_redacts_mario(self):
        result = redact_trademarks("Play as Mario and jump over enemies.")
        self.assertNotIn("Mario", result)

    def test_preserves_surrounding_text(self):
        result = redact_trademarks("A game inspired by Minecraft mechanics and Tetris gameplay.")
        self.assertNotIn("Minecraft", result)
        self.assertNotIn("Tetris", result)
        self.assertIn("mechanics", result)
        self.assertIn("gameplay", result)

    def test_no_op_on_clean_text(self):
        clean = "A classic tile-matching puzzle game with bright colours."
        result = redact_trademarks(clean)
        self.assertEqual(result, clean)

    def test_empty_input(self):
        self.assertEqual(redact_trademarks(""), "")
        self.assertIsNone(redact_trademarks(None))  # type: ignore[arg-type]

    def test_preserves_html_tags(self):
        html = "<p>This is inspired by <strong>Minecraft</strong> but original.</p>"
        result = redact_trademarks(html)
        self.assertIn("<p>", result)
        self.assertIn("<strong>", result)
        self.assertNotIn("Minecraft", result)


class TestHasTrademarkViolations(unittest.TestCase):
    def test_true_for_violation(self):
        self.assertTrue(has_trademark_violations("Play Roblox-style games here."))

    def test_false_for_clean_text(self):
        self.assertFalse(has_trademark_violations("Enjoy our free browser puzzle game."))


if __name__ == "__main__":
    unittest.main()
