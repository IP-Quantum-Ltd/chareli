from app.config.runtime_config import (
    ArcadeApiConfig,
    BrowserConfig,
    LlmConfig,
    MongoConfig,
    ObservabilityConfig,
    PostgresConfig,
    QueueConfig,
    RuntimeConfig,
)
from app.config.settings import AppSettings, get_settings


def build_runtime_config(app_settings: AppSettings) -> RuntimeConfig:
    return RuntimeConfig(
        arcade_api=ArcadeApiConfig(
            base_url=app_settings.ARCADE_API_BASE_URL,
            api_token=app_settings.ARCADE_API_TOKEN,
            webhook_secret=app_settings.WEBHOOK_SECRET,
        ),
        browser=BrowserConfig(
            client_url=app_settings.CLIENT_URL.rstrip("/"),
            admin_email=app_settings.SUPERADMIN_EMAIL,
            admin_password=app_settings.SUPERADMIN_PASSWORD,
            viewport_width=app_settings.BROWSER_VIEWPORT_WIDTH,
            viewport_height=app_settings.BROWSER_VIEWPORT_HEIGHT,
            external_page_timeout_ms=app_settings.EXTERNAL_PAGE_TIMEOUT_MS,
            internal_page_timeout_ms=app_settings.INTERNAL_PAGE_TIMEOUT_MS,
        ),
        llm=LlmConfig(
            provider=app_settings.AI_PROVIDER,
            openai_api_key=app_settings.OPENAI_API_KEY,
            anthropic_api_key=app_settings.ANTHROPIC_API_KEY,
            primary_model=app_settings.PRIMARY_LLM_MODEL,
            secondary_model=app_settings.SECONDARY_LLM_MODEL,
            embedding_model=app_settings.EMBEDDING_MODEL,
            web_search_model=app_settings.OPENAI_WEB_SEARCH_MODEL,
        ),
        observability=ObservabilityConfig(
            tracing_enabled=app_settings.LANGCHAIN_TRACING_V2,
            api_key=app_settings.LANGCHAIN_API_KEY,
            project=app_settings.LANGCHAIN_PROJECT,
            endpoint=app_settings.LANGCHAIN_ENDPOINT,
        ),
        postgres=PostgresConfig(
            database_url=app_settings.DATABASE_URL,
            host=app_settings.DB_HOST,
            port=app_settings.DB_PORT,
            username=app_settings.DB_USERNAME,
            password=app_settings.DB_PASSWORD,
            database=app_settings.DB_DATABASE,
        ),
        mongo=MongoConfig(
            url=app_settings.MONGODB_URL,
            database_name=app_settings.MONGODB_DB_NAME,
            rag_collection=app_settings.MONGODB_RAG_COLLECTION,
            vector_index=app_settings.MONGODB_VECTOR_INDEX,
            evaluation_collection=app_settings.MONGODB_EVALUATION_COLLECTION,
        ),
        queue=QueueConfig(
            cron_interval_minutes=app_settings.CRON_INTERVAL_MINUTES,
            max_plan_revisions=app_settings.MAX_PLAN_REVISIONS,
            max_draft_revisions=app_settings.MAX_DRAFT_REVISIONS,
            job_retention_hours=app_settings.JOB_RETENTION_HOURS,
            stage0_required_candidates=max(1, app_settings.STAGE0_REQUIRED_CANDIDATES),
            stage0_max_search_results=max(1, app_settings.STAGE0_MAX_SEARCH_RESULTS),
            stage0_candidate_capture_timeout_seconds=max(5, app_settings.STAGE0_CANDIDATE_CAPTURE_TIMEOUT_SECONDS),
        ),
    )


def get_runtime_config() -> RuntimeConfig:
    return build_runtime_config(get_settings())
