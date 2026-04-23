from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Main ArcadeBox API
    ARCADE_API_BASE_URL: str
    ARCADE_API_TOKEN: str

    # OpenAI
    OPENAI_API_KEY: str
    AI_PROVIDER: str = "openai"
    PRIMARY_LLM_MODEL: str = "gpt-4o"
    SECONDARY_LLM_MODEL: str = "gpt-4o-mini"
    EMBEDDING_MODEL: str = "text-embedding-3-large"
    CLIENT_URL: str = "https://staging.arcadesbox.com/"
    SUPERADMIN_EMAIL: str
    SUPERADMIN_PASSWORD: str

    # Observability (LangSmith)
    LANGCHAIN_TRACING_V2: bool = True
    LANGCHAIN_API_KEY: str = ""
    LANGCHAIN_PROJECT: str = "ArcadeBox-SEO-Agent"
    LANGCHAIN_ENDPOINT: str = "https://api.smith.langchain.com"

    # Databases
    DATABASE_URL: str = ""  # Postgres
    DB_HOST: str = ""
    DB_PORT: int = 5432
    DB_USERNAME: str = ""
    DB_PASSWORD: str = ""
    DB_DATABASE: str = ""
    MONGODB_URL: str = ""
    MONGODB_DB_NAME: str = "ai_review_db"
    MONGODB_RAG_COLLECTION: str = "stage2_grounded_contexts"
    MONGODB_VECTOR_INDEX: str = "stage2_grounded_context_vector_index"

    # Librarian Configuration
    # 'precision' (Classic Scoring), 'batch' (Colleague), 'hybrid' (Both)
    LIBRARIAN_MODE: str = "precision"
    TEST_GAME_ID: str = "d1fbe524-b5e6-434c-91c4-bd3e7032fc72"
    TEST_GAME_TITLE: str = "Feed monster"

    # Webhook & Cron
    WEBHOOK_SECRET: str = ""
    CRON_INTERVAL_MINUTES: int = 15

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
