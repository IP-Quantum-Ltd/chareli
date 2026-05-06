import unittest

from app.config import AppSettings, build_runtime_config


class ConfigFactoryTests(unittest.TestCase):
    def test_build_runtime_config_maps_nested_dataclasses(self) -> None:
        settings = AppSettings(
            ARCADE_API_BASE_URL="https://api.example.com",
            ARCADE_API_TOKEN="token",
            OPENAI_API_KEY="key",
            SUPERADMIN_EMAIL="admin@example.com",
            SUPERADMIN_PASSWORD="secret",
            STAGE0_REQUIRED_CANDIDATES=5,
            STAGE0_MAX_SEARCH_RESULTS=5,
            STAGE0_CANDIDATE_CAPTURE_TIMEOUT_SECONDS=30,
        )

        runtime = build_runtime_config(settings)

        self.assertEqual(runtime.arcade_api.base_url, "https://api.example.com")
        self.assertEqual(runtime.arcade_api.api_token, "token")
        self.assertEqual(runtime.browser.admin_email, "admin@example.com")
        self.assertEqual(runtime.llm.primary_model, "gpt-4o")
        self.assertEqual(runtime.mongo.rag_collection, "stage2_grounded_contexts")
        self.assertEqual(runtime.queue.stage0_required_candidates, 5)
        self.assertEqual(runtime.queue.stage0_max_search_results, 5)
        self.assertEqual(runtime.queue.stage0_candidate_capture_timeout_seconds, 30)
