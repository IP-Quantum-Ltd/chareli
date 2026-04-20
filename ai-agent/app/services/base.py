import os
import logging
from typing import List, Dict, Any, Optional
from openai import AsyncOpenAI
from app.config import settings

logger = logging.getLogger(__name__)

class BaseAIClient:
    """Base class for AI-powered agents with resilient helpers."""
    
    def __init__(self, **kwargs):
        # Pass remaining kwargs to next class in MRO
        super().__init__(**kwargs)
        self.client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        self.last_cost = 0.0
        self.last_usage = None

    async def generate_embedding(self, text: str, model: str = "text-embedding-3-large") -> List[float]:
        """Generates a high-dimension vector for RAG."""
        try:
            response = await self.client.embeddings.create(input=text, model=model)
            return response.data[0].embedding
        except Exception as e:
            logger.error(f"Embedding failed: {e}")
            return [0.0] * 3072

    async def chat_completion(self, messages: List[Dict[str, str]], response_format: Optional[Dict] = None, fallback_data: Optional[Any] = None):
        """Helper for Chat Completions with real-time cost tracking."""
        try:
            response = await self.client.chat.completions.create(
                model="gpt-4o",
                messages=messages,
                response_format=response_format,
                stream=False
            )
            
            # 1. Track Usage & Cost
            usage = response.usage
            cost = self._calculate_cost(usage)
            logger.info(f"[Financial Monitor] Step Cost: ${cost:.4f} | Total: {usage.total_tokens} tokens")
            
            # Save usage to class for LangGraph aggregation
            self.last_usage = usage
            self.last_cost = cost

            content = response.choices[0].message.content
            
            if response_format and response_format.get("type") == "json_object":
                import json
                return json.loads(content)
            
            return content
        except Exception as e:
            logger.error(f"Chat completion failed: {e}")
            if fallback_data is not None:
                return fallback_data
            raise

    def _calculate_cost(self, usage) -> float:
        """Calculates USD cost based on GPT-4o pricing."""
        # GPT-4o Pricing (April 2024): 
        # $5.00 / 1M input tokens | $15.00 / 1M output tokens
        input_cost = (usage.prompt_tokens / 1_000_000) * 5.00
        output_cost = (usage.completion_tokens / 1_000_000) * 15.00
        return input_cost + output_cost

class BaseService:
    """Base class for all services with logging support."""
    def __init__(self, **kwargs):
        self.logger = logging.getLogger(self.__class__.__name__)
        # Pass remaining kwargs to next class in MRO
        super().__init__(**kwargs)
