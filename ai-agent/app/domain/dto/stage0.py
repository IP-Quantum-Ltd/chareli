from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class CaptureArtifacts:
    game_id: str
    game_title: str
    paths: List[str]
    metadata: Dict[str, Any] = field(default_factory=dict)
    thumbnail_url: str = ""


@dataclass
class CandidateCapture:
    rank: int
    url: str
    search_query: str
    screenshot_path: str
    metadata_path: str
    metadata: Dict[str, Any]
    correlation: Dict[str, Any]
    seo_intelligence: Dict[str, Any]
    scoring: Dict[str, Any]
    confidence_score: int
    reasoning: str
    extracted_facts: Dict[str, Any]
    comparison_triplet: Dict[str, Any]
    deep_research_results: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class Stage0Investigation:
    status: str
    search_query: str = ""
    search_plan: Dict[str, Any] = field(default_factory=dict)
    exact_identity: Dict[str, Any] = field(default_factory=dict)
    search_engine: str = ""
    search_model: str = ""
    raw_candidates: List[Dict[str, Any]] = field(default_factory=list)
    best_match: Optional[CandidateCapture] = None
    all_candidates: List[CandidateCapture] = field(default_factory=list)
    failures: List[Dict[str, Any]] = field(default_factory=list)
    comparison_scores_path: str = ""
    research_findings_path: str = ""
    reason: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
