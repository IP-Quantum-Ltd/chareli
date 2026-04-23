import os
import logging
from typing import List, Dict, Any, Optional
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from app.config import settings

logger = logging.getLogger(__name__)

class BaseAIClient:
    """
    Integrated AI Client with LangChain, LangSmith Tracing, 
    and Automated Financial Monitoring.
    """
    def __init__(self, api_key: Optional[str] = None, **kwargs):
        super().__init__(**kwargs)
        self.api_key = api_key or settings.OPENAI_API_KEY
        
        # Initialize LangChain wrappers
        self.llm = ChatOpenAI(
            model=settings.PRIMARY_LLM_MODEL, 
            api_key=self.api_key
        )
        self.embeddings_engine = OpenAIEmbeddings(
            model=settings.EMBEDDING_MODEL, 
            api_key=self.api_key
        )
        self.last_cost = 0.0

    async def generate_embedding(self, text: str) -> List[float]:
        """Generates a high-dimension vector with fallback for dev environments."""
        if not self.api_key or "sk-" not in self.api_key or "dummy" in self.api_key.lower():
            return [0.0] * 3072
            
        try:
            # Use LangChain embeddings wrapper
            return await self.embeddings_engine.aembed_query(text)
        except Exception as e:
            logger.error(f"Embedding generation failed: {e}")
            return [0.0] * 3072

    async def chat_completion(self, 
                               messages: List[Dict[str, Any]], 
                               response_format: Optional[Dict] = None, 
                               fallback_data: Optional[Any] = None, 
                               metadata: Optional[Dict] = None):
        """Helper for Chat Completions with LangChain + LangSmith Metadata Tracing."""
        try:
            from langchain_core.messages import HumanMessage, SystemMessage
            formatted_messages = []
            for m in messages:
                if m["role"] == "system": 
                    formatted_messages.append(SystemMessage(content=m["content"]))
                else: 
                    # Supports multimodal (images) via content list/string
                    formatted_messages.append(HumanMessage(content=m["content"]))

            # Configure tracing metadata
            config = {}
            if metadata:
                config = {"metadata": metadata, "tags": list(metadata.values())}
            
            llm_call = self.llm
            if response_format and response_format.get("type") == "json_object":
                llm_call = self.llm.bind(response_format={"type": "json_object"})

            response = await llm_call.ainvoke(formatted_messages, config=config)
            
            # 1. Financial Monitoring (Usage tracking)
            usage = response.usage_metadata
            self.last_cost = self._calculate_langchain_cost(usage)
            logger.info(f"[Financial Monitor] Step Cost: ${self.last_cost:.4f}")
            
            content = response.content

            # 2. Robust JSON Extraction
            if response_format and response_format.get("type") == "json_object":
                import json
                try:
                    raw_content = content.strip()
                    if raw_content.startswith("```"):
                        lines = raw_content.splitlines()
                        if lines[0].startswith("```"): lines = lines[1:]
                        if lines[-1].startswith("```"): lines = lines[:-1]
                        raw_content = "\n".join(lines).strip()
                    return json.loads(raw_content)
                except Exception as e:
                    logger.error(f"JSON parsing failed: {e}")
                    return {"error": "JSON parse failed", "raw": content}
            
            return content
            
        except Exception as e:
            logger.error(f"AI Execution failed: {e}")
            if fallback_data is not None:
                return fallback_data
            raise

    def _calculate_langchain_cost(self, usage: Dict) -> float:
        """Calculates cost based on token pricing (GPT-4o rates)."""
        input_tokens = usage.get("input_tokens", 0)
        output_tokens = usage.get("output_tokens", 0)
        # Pricing as of current sprint: $5/1M input, $15/1M output
        return ((input_tokens / 1_000_000) * 5.00) + ((output_tokens / 1_000_000) * 15.00)

class BaseService:
    """Base class for all application services with integrated logging."""
    def __init__(self, **kwargs):
        self.logger = logging.getLogger(self.__class__.__name__)
        # Cooperative inheritance
        super().__init__(**kwargs)
