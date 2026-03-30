from pydantic import BaseModel
from typing import Any, Literal
from datetime import datetime


class ProposalCreatedPayload(BaseModel):
    proposalId: str
    type: Literal["create", "update"]
    gameId: str | None
    editorId: str
    proposedData: dict[str, Any]
    createdAt: datetime


class AiReviewResult(BaseModel):
    recommendation: Literal["accept", "decline"]
    reasoning: str
    metrics: dict[str, Any]
    confidence_score: float
    screenshot_available: bool
