from typing import Any, Dict, TypedDict

from app.domain.dto import PipelineState, ProposalContext


class AgentState(TypedDict):
    proposal_id: str
    game_id: str
    game_title: str
    proposal_snapshot: Dict[str, Any]
    internal_capture_metadata: Dict[str, Any]
    internal_imgs_base64: list[str]
    internal_imgs_paths: list[str]
    investigation: Dict[str, Any]
    seo_blueprint: Dict[str, Any]
    grounded_context: Dict[str, Any]
    outline: Dict[str, Any]
    content_plan_validation: Dict[str, Any]
    article: str
    audit_report: Dict[str, Any]
    optimization: Dict[str, Any]
    revision_history: list[Dict[str, Any]]
    plan_revision_count: int
    draft_revision_count: int
    max_plan_revisions: int
    max_draft_revisions: int
    accumulated_cost: float
    status: str
    error_message: str


def build_initial_state(context: ProposalContext, max_plan_revisions: int, max_draft_revisions: int) -> Dict[str, Any]:
    return PipelineState.from_context(
        context,
        max_plan_revisions=max_plan_revisions,
        max_draft_revisions=max_draft_revisions,
    ).to_graph_state()
