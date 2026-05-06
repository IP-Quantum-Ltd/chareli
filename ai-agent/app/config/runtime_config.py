from dataclasses import dataclass


@dataclass(frozen=True)
class ArcadeApiConfig:
    base_url: str
    api_token: str
    webhook_secret: str


@dataclass(frozen=True)
class BrowserConfig:
    client_url: str
    admin_email: str
    admin_password: str
    viewport_width: int
    viewport_height: int
    external_page_timeout_ms: int
    internal_page_timeout_ms: int
    external_user_agent: str = (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    )


@dataclass(frozen=True)
class LlmConfig:
    provider: str
    openai_api_key: str
    anthropic_api_key: str
    primary_model: str
    secondary_model: str
    embedding_model: str
    web_search_model: str


@dataclass(frozen=True)
class ObservabilityConfig:
    tracing_enabled: bool
    api_key: str
    project: str
    endpoint: str


@dataclass(frozen=True)
class PostgresConfig:
    database_url: str
    host: str
    port: int
    username: str
    password: str
    database: str


@dataclass(frozen=True)
class MongoConfig:
    url: str
    database_name: str
    rag_collection: str
    vector_index: str
    evaluation_collection: str


@dataclass(frozen=True)
class QueueConfig:
    cron_interval_minutes: int
    max_plan_revisions: int
    max_draft_revisions: int
    job_retention_hours: int
    critic_min_coverage_score: int
    auditor_min_factual_score: int
    auditor_min_completeness_score: int
    stage0_required_candidates: int
    stage0_min_candidates: int
    stage0_max_search_results: int
    stage0_candidate_capture_timeout_seconds: int
    stage0_medium_confidence_threshold: int
    stage0_high_confidence_threshold: int


@dataclass(frozen=True)
class RuntimeConfig:
    arcade_api: ArcadeApiConfig
    browser: BrowserConfig
    llm: LlmConfig
    observability: ObservabilityConfig
    postgres: PostgresConfig
    mongo: MongoConfig
    queue: QueueConfig
