from dataclasses import dataclass, field
from typing import Any, Dict


@dataclass
class ProposalContext:
    proposal_id: str
    game_id: str
    game_title: str
    proposal_snapshot: Dict[str, Any] = field(default_factory=dict)
