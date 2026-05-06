import os

from app.config import ObservabilityConfig


def configure_observability(config: ObservabilityConfig) -> None:
    if not config.tracing_enabled:
        os.environ["LANGSMITH_TRACING"] = "false"
        return
    os.environ["LANGCHAIN_TRACING_V2"] = "true"
    os.environ["LANGCHAIN_API_KEY"] = config.api_key
    os.environ["LANGCHAIN_PROJECT"] = config.project
    os.environ["LANGCHAIN_ENDPOINT"] = config.endpoint
    os.environ["LANGSMITH_TRACING"] = "true"
    os.environ["LANGSMITH_API_KEY"] = config.api_key
    os.environ["LANGSMITH_PROJECT"] = config.project
    os.environ["LANGSMITH_ENDPOINT"] = config.endpoint
