import json
import logging
from typing import Any, Dict, List, Optional

from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from openai import AsyncOpenAI

from app.config import LlmConfig

logger = logging.getLogger(__name__)


class AIExecutor:
    def __init__(self, llm_config: LlmConfig):
        self._llm_config = llm_config
        self._llm = ChatOpenAI(
            model=llm_config.primary_model,
            api_key=llm_config.openai_api_key,
            stream_usage=True,
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
        fallback_data: Optional[Any] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Any:
        try:
            from langchain_core.messages import HumanMessage, SystemMessage

            formatted_messages = []
            for message in messages:
                if message["role"] == "system":
                    formatted_messages.append(SystemMessage(content=message["content"]))
                else:
                    formatted_messages.append(HumanMessage(content=message["content"]))

            config: Dict[str, Any] = {}
            if metadata:
                config = {"metadata": metadata, "tags": [str(value) for value in metadata.values()]}

            llm = self._llm
            if response_format and response_format.get("type") == "json_object":
                llm = self._llm.bind(response_format={"type": "json_object"})

            response = await llm.ainvoke(formatted_messages, config=config)
            usage = getattr(response, "usage_metadata", {}) or {}
            self.last_cost = self._calculate_langchain_cost(usage)
            content = response.content

            if response_format and response_format.get("type") == "json_object":
                try:
                    return self._parse_json_text(str(content))
                except Exception as exc:
                    logger.error("JSON parsing failed: %s", exc)
                    if fallback_data is not None:
                        return fallback_data
                    return {"error": "JSON parse failed", "raw": content}

            return content
        except Exception as exc:
            logger.error("Execution failed: %s", exc)
            if fallback_data is not None:
                return fallback_data
            raise

    def _parse_json_text(self, raw_text: str) -> Dict[str, Any]:
        cleaned = raw_text.strip()
        if cleaned.startswith("```"):
            lines = cleaned.splitlines()
            if lines and lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].startswith("```"):
                lines = lines[:-1]
            cleaned = "\n".join(lines).strip()
        return json.loads(cleaned)

    def _calculate_langchain_cost(self, usage: Dict[str, Any]) -> float:
        input_tokens = usage.get("input_tokens", 0)
        output_tokens = usage.get("output_tokens", 0)
        return ((input_tokens / 1_000_000) * 5.00) + ((output_tokens / 1_000_000) * 15.00)
