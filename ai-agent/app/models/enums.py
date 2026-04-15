from enum import Enum

class SearchDepth(str, Enum):
    BASIC = "basic"
    ADVANCED = "advanced"

class SearchProvider(str, Enum):
    TAVILY = "tavily"
    SERPER = "serper"

class ContentIntent(str, Enum):
    INFORMATIONAL = "informational"
    TRANSACTIONAL = "transactional"

class AgentType(str, Enum):
    ANALYST = "analyst"    # Stage 1
    LIBRARIAN = "librarian" # Stage 2
    ARCHITECT = "architect" # Stage 3
    CRITIC = "critic"       # Stage 4
    SCRIBE = "scribe"       # Stage 5
    AUDITOR = "auditor"     # Stage 6
    OPTIMIZER = "optimizer" # Stage 7
