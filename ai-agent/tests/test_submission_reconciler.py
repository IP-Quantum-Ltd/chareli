import unittest
import uuid

from app.workflows.ai_review_agent.services.submission_reconciler import SubmissionReconciler


class SubmissionReconcilerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.reconciler = SubmissionReconciler()

    def test_preserves_current_values_when_candidate_is_blank_or_placeholder(self) -> None:
        proposed = {
            "title": "Air Strike",
            "description": "Unknown",
            "categoryId": "",
            "metadata": {
                "howToPlay": "",
                "features": [],
                "tags": [],
                "seoKeywords": "",
                "developer": "Yad.com",
                "platform": [],
                "releaseDate": "",
                "faqOverride": "",
            },
        }
        seo_meta = {
            "title_tag": "",
            "meta_description": "N/A",
            "primary_h1": "",
            "primary_keywords": [],
            "json_ld": {},
            "faq_schema": [],
        }
        current = {
            "title": "Air Strike",
            "description": "<p>Current description</p>",
            "categoryId": "cat-1",
            "metadata": {
                "howToPlay": "<p>Current how to play</p>",
                "features": ["Shooter", "Arcade"],
                "tags": ["action", "planes"],
                "seoKeywords": "air strike, arcade",
                "developer": "Miniclip",
                "platform": ["Browser"],
                "releaseDate": "2024-01-01",
                "faqOverride": "<h3>FAQ</h3><h4>Q: Is it free?</h4><p>Yes.</p>",
            },
            "seoMeta": {
                "title_tag": "Current Title",
                "meta_description": "Current meta description",
                "primary_h1": "Current H1",
                "primary_keywords": ["air strike"],
                "json_ld": {"author": {"name": "Miniclip"}},
                "faq_schema": [
                    {
                        "@type": "Question",
                        "name": "Is it free?",
                        "acceptedAnswer": {"@type": "Answer", "text": "Yes."},
                    }
                ],
            },
        }

        reconciled_game, reconciled_seo = self.reconciler.reconcile(proposed, seo_meta, current)

        self.assertEqual(reconciled_game["description"], "<p>Current description</p>")
        self.assertEqual(reconciled_game["categoryId"], "cat-1")
        self.assertEqual(reconciled_game["metadata"]["howToPlay"], "<p>Current how to play</p>")
        self.assertEqual(reconciled_game["metadata"]["developer"], "Miniclip")
        self.assertEqual(reconciled_game["metadata"]["features"], ["Shooter", "Arcade"])
        self.assertEqual(reconciled_game["metadata"]["platform"], ["Browser"])
        self.assertEqual(reconciled_seo["title_tag"], "Current Title")
        self.assertEqual(reconciled_seo["meta_description"], "Current meta description")

    def test_merges_faq_and_sanitizes_domains(self) -> None:
        proposed = {
            "title": "Air Strike",
            "description": "<p>Play now at https://Yad.com/games/air-strike.</p>",
            "metadata": {
                "howToPlay": "<p>Play on www.example.com with arrows.</p>",
                "features": ["Fast combat"],
                "tags": ["action"],
                "seoKeywords": "air strike, yad.com",
                "developer": "Yad.com",
                "platform": ["Browser"],
                "releaseDate": "",
                "faqOverride": "<h3>FAQ</h3><h4>Q: Can I play on mobile?</h4><p>Yes, on touch devices.</p>",
            },
        }
        seo_meta = {
            "title_tag": "Play Air Strike on Yad.com",
            "meta_description": "Air Strike on www.yad.com is free to play.",
            "primary_h1": "Air Strike Yad.com Guide",
            "primary_keywords": ["air strike", "yad.com"],
            "json_ld": {"author": {"name": "Yad.com"}},
            "faq_schema": [
                {
                    "@type": "Question",
                    "name": "Can I play on mobile?",
                    "acceptedAnswer": {"@type": "Answer", "text": "Yes, on touch devices."},
                },
                {
                    "@type": "Question",
                    "name": "Is it free?",
                    "acceptedAnswer": {"@type": "Answer", "text": "Absolutely free."},
                },
            ],
        }
        current = {
            "title": "Air Strike",
            "description": "<p>Current description</p>",
            "categoryId": "cat-1",
            "metadata": {
                "faqOverride": "<h3>FAQ</h3><h4>Q: Is it free?</h4><p>Yes.</p>",
            },
            "seoMeta": {
                "faq_schema": [
                    {
                        "@type": "Question",
                        "name": "Is it free?",
                        "acceptedAnswer": {"@type": "Answer", "text": "Yes."},
                    }
                ]
            },
        }

        reconciled_game, reconciled_seo = self.reconciler.reconcile(proposed, seo_meta, current)

        self.assertIn("yad", reconciled_game["description"].lower())
        self.assertNotIn("yad.com", reconciled_game["description"].lower())
        self.assertNotIn("www.example.com", reconciled_game["metadata"]["howToPlay"].lower())
        self.assertEqual(reconciled_game["metadata"]["developer"], "")
        self.assertEqual(reconciled_game["categoryId"], "cat-1")
        self.assertEqual(len(reconciled_seo["faq_schema"]), 2)
        faq_html = reconciled_game["metadata"]["faqOverride"]
        self.assertIn("Can I play on mobile?", faq_html)
        self.assertIn("Is it free?", faq_html)

    def test_drops_instructional_faq_answers(self) -> None:
        proposed = {
            "title": "Kingdom Wars",
            "description": "<p>Description</p>",
            "metadata": {
                "faqOverride": (
                    "<h3>FAQ</h3>"
                    "<h4>Q: How do you play Kingdom Wars online?</h4>"
                    "<p>Provide a detailed step-by-step guide on playing the game.</p>"
                ),
            },
        }
        seo_meta = {
            "faq_schema": [
                {
                    "@type": "Question",
                    "name": "What is Kingdom Wars inspired by?",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": "Explain the game's inspiration from Monopoly and its medieval theme.",
                    },
                }
            ]
        }
        current = {
            "title": "Kingdom Wars",
            "metadata": {
                "faqOverride": "<h3>FAQ</h3><h4>Q: Is it free?</h4><p>Yes.</p>",
            },
            "seoMeta": {
                "faq_schema": [
                    {
                        "@type": "Question",
                        "name": "Is it free?",
                        "acceptedAnswer": {"@type": "Answer", "text": "Yes."},
                    }
                ]
            },
        }

        reconciled_game, reconciled_seo = self.reconciler.reconcile(proposed, seo_meta, current)

        self.assertIn("Is it free?", reconciled_game["metadata"]["faqOverride"])
        self.assertNotIn("How do you play Kingdom Wars online?", reconciled_game["metadata"]["faqOverride"])
        self.assertEqual(len(reconciled_seo["faq_schema"]), 1)

    def test_trademark_redaction_applied_in_reconcile(self) -> None:
        proposed = {
            "title": "Brick Fall",
            "description": "<p>A game inspired by Tetris mechanics.</p>",
            "metadata": {
                "howToPlay": "<p>Stack blocks like in Minecraft to fill rows.</p>",
                "faqOverride": "<h3>FAQ</h3><h4>Q: Is it like Roblox?</h4><p>No, original.</p>",
                "features": ["Falling blocks"],
                "tags": ["puzzle"],
                "seoKeywords": "brick fall",
                "developer": "",
                "platform": ["Browser"],
                "releaseDate": "",
            },
        }
        seo_meta = {"title_tag": "", "meta_description": "", "primary_h1": "", "primary_keywords": [], "json_ld": {}, "faq_schema": []}
        current = {"title": "Brick Fall", "metadata": {}, "seoMeta": {}}
        reconciled_game, _ = self.reconciler.reconcile(proposed, seo_meta, current)
        self.assertNotIn("Tetris", reconciled_game["description"])
        self.assertNotIn("Minecraft", reconciled_game["metadata"]["howToPlay"])
        self.assertNotIn("Roblox", reconciled_game["metadata"]["faqOverride"])

    def test_uuid_serialized_to_string_in_reconcile(self) -> None:
        import uuid
        proposed_uuid = uuid.uuid4()
        current_uuid = uuid.uuid4()
        proposed = {
            "title": "Brick Fall",
            "description": "Clean description",
            "categoryId": proposed_uuid,
            "metadata": {},
        }
        seo_meta = {"title_tag": "", "meta_description": "", "primary_h1": "", "primary_keywords": [], "json_ld": {}, "faq_schema": []}
        current = {
            "title": "Brick Fall",
            "categoryId": current_uuid,
            "metadata": {},
            "seoMeta": {},
        }
        
        # 1. Test when proposed has UUID
        reconciled_game, _ = self.reconciler.reconcile(proposed, seo_meta, current)
        self.assertEqual(reconciled_game["categoryId"], str(proposed_uuid))
        self.assertIsInstance(reconciled_game["categoryId"], str)

        # 2. Test fallback when proposed has no categoryId (should fallback to current and stringify)
        proposed_empty = {
            "title": "Brick Fall",
            "description": "Clean description",
            "categoryId": None,
            "metadata": {},
        }
        reconciled_game_empty, _ = self.reconciler.reconcile(proposed_empty, seo_meta, current)
        self.assertEqual(reconciled_game_empty["categoryId"], str(current_uuid))
        self.assertIsInstance(reconciled_game_empty["categoryId"], str)


