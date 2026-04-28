import asyncio
import unittest
from unittest.mock import AsyncMock

from pydantic import BaseModel

from app.config import LlmConfig
from app.domain.schemas.llm_outputs import GroundedContextOutput
from app.infrastructure.llm.ai_executor import AIExecutor


class AIExecutorParsingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.executor = AIExecutor(
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

    def test_parse_json_text_accepts_fenced_json(self) -> None:
        parsed = self.executor._parse_json_text("```json\n{\"ok\": true}\n```")
        self.assertEqual(parsed, {"ok": True})

    def test_parse_json_text_extracts_json_from_prefixed_text(self) -> None:
        parsed = self.executor._parse_json_text("Here is the result:\n{\"query\": \"pinball\"}")
        self.assertEqual(parsed, {"query": "pinball"})

    def test_normalize_response_content_handles_block_list(self) -> None:
        content = [
            {"type": "text", "text": "Leading explanation"},
            {"type": "output_text", "text": "{\"value\": 1}"},
        ]
        normalized = self.executor._normalize_response_content(content)
        self.assertIn("{\"value\": 1}", normalized)

    def test_parse_structured_text_validates_with_pydantic_schema(self) -> None:
        class StructuredPayload(BaseModel):
            value: int

        parser = self.executor._prepare_messages(
            [{"role": "system", "content": "Return JSON."}],
            None,
        )
        self.assertEqual(parser[0]["content"], "Return JSON.")

        parsed = self.executor._parse_structured_text(
            "{\"value\": 7}",
            self.executor._build_json_parser(StructuredPayload),
            StructuredPayload,
        )
        self.assertEqual(parsed, {"value": 7})

    def test_normalize_fallback_data_validates_schema_defaults(self) -> None:
        class StructuredPayload(BaseModel):
            value: int = 0
            note: str = ""

        normalized = self.executor._normalize_fallback_data({"value": 3}, StructuredPayload)
        self.assertEqual(normalized, {"value": 3, "note": ""})

    def test_grounded_context_schema_accepts_faq_objects(self) -> None:
        normalized = GroundedContextOutput.model_validate(
            {
                "seo_support": {
                    "primary_keywords": ["pinball"],
                    "secondary_keywords": [],
                    "faq_opportunities": [
                        {
                            "question": "How do you play?",
                            "source_signal": "faq",
                            "answer_angle": "Use the controls section.",
                        }
                    ],
                    "content_angles": ["guide"],
                }
            }
        ).model_dump()

        self.assertEqual(
            normalized["seo_support"]["faq_opportunities"][0]["question"],
            "How do you play?",
        )

    def test_repair_structured_output_uses_repaired_payload(self) -> None:
        class StructuredPayload(BaseModel):
            value: int

        self.executor._repair_structured_output = AsyncMock(return_value={"value": 9})  # type: ignore[method-assign]

        repaired = asyncio.run(
            self.executor._repair_structured_output(  # type: ignore[misc]
                '{"value":"bad"}',
                self.executor._build_json_parser(StructuredPayload),
                StructuredPayload,
            )
        )

        self.assertEqual(repaired, {"value": 9})
