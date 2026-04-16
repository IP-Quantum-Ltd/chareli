from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Main ArcadeBox API
    ARCADE_API_BASE_URL: str
    ARCADE_API_TOKEN: str  # Non-expiry editor-role service account token

    # Database
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

    # Redis
    REDIS_URL: str = "redis://localhost:6379"

    @property
    def ARQ_REDIS_SETTINGS(self):
        from arq.connections import RedisSettings
        # Parse redis://localhost:6379 or similar
        from urllib.parse import urlparse
        url = urlparse(self.REDIS_URL)
        return RedisSettings(
            host=url.hostname or "localhost",
            port=url.port or 6379,
            database=int(url.path[1:]) if url.path and url.path[1:] else 0,
            password=url.password
        )

    # OpenAI
    OPENAI_API_KEY: str
    AI_PROVIDER: str = "openai"  # "openai" | "claude" — toggle without code changes
    PRIMARY_LLM_MODEL: str = "gpt-4o"
    SECONDARY_LLM_MODEL: str = "gpt-4o-mini"
    EMBEDDING_MODEL: str = "text-embedding-3-large"

    # Web Search
    TAVILY_API_KEY: str
    SERPER_API_KEY: str

    # Anthropic (Claude fallback)
    ANTHROPIC_API_KEY: str = ""

    # Webhook security
    WEBHOOK_SECRET: str = ""

    # Cron
    CRON_INTERVAL_MINUTES: int = 15

    class Config:
        import os
        env_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
        extra = "ignore"


settings = Settings()
