from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class VisualCorrelationResult(BaseModel):
    confidence_score: int
    reasoning: str
    verified_facts: Dict[str, Any]
    source_url: str
    all_candidates: List[Dict[str, Any]] = Field(default_factory=list)
    deep_research_results: Dict[str, Any] = Field(default_factory=dict)


class KeywordCluster(BaseModel):
    cluster_name: str
    search_intent: str
    keywords: List[str] = Field(default_factory=list)


class FaqOpportunity(BaseModel):
    question: str
    source_signal: str = ""
    answer_angle: str = ""


class SEOBlueprintDetailed(BaseModel):
    primary_keywords: List[str] = Field(default_factory=list)
    secondary_keywords: List[str] = Field(default_factory=list)
    long_tail_keywords: List[str] = Field(default_factory=list)
    semantic_entities: List[str] = Field(default_factory=list)
    keyword_clusters: List[KeywordCluster] = Field(default_factory=list)
    search_intents: List[str] = Field(default_factory=list)
    audience_segments: List[str] = Field(default_factory=list)
    content_angles: List[str] = Field(default_factory=list)
    serp_features: List[str] = Field(default_factory=list)
    faq_opportunities: List[FaqOpportunity] = Field(default_factory=list)
    metadata_recommendations: Dict[str, Any] = Field(default_factory=dict)
    intent_strategy: str
    suggested_title: str


class ContentSection(BaseModel):
    title: str
    goals: List[str] = Field(default_factory=list)


class ContentPlan(BaseModel):
    sections: List[ContentSection] = Field(default_factory=list)
    estimated_word_count: int = 0
    formatting_requirements: List[str] = Field(default_factory=list)


class GroundedContextResult(BaseModel):
    canonical_identity: Dict[str, Any] = Field(default_factory=dict)
    grounded_gameplay: Dict[str, Any] = Field(default_factory=dict)
    seo_support: Dict[str, Any] = Field(default_factory=dict)
    faq_evidence: List[Dict[str, Any]] = Field(default_factory=list)
    retrieval_queries: List[str] = Field(default_factory=list)
    evidence_notes: List[str] = Field(default_factory=list)


class AiReviewResult(BaseModel):
    recommendation: Literal["accept", "decline"]
    reasoning: str
    metrics: Dict[str, Any]
    confidence_score: float
    screenshot_available: bool
    investigation: Optional[VisualCorrelationResult] = None
    seo_blueprint: Optional[SEOBlueprintDetailed] = None
    grounded_context: Optional[GroundedContextResult] = None
    content_plan: Optional[ContentPlan] = None
    final_article: Optional[str] = None
    audit_report: Optional[Dict[str, Any]] = None
    optimization: Optional[Dict[str, Any]] = None
