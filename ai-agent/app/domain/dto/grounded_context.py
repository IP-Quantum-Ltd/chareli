from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List


@dataclass
class GroundedContext:
    status: str
    retrieval_queries: List[str] = field(default_factory=list)
    postgres: Dict[str, Any] = field(default_factory=dict)
    mongo: Dict[str, Any] = field(default_factory=dict)
    mongo_persistence: Dict[str, Any] = field(default_factory=dict)
    grounded_packet: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
