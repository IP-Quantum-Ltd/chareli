import logging
from typing import List, Optional, Dict
from openai import AsyncOpenAI
from app.config import settings

logger = logging.getLogger(__name__)

class BaseAIClient:
    """Base class for services that interact with LLMs or generate embeddings."""
    
    def __init__(self, api_key: Optional[str] = None, **kwargs):
        super().__init__(**kwargs)
        self.api_key = api_key or settings.OPENAI_API_KEY
        self._client: Optional[AsyncOpenAI] = None

    @property
    def client(self) -> AsyncOpenAI:
        if self._client is None:
            if not self.api_key or "sk-" not in self.api_key:
                logger.warning("No valid OpenAI API key found for this client.")
            self._client = AsyncOpenAI(api_key=self.api_key)
        return self._client

    async def generate_embedding(self, text: str, model: str = settings.EMBEDDING_MODEL) -> List[float]:
        """Class-based embedding generation (Native mode)."""
        # 3072 is the dimension for text-embedding-3-large
        dimension = 3072
        
        try:
            response = await self.client.embeddings.create(
                input=[text.replace("\n", " ")],
                model=model
            )
            return response.data[0].embedding
        except Exception as e:
            # Fallback for quota or server errors to keep the pipeline moving
            logger.warning(f"Embedding generation failed ({e}). Returning zero-vector fallback.")
            return [0.0] * dimension

    async def chat_completion(self, messages: List[Dict[str, str]], response_format: Optional[Dict] = None, fallback_data: Optional[Dict] = None) -> Dict:
        """Helper for Chat Completions (Native mode)."""

        try:
            response = await self.client.chat.completions.create(
                model="gpt-4o",
                messages=messages,
                response_format=response_format
            )
            import json
            return json.loads(response.choices[0].message.content)
        except Exception as e:
            logger.error(f"Chat completion failed: {e}")
            raise

class BaseService:
    """Base class for all application services."""
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.logger = logging.getLogger(self.__class__.__name__)
