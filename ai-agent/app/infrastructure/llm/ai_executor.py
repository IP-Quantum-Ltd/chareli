import json
import logging
from typing import Any, Dict, List, Optional, Type

from langchain_core.output_parsers import JsonOutputParser
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from openai import AsyncOpenAI
from pydantic import BaseModel

from app.config import LlmConfig

logger = logging.getLogger(__name__)

try:
    from langchain.output_parsers import OutputFixingParser  # type: ignore
except ModuleNotFoundError:  # pragma: no cover - optional dependency
    OutputFixingParser = None


class AIExecutor:
    def __init__(self, llm_config: LlmConfig):
        self._llm_config = llm_config
        self._model_max_output_tokens = self._resolve_model_max_output_tokens(llm_config.primary_model)
        llm_kwargs: Dict[str, Any] = {}
        if self._model_max_output_tokens is not None:
            llm_kwargs["max_tokens"] = self._model_max_output_tokens
        self._llm = ChatOpenAI(
            model=llm_config.primary_model,
            api_key=llm_config.openai_api_key,
            stream_usage=True,
            **llm_kwargs,
        )
        self._embeddings = OpenAIEmbeddings(
            model=llm_config.embedding_model,
            api_key=llm_config.openai_api_key,
        )
        self._openai_client = AsyncOpenAI(api_key=llm_config.openai_api_key)
        self.last_cost = 0.0

    @property
    def openai_client(self) -> AsyncOpenAI:
        return self._openai_client

    @property
    def llm_config(self) -> LlmConfig:
        return self._llm_config

    async def generate_embedding(self, text: str, model: Optional[str] = None) -> List[float]:
        embedding_model = model or self._llm_config.embedding_model
        try:
            if embedding_model != self._llm_config.embedding_model:
                temp_embeddings = OpenAIEmbeddings(
                    model=embedding_model,
                    api_key=self._llm_config.openai_api_key,
                )
                return await temp_embeddings.aembed_query(text)
            return await self._embeddings.aembed_query(text)
        except Exception as exc:
            logger.error("Embedding failed: %s", exc)
            return [0.0] * 3072

    async def chat_completion(
        self,
        messages: List[Dict[str, Any]],
        response_format: Optional[Dict[str, Any]] = None,
        pydantic_schema: Optional[Type[BaseModel]] = None,
        fallback_data: Optional[Any] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Any:
        try:
            from langchain_core.messages import HumanMessage, SystemMessage

            config: Dict[str, Any] = {}
            if metadata:
                config = {"metadata": metadata, "tags": [str(value) for value in metadata.values()]}

            parser = self._build_json_parser(pydantic_schema)
            json_mode = bool(parser or (response_format and response_format.get("type") == "json_object"))
            prepared_messages = self._prepare_messages(messages, parser)
            attempts = [
                prepared_messages,
                [
                    *prepared_messages,
                    {
                        "role": "user",
                        "content": "Return only valid JSON. Do not include commentary, markdown fences, or any leading text.",
                    },
                ],
            ] if json_mode else [prepared_messages]

            last_content = ""
            for attempt_index, attempt_messages in enumerate(attempts, start=1):
                formatted_messages = []
                for message in attempt_messages:
                    if message["role"] == "system":
                        formatted_messages.append(SystemMessage(content=message["content"]))
                    else:
                        formatted_messages.append(HumanMessage(content=message["content"]))

                llm = self._llm
                if json_mode:
                    llm = self._llm.bind(response_format={"type": "json_object"})

                response = await llm.ainvoke(formatted_messages, config=config)
                usage = getattr(response, "usage_metadata", {}) or {}
                self.last_cost = self._calculate_langchain_cost(usage)
                content = self._normalize_response_content(response.content)
                last_content = content

                if json_mode:
                    try:
                        return self._parse_structured_text(content, parser, pydantic_schema)
                    except Exception as exc:
                        logger.warning("JSON parsing failed on attempt %s: %s", attempt_index, exc)
                        if parser is not None and pydantic_schema is not None:
                            try:
                                repaired = await self._repair_structured_output(content, parser, pydantic_schema)
                                logger.info("Structured output repaired after attempt %s.", attempt_index)
                                return repaired
                            except Exception as repair_exc:
                                logger.warning("Structured output repair failed on attempt %s: %s", attempt_index, repair_exc)
                        continue

                return content

            if json_mode:
                if fallback_data is not None:
                    return self._normalize_fallback_data(fallback_data, pydantic_schema)
                return {"error": "JSON parse failed", "raw": last_content}
        except Exception as exc:
            logger.error("Execution failed: %s", exc)
            if fallback_data is not None:
                return self._normalize_fallback_data(fallback_data, pydantic_schema)
            raise

    def _prepare_messages(
        self,
        messages: List[Dict[str, Any]],
        parser: Optional[JsonOutputParser],
    ) -> List[Dict[str, Any]]:
        if parser is None:
            return messages
        prepared_messages = [dict(message) for message in messages]
        format_instructions = parser.get_format_instructions()
        format_message = {
            "role": "system",
            "content": (
                "Return only valid JSON that matches these instructions exactly:\n"
                f"{format_instructions}"
            ),
        }
        if prepared_messages and prepared_messages[0].get("role") == "system":
            first = dict(prepared_messages[0])
            first["content"] = f"{first['content']}\n\n{format_message['content']}"
            prepared_messages[0] = first
            return prepared_messages
        return [format_message, *prepared_messages]

    def _build_json_parser(
        self,
        pydantic_schema: Optional[Type[BaseModel]],
    ) -> Optional[JsonOutputParser]:
        if pydantic_schema is None:
            return None
        return JsonOutputParser(pydantic_object=pydantic_schema)

    def _normalize_response_content(self, content: Any) -> str:
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            text_parts: List[str] = []
            for item in content:
                if isinstance(item, str):
                    text_parts.append(item)
                elif isinstance(item, dict):
                    text_value = item.get("text") or item.get("content")
                    if isinstance(text_value, str):
                        text_parts.append(text_value)
            if text_parts:
                return "\n".join(text_parts).strip()
        return str(content)

    def _parse_json_text(self, raw_text: str) -> Dict[str, Any]:
        cleaned = raw_text.strip()
        if not cleaned:
            raise ValueError("Model returned empty content.")
        if cleaned.startswith("```"):
            lines = cleaned.splitlines()
            if lines and lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].startswith("```"):
                lines = lines[:-1]
            cleaned = "\n".join(lines).strip()
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            extracted = self._extract_json_object(cleaned)
            if extracted is None:
                raise
            return json.loads(extracted)

    def _parse_structured_text(
        self,
        raw_text: str,
        parser: Optional[JsonOutputParser],
        pydantic_schema: Optional[Type[BaseModel]],
    ) -> Any:
        if parser is not None:
            parsed = parser.parse(raw_text)
            if pydantic_schema is not None:
                return pydantic_schema.model_validate(parsed).model_dump()
            return parsed
        return self._parse_json_text(raw_text)

    async def _repair_structured_output(
        self,
        raw_text: str,
        parser: Optional[JsonOutputParser],
        pydantic_schema: Optional[Type[BaseModel]],
    ) -> Any:
        if parser is None:
            raise ValueError("Repair requires a structured parser.")

        if OutputFixingParser is not None:
            fixing_parser = OutputFixingParser.from_llm(parser=parser, llm=self._llm)
            fixed = await fixing_parser.aparse(raw_text)
            if pydantic_schema is not None:
                return pydantic_schema.model_validate(fixed).model_dump()
            return fixed

        format_instructions = parser.get_format_instructions()
        repair_messages = [
            {
                "role": "system",
                "content": (
                    "Repair the following invalid structured output. Return only valid JSON and preserve the intended meaning."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Schema instructions:\n{format_instructions}\n\n"
                    f"Invalid output:\n{raw_text}"
                ),
            },
        ]
        repaired = await self.chat_completion(
            messages=repair_messages,
            response_format={"type": "json_object"},
            pydantic_schema=pydantic_schema,
            fallback_data=None,
            metadata={"stage": "structured_output_repair"},
        )
        return repaired

    def _normalize_fallback_data(
        self,
        fallback_data: Any,
        pydantic_schema: Optional[Type[BaseModel]],
    ) -> Any:
        if pydantic_schema is None:
            return fallback_data
        return pydantic_schema.model_validate(fallback_data).model_dump()

    def _extract_json_object(self, raw_text: str) -> Optional[str]:
        start = raw_text.find("{")
        if start == -1:
            return None
        depth = 0
        in_string = False
        escaped = False
        for index in range(start, len(raw_text)):
            char = raw_text[index]
            if in_string:
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == "\"":
                    in_string = False
                continue
            if char == "\"":
                in_string = True
            elif char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    return raw_text[start : index + 1]
        return None

    def _calculate_langchain_cost(self, usage: Dict[str, Any]) -> float:
        input_tokens = usage.get("input_tokens", 0)
        output_tokens = usage.get("output_tokens", 0)
        return ((input_tokens / 1_000_000) * 5.00) + ((output_tokens / 1_000_000) * 15.00)

    def _resolve_model_max_output_tokens(self, model_name: str) -> Optional[int]:
        normalized = (model_name or "").strip().lower()
        if not normalized:
            return None
        if normalized.startswith("gpt-5"):
            return 128000
        if normalized.startswith("gpt-4o") or normalized.startswith("chatgpt-4o"):
            return 16384
        if normalized.startswith("gpt-4"):
            return 8192
        return None
