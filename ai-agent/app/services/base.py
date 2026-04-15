import logging
from typing import List, Optional
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
        """Class-based embedding generation with fallback support."""
        # Preliminary check
        if not self.api_key or "sk-" not in self.api_key or "dummy" in self.api_key.lower():
            return [0.0] * 3072
            
        try:
            response = await self.client.embeddings.create(
                input=[text.replace("\n", " ")],
                model=model
            )
            return response.data[0].embedding
        except Exception as e:
            # If we get an auth error but we are in dev/mock territory, fallback
            if "401" in str(e) or "invalid_api_key" in str(e):
                logger.warning(f"OpenAI Auth failed (401). Falling back to mock embedding.")
                return [0.0] * 3072
            logger.error(f"Failed to generate embedding: {e}")
            raise

class BaseService:
    """Base class for all application services."""
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.logger = logging.getLogger(self.__class__.__name__)
