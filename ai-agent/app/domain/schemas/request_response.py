from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel


class ProposalCreatedPayload(BaseModel):
    proposalId: str
    type: Literal["create", "update"]
    gameId: Optional[str]
    editorId: str
    proposedData: Dict[str, Any]
    createdAt: datetime


class Stage0RunRequest(BaseModel):
    game_id: str


class AgentRunRequest(BaseModel):
    game_id: str
    submit_review: bool = False


class AgentRunResponse(BaseModel):
    accepted: bool
    job_id: str
    status: str
    game_id: str


class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    job_type: str
    target_id: str
    submit_review: bool
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error_message: Optional[str] = None
    result: Optional[Dict[str, Any]] = None


class JobListResponse(BaseModel):
    jobs: List[JobStatusResponse]


class Stage0ArtifactPaths(BaseModel):
    internal_thumbnail_path: str = ""
    internal_gameplay_path: str = ""
    comparison_scores_path: str = ""
    research_findings_path: str = ""
    stage0_manifest_path: str = ""


class Stage0RunResponse(BaseModel):
    game_id: str
    game_title: str
    status: str
    reason: Optional[str] = None
    search_query: Optional[str] = None
    candidate_count: int = 0
    best_match_url: str = ""
    confidence_score: int = 0
    artifact_paths: Stage0ArtifactPaths


class HealthResponse(BaseModel):
    status: str
