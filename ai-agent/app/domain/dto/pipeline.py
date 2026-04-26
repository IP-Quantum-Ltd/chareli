from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List

from app.domain.dto.proposal import ProposalContext


@dataclass
class PipelineState:
    proposal_id: str
    game_id: str
    game_title: str
    proposal_snapshot: Dict[str, Any] = field(default_factory=dict)
    internal_capture_metadata: Dict[str, Any] = field(default_factory=dict)
    internal_imgs_base64: List[str] = field(default_factory=list)
    internal_imgs_paths: List[str] = field(default_factory=list)
    investigation: Dict[str, Any] = field(default_factory=dict)
    seo_blueprint: Dict[str, Any] = field(default_factory=dict)
    grounded_context: Dict[str, Any] = field(default_factory=dict)
    outline: Dict[str, Any] = field(default_factory=dict)
    content_plan_validation: Dict[str, Any] = field(default_factory=dict)
    article: str = ""
    audit_report: Dict[str, Any] = field(default_factory=dict)
    optimization: Dict[str, Any] = field(default_factory=dict)
    revision_history: List[Dict[str, Any]] = field(default_factory=list)
    plan_revision_count: int = 0
    draft_revision_count: int = 0
    max_plan_revisions: int = 2
    max_draft_revisions: int = 2
    accumulated_cost: float = 0.0
    status: str = "starting"
    error_message: str = ""

    @classmethod
    def from_context(cls, context: ProposalContext, max_plan_revisions: int = 2, max_draft_revisions: int = 2) -> "PipelineState":
        return cls(
            proposal_id=context.proposal_id,
            game_id=context.game_id,
            game_title=context.game_title,
            proposal_snapshot=context.proposal_snapshot,
            max_plan_revisions=max_plan_revisions,
            max_draft_revisions=max_draft_revisions,
        )

    def to_graph_state(self) -> Dict[str, Any]:
        return asdict(self)
