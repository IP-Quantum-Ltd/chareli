import os
import logging
from typing import List, Dict, Any, Optional
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from app.config import settings

logger = logging.getLogger(__name__)

class BaseAIClient:
    """Integrated AI Client with LangSmith Tracing and Cost Tracking."""
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        
        # Sync Pydantic settings to os.environ for LangChain tracers
        if settings.LANGCHAIN_TRACING_V2:
            os.environ["LANGCHAIN_TRACING_V2"] = "true"
            os.environ["LANGCHAIN_API_KEY"] = settings.LANGCHAIN_API_KEY
            os.environ["LANGCHAIN_PROJECT"] = settings.LANGCHAIN_PROJECT
            os.environ["LANGCHAIN_ENDPOINT"] = settings.LANGCHAIN_ENDPOINT

        self.llm = ChatOpenAI(
            model=settings.PRIMARY_LLM_MODEL, 
            api_key=settings.OPENAI_API_KEY,
            stream_usage=True # Ensure usage metadata is included even in streaming if used later
        )
        self.embeddings = OpenAIEmbeddings(model="text-embedding-3-small", api_key=settings.OPENAI_API_KEY)
        self.last_cost = 0.0

    async def generate_embedding(self, text: str, model: str = "text-embedding-3-large") -> List[float]:
        """Generates a high-dimension vector for RAG."""
        try:
            response = await self.client.embeddings.create(input=text, model=model)
            return response.data[0].embedding
        except Exception as e:
            logger.error(f"Embedding failed: {e}")
            return [0.0] * 3072

    async def chat_completion(self, messages: List[Dict[str, Any]], response_format: Optional[Dict] = None, fallback_data: Optional[Any] = None, metadata: Optional[Dict] = None):
        """Helper for Chat Completions with LangChain + Metadata Tracing."""
        try:
            from langchain_core.messages import HumanMessage, SystemMessage
            formatted_messages = []
            for m in messages:
                if m["role"] == "system": 
                    formatted_messages.append(SystemMessage(content=m["content"]))
                else: 
                    # LangChain multimodal format for LangSmith image rendering
                    formatted_messages.append(HumanMessage(content=m["content"]))

            # Handle JSON mode and Tracing Metadata
            config = {}
            if metadata:
                config = {"metadata": metadata, "tags": list(metadata.values())}
            
            llm = self.llm
            if response_format and response_format.get("type") == "json_object":
                llm = self.llm.bind(response_format={"type": "json_object"})

            response = await llm.ainvoke(formatted_messages, config=config)
            
            # 1. Track Usage & Cost from LangChain metadata
            usage = response.usage_metadata
            self.last_cost = self._calculate_langchain_cost(usage)
            logger.info(f"[Financial Monitor] Step Cost: ${self.last_cost:.4f}")
            content = response.content

            if response_format and response_format.get("type") == "json_object":
                import json
                try:
                    # Robust cleaning for Markdown-wrapped JSON
                    raw_content = content.strip()
                    if raw_content.startswith("```"):
                        # Extract content between backticks
                        lines = raw_content.splitlines()
                        if lines[0].startswith("```"): lines = lines[1:]
                        if lines[-1].startswith("```"): lines = lines[:-1]
                        raw_content = "\n".join(lines).strip()
                    
                    return json.loads(raw_content)
                except Exception as e:
                    logger.error(f"JSON parsing failed for content: {content[:100]}... Error: {e}")
                    return {"error": "JSON parse failed", "raw": content}
            
            return content
        except Exception as e:
            logger.error(f"Execution failed: {e}")
            if fallback_data is not None:
                return fallback_data
            raise

    def _calculate_langchain_cost(self, usage: Dict) -> float:
        """Calculates cost from LangChain usage metadata."""
        input_tokens = usage.get("input_tokens", 0)
        output_tokens = usage.get("output_tokens", 0)
        return ((input_tokens / 1_000_000) * 5.00) + ((output_tokens / 1_000_000) * 15.00)

class BaseService:
    """Base class for all services with logging support."""
    def __init__(self, **kwargs):
        self.logger = logging.getLogger(self.__class__.__name__)
        # Pass remaining kwargs to next class in MRO
        super().__init__(**kwargs)
