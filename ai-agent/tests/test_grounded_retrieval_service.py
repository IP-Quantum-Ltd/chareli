import unittest
from datetime import datetime, timezone

from app.config.runtime_config import LlmConfig, MongoConfig
from app.infrastructure.llm.ai_executor import AIExecutor
from app.services.json_utils import json_dumps_safe, sanitize_for_json
from app.workflows.ai_review_agent.services.grounded_retrieval_service import GroundedRetrievalService


class _StubPostgresProvider:
    async def get_pool(self):
        return None


class _StubMongoProvider:
    async def get_database(self):
        return None


class GroundedRetrievalServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        ai = AIExecutor(
            LlmConfig(
                provider="openai",
                openai_api_key="test-key",
                anthropic_api_key="",
                primary_model="gpt-4o",
                secondary_model="gpt-4o-mini",
                embedding_model="text-embedding-3-large",
                web_search_model="gpt-5.4-mini",
            )
        )
        self.service = GroundedRetrievalService(
            ai=ai,
            postgres_provider=_StubPostgresProvider(),
            mongo_provider=_StubMongoProvider(),
            mongo_config=MongoConfig(
                url="",
                database_name="test",
                rag_collection="rag",
                vector_index="vector",
                evaluation_collection="eval",
            ),
        )

    def test_sanitize_for_json_converts_datetime_recursively(self) -> None:
        payload = {
            "results": [
                {
                    "document": {
                        "updated_at": datetime(2026, 4, 28, 12, 0, tzinfo=timezone.utc),
                    }
                }
            ]
        }

        sanitized = sanitize_for_json(payload)

        self.assertEqual(
            sanitized["results"][0]["document"]["updated_at"],
            "2026-04-28T12:00:00+00:00",
        )

    def test_json_dumps_safe_handles_datetime_payloads(self) -> None:
        serialized = json_dumps_safe(
            {
                "updated_at": datetime(2026, 4, 28, 12, 0, tzinfo=timezone.utc),
                "items": ("a", "b"),
            },
            indent=2,
        )

        self.assertIn("2026-04-28T12:00:00+00:00", serialized)
        self.assertIn("\"items\"", serialized)
