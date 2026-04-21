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


class VisualCorrelationResult(BaseModel):
    confidence_score: int
    reasoning: str
    verified_facts: Dict[str, Any]
    source_url: str

class SEOBlueprintDetailed(BaseModel):
    primary_keywords: List[str]
    semantic_entities: List[str]
    intent_strategy: str
    suggested_title: str

class ContentPlan(BaseModel):
    outline: List[Dict[str, Any]]
    target_intent: str
    required_entities: List[str]

class AiReviewResult(BaseModel):
    recommendation: Literal["accept", "decline"]
    reasoning: str
    metrics: Dict[str, Any]
    confidence_score: float
    screenshot_available: bool
    investigation: Optional[VisualCorrelationResult] = None
    seo_blueprint: Optional[SEOBlueprintDetailed] = None
    content_plan: Optional[ContentPlan] = None
    final_article: Optional[str] = None
