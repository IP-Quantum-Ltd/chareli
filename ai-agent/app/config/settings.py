from functools import lru_cache

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class AppSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    ARCADE_API_BASE_URL: str
    ARCADE_API_TOKEN: str

    OPENAI_API_KEY: str
    ANTHROPIC_API_KEY: str = ""
    AI_PROVIDER: str = "openai"
    PRIMARY_LLM_MODEL: str = "gpt-4o"
    SECONDARY_LLM_MODEL: str = "gpt-4o-mini"
    EMBEDDING_MODEL: str = "text-embedding-3-large"
    OPENAI_WEB_SEARCH_MODEL: str = "gpt-5.4-mini"

    CLIENT_URL: str = "https://staging.arcadesbox.com/"
    SUPERADMIN_EMAIL: str
    SUPERADMIN_PASSWORD: str
    BROWSER_VIEWPORT_WIDTH: int = 1280
    BROWSER_VIEWPORT_HEIGHT: int = 800
    EXTERNAL_PAGE_TIMEOUT_MS: int = 45000
    INTERNAL_PAGE_TIMEOUT_MS: int = 15000

    LANGCHAIN_TRACING_V2: bool = Field(default=True, validation_alias=AliasChoices("LANGCHAIN_TRACING_V2", "LANGSMITH_TRACING"))
    LANGCHAIN_API_KEY: str = Field(default="", validation_alias=AliasChoices("LANGCHAIN_API_KEY", "LANGSMITH_API_KEY"))
    LANGCHAIN_PROJECT: str = Field(default="ArcadeBox-SEO-Agent", validation_alias=AliasChoices("LANGCHAIN_PROJECT", "LANGSMITH_PROJECT"))
    LANGCHAIN_ENDPOINT: str = Field(default="https://api.smith.langchain.com", validation_alias=AliasChoices("LANGCHAIN_ENDPOINT", "LANGSMITH_ENDPOINT"))

    DATABASE_URL: str = ""
    DB_HOST: str = ""
    DB_PORT: int = 5432
    DB_USERNAME: str = ""
    DB_PASSWORD: str = ""
    DB_DATABASE: str = ""
    MONGODB_URL: str = ""
    MONGODB_DB_NAME: str = "ai_review_db"
    MONGODB_RAG_COLLECTION: str = "stage2_grounded_contexts"
    MONGODB_VECTOR_INDEX: str = "stage2_grounded_context_vector_index"
    MONGODB_EVALUATION_COLLECTION: str = "agent_evaluations"

    WEBHOOK_SECRET: str = ""
    CRON_INTERVAL_MINUTES: int = 15
    MAX_PLAN_REVISIONS: int = 2
    MAX_DRAFT_REVISIONS: int = 2
    JOB_RETENTION_HOURS: int = 24
    CRITIC_MIN_COVERAGE_SCORE: int = 70
    AUDITOR_MIN_FACTUAL_SCORE: int = 75
    AUDITOR_MIN_COMPLETENESS_SCORE: int = 70
    STAGE0_REQUIRED_CANDIDATES: int = 5
    STAGE0_MIN_CANDIDATES: int = 3
    STAGE0_MAX_SEARCH_RESULTS: int = 5
    STAGE0_CANDIDATE_CAPTURE_TIMEOUT_SECONDS: int = 30
    STAGE0_MEDIUM_CONFIDENCE_THRESHOLD: int = 75
    STAGE0_HIGH_CONFIDENCE_THRESHOLD: int = 90


@lru_cache(maxsize=1)
def get_settings() -> AppSettings:
    return AppSettings()
