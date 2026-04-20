from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # Main ArcadeBox API
    ARCADE_API_BASE_URL: str
    ARCADE_API_TOKEN: str

    # OpenAI
    OPENAI_API_KEY: str
    AI_PROVIDER: str = "openai"

    # Search & Research
    SERPER_API_KEY: str = ""
    TAVILY_API_KEY: str = ""

    # Databases
    DATABASE_URL: str = ""  # Postgres
    MONGODB_URL: str = ""
    MONGODB_DB_NAME: str = "ai_review_db"

    # Webhook & Cron
    WEBHOOK_SECRET: str = ""
    CRON_INTERVAL_MINUTES: int = 15

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()
