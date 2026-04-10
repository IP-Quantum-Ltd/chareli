from pydantic import BaseModel
from typing import Any, Literal, Optional
from datetime import datetime


class ProposalCreatedPayload(BaseModel):
    proposalId: str
    type: Literal["create", "update"]
    gameId: str | None
    editorId: str
    proposedData: dict[str, Any]
    createdAt: datetime


class MetricsScores(BaseModel):
    title_authenticity: float
    developer_credibility: float
    description_quality: float
    category_accuracy: float
    data_consistency: float
    visual_metadata_alignment: Optional[float]  # null if screenshot unavailable


class FaqItem(BaseModel):
    question: str
    answer: str


class EnrichedData(BaseModel):
    discovered_title: Optional[str] = None
    discovered_developer: Optional[str] = None
    discovered_description: Optional[str] = None
    discovered_category: Optional[str] = None
    discovered_faq: list[FaqItem] = []


class AiReviewResult(BaseModel):
    recommendation: Literal["approved", "manual_review", "declined"]
    reasoning: str
    metrics_scores: MetricsScores
    enriched_data: EnrichedData
    flags: list[str]
    confidence_score: float
    screenshot_available: bool
