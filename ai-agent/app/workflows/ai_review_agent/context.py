from typing import Any, Dict, TypedDict


class AgentState(TypedDict, total=False):
    proposal_id: str
    game_id: str
    game_title: str
    proposal_snapshot: Dict[str, Any]
    submit_review: bool
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
    current_stage: str
    stage_trace: list[Dict[str, Any]]
    review: Dict[str, Any]
    result_payload: Dict[str, Any]
    warnings: list[str]
    status: str
    error_message: str


def build_initial_state(
    *,
    proposal_id: str = "",
    game_id: str = "",
    submit_review: bool = False,
    max_plan_revisions: int,
    max_draft_revisions: int,
) -> Dict[str, Any]:
    return {
        "proposal_id": proposal_id,
        "game_id": game_id,
        "game_title": "",
        "proposal_snapshot": {},
        "submit_review": submit_review,
        "internal_capture_metadata": {},
        "internal_imgs_base64": [],
        "internal_imgs_paths": [],
        "investigation": {},
        "seo_blueprint": {},
        "grounded_context": {},
        "outline": {},
        "content_plan_validation": {},
        "article": "",
        "audit_report": {},
        "optimization": {},
        "revision_history": [],
        "plan_revision_count": 0,
        "draft_revision_count": 0,
        "max_plan_revisions": max_plan_revisions,
        "max_draft_revisions": max_draft_revisions,
        "accumulated_cost": 0.0,
        "current_stage": "starting",
        "stage_trace": [],
        "review": {},
        "result_payload": {},
        "warnings": [],
        "status": "starting",
        "error_message": "",
    }


def ensure_state_defaults(state: Dict[str, Any]) -> Dict[str, Any]:
    state.setdefault("proposal_id", "")
    state.setdefault("game_id", "")
    state.setdefault("game_title", "")
    state.setdefault("proposal_snapshot", {})
    state.setdefault("submit_review", False)
    state.setdefault("internal_capture_metadata", {})
    state.setdefault("internal_imgs_base64", [])
    state.setdefault("internal_imgs_paths", [])
    state.setdefault("investigation", {})
    state.setdefault("seo_blueprint", {})
    state.setdefault("grounded_context", {})
    state.setdefault("outline", {})
    state.setdefault("content_plan_validation", {})
    state.setdefault("article", "")
    state.setdefault("audit_report", {})
    state.setdefault("optimization", {})
    state.setdefault("revision_history", [])
    state.setdefault("plan_revision_count", 0)
    state.setdefault("draft_revision_count", 0)
    state.setdefault("max_plan_revisions", 2)
    state.setdefault("max_draft_revisions", 2)
    state.setdefault("accumulated_cost", 0.0)
    state.setdefault("current_stage", "starting")
    state.setdefault("stage_trace", [])
    state.setdefault("review", {})
    state.setdefault("result_payload", {})
    state.setdefault("warnings", [])
    state.setdefault("status", "starting")
    state.setdefault("error_message", "")
    return state


def record_stage(state: Dict[str, Any], stage: str, status: str, detail: str = "") -> None:
    state["current_stage"] = stage
    state.setdefault("stage_trace", []).append(
        {
            "stage": stage,
            "status": status,
            "detail": detail,
        }
    )
