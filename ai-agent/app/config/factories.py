from pathlib import Path

from app.config.runtime_config import (
    ArcadeApiConfig,
    BrowserConfig,
    LlmConfig,
    MongoConfig,
    ObservabilityConfig,
    PostgresConfig,
    QueueConfig,
    RuntimeConfig,
    StorageConfig,
)
from app.config.settings import AppSettings, get_settings


def _build_storage_config(s: AppSettings) -> StorageConfig:
    provider = s.STORAGE_PROVIDER
    if provider == "r2":
        return StorageConfig(
            provider="r2",
            bucket=s.R2_BUCKET_NAME,
            region="auto",
            access_key_id=s.R2_ACCESS_KEY_ID,
            secret_access_key=s.R2_SECRET_ACCESS_KEY,
            endpoint_url=f"https://{s.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com" if s.CLOUDFLARE_ACCOUNT_ID else "",
            force_path_style=False,
            public_url=s.R2_PUBLIC_URL,
            prefix=s.AI_AGENT_S3_PREFIX,
        )
    if provider == "local":
        return StorageConfig(
            provider="local",
            bucket="",
            region="",
            access_key_id="",
            secret_access_key="",
            endpoint_url="",
            force_path_style=False,
            public_url="",
            prefix=s.AI_AGENT_S3_PREFIX,
            local_root=str(Path(__file__).resolve().parents[1] / "stage0_artifacts"),
        )
    return StorageConfig(
        provider="s3",
        bucket=s.AWS_S3_BUCKET,
        region=s.AWS_REGION,
        access_key_id=s.AWS_ACCESS_KEY_ID,
        secret_access_key=s.AWS_SECRET_ACCESS_KEY,
        endpoint_url=s.AWS_S3_ENDPOINT,
        force_path_style=s.AWS_S3_FORCE_PATH_STYLE,
        public_url="",
        prefix=s.AI_AGENT_S3_PREFIX,
    )


def build_runtime_config(app_settings: AppSettings) -> RuntimeConfig:
    return RuntimeConfig(
        arcade_api=ArcadeApiConfig(
            base_url=app_settings.ARCADE_API_BASE_URL,
            api_token=app_settings.ARCADE_API_TOKEN,
            webhook_secret=app_settings.WEBHOOK_SECRET,
        ),
        browser=BrowserConfig(
            client_url=app_settings.CLIENT_URL.rstrip("/"),
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
            critic_min_coverage_score=app_settings.CRITIC_MIN_COVERAGE_SCORE,
            critic_best_coverage_score=app_settings.CRITIC_BEST_COVERAGE_SCORE,
            auditor_min_factual_score=app_settings.AUDITOR_MIN_FACTUAL_SCORE,
            auditor_min_completeness_score=app_settings.AUDITOR_MIN_COMPLETENESS_SCORE,
            max_pipeline_retries=app_settings.MAX_PIPELINE_RETRIES,
            pipeline_data_completeness_threshold=app_settings.PIPELINE_DATA_COMPLETENESS_THRESHOLD,
            stage0_required_candidates=max(1, app_settings.STAGE0_REQUIRED_CANDIDATES),
            stage0_min_candidates=max(1, min(app_settings.STAGE0_MIN_CANDIDATES, app_settings.STAGE0_REQUIRED_CANDIDATES)),
            stage0_max_search_results=max(1, app_settings.STAGE0_MAX_SEARCH_RESULTS),
            stage0_candidate_capture_timeout_seconds=max(5, app_settings.STAGE0_CANDIDATE_CAPTURE_TIMEOUT_SECONDS),
            stage0_medium_confidence_threshold=max(0, min(app_settings.STAGE0_MEDIUM_CONFIDENCE_THRESHOLD, 100)),
            stage0_high_confidence_threshold=max(0, min(app_settings.STAGE0_HIGH_CONFIDENCE_THRESHOLD, 100)),
        ),
        storage=_build_storage_config(app_settings),
    )


def get_runtime_config() -> RuntimeConfig:
    return build_runtime_config(get_settings())
