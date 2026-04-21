from pydantic import BaseModel
from typing import Any, Literal, Optional, Dict
from datetime import datetime


class ProposalCreatedPayload(BaseModel):
    proposalId: str
    type: Literal["create", "update"]
    gameId: Optional[str]
    editorId: str
    proposedData: Dict[str, Any]
    createdAt: datetime


class AiReviewResult(BaseModel):
    recommendation: Literal["accept", "decline"]
    reasoning: str
    metrics: Dict[str, Any]
    confidence_score: float
    screenshot_available: bool
