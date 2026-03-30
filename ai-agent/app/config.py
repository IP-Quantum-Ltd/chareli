from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Main ArcadeBox API
    ARCADE_API_BASE_URL: str
    ARCADE_API_TOKEN: str  # Non-expiry editor-role service account token

    # OpenAI
    OPENAI_API_KEY: str
    AI_PROVIDER: str = "openai"  # "openai" | "claude" — toggle without code changes

    # Anthropic (Claude fallback)
    ANTHROPIC_API_KEY: str = ""

    # Webhook security
    WEBHOOK_SECRET: str = ""

    # Cron
    CRON_INTERVAL_MINUTES: int = 15

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
