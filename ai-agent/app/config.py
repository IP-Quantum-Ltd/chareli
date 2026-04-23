from pydantic_settings import BaseSettings
import os

class Settings(BaseSettings):
    # Main ArcadeBox API
    ARCADE_API_BASE_URL: str
    ARCADE_API_TOKEN: str
    CLIENT_URL: str
    SUPERADMIN_EMAIL: str
    SUPERADMIN_PASSWORD: str

    # Database (Postgres)
    DB_HOST: str = "localhost"
    DB_PORT: int = 5432
    DB_USERNAME: str = "postgres"
    DB_PASSWORD: str = "postgres"
    DB_DATABASE: str = "chareli"

    @property
    def DATABASE_URL(self) -> str:
        return f"postgresql+asyncpg://{self.DB_USERNAME}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_DATABASE}"

    # MongoDB
    MONGODB_URL: str = "mongodb://localhost:27017"
    MONGODB_DB_NAME: str = "chareli_ai"

    # Redis (for Arq/Task Queues)
    REDIS_URL: str = "redis://localhost:6379"

    @property
    def ARQ_REDIS_SETTINGS(self):
        from arq.connections import RedisSettings
        from urllib.parse import urlparse
        url = urlparse(self.REDIS_URL)
        return RedisSettings(
            host=url.hostname or "localhost",
            port=url.port or 6379,
            database=int(url.path[1:]) if url.path and url.path[1:] else 0,
            password=url.password,
        )

    # AI Provider Configuration
    AI_PROVIDER: str = "openai"  # "openai" | "claude"
    OPENAI_API_KEY: str
    ANTHROPIC_API_KEY: str = ""
    PRIMARY_LLM_MODEL: str = "gpt-4o"
    SECONDARY_LLM_MODEL: str = "gpt-4o-mini"
    EMBEDDING_MODEL: str = "text-embedding-3-large"

    # Web Search (Double-tap: Tavily for Librarian, Serper for Deep Keyword Research)
    TAVILY_API_KEY: str
    SERPER_API_KEY: str

    # Webhook & Security
    WEBHOOK_SECRET: str = ""
    CRON_INTERVAL_MINUTES: int = 15

    class Config:
        # Look for .env in the root project directory (one level up from app/)
        env_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
        extra = "ignore"

settings = Settings()
