from app.config import LlmConfig, ObservabilityConfig
from app.infrastructure.llm.ai_executor import AIExecutor
from app.services.observability import configure_observability


class AIClientFactory:
    def __init__(self, llm_config: LlmConfig, observability_config: ObservabilityConfig):
        self._llm_config = llm_config
        self._observability_config = observability_config

    def create_executor(self) -> AIExecutor:
        configure_observability(self._observability_config)
        return AIExecutor(self._llm_config)
