from typing import Any, Dict, List

from pydantic import BaseModel, Field, model_validator


class SearchPlanOutput(BaseModel):
    search_terms: List[str] = Field(default_factory=list)
    visual_cues: List[str] = Field(default_factory=list)
    reasoning: str = ""


class ExactGameIdentityOutput(BaseModel):
    exact_game_name: str = ""
    aliases: List[str] = Field(default_factory=list)
    distinguishing_features: List[str] = Field(default_factory=list)
    avoid_titles: List[str] = Field(default_factory=list)
    reasoning: str = ""


class CorrelationFactsOutput(BaseModel):
    controls: str = ""
    rules: str = ""
    objective: str = ""
    original_developer: str = ""


class CorrelationOutput(BaseModel):
    confidence_score: int = 0
    visual_match_score: int = 0
    reasoning: str = ""
    facts: CorrelationFactsOutput = Field(default_factory=CorrelationFactsOutput)


class DeepContentOutput(BaseModel):
    objective: str = ""
    controls: str = ""
    rules: str = ""
    original_developer: str = ""


class KeywordClusterOutput(BaseModel):
    cluster_name: str = ""
    search_intent: str = ""
    keywords: List[str] = Field(default_factory=list)


class FaqOpportunityOutput(BaseModel):
    question: str = ""
    source_signal: str = ""
    answer_angle: str = ""


class MetadataRecommendationsOutput(BaseModel):
    slug: str = ""
    title_tag: str = ""
    meta_description: str = ""
    primary_h1: str = ""


class SeoAnalysisOutput(BaseModel):
    primary_keywords: List[str] = Field(default_factory=list)
    secondary_keywords: List[str] = Field(default_factory=list)
    long_tail_keywords: List[str] = Field(default_factory=list)
    semantic_entities: List[str] = Field(default_factory=list)
    keyword_clusters: List[KeywordClusterOutput] = Field(default_factory=list)
    search_intents: List[str] = Field(default_factory=list)
    audience_segments: List[str] = Field(default_factory=list)
    content_angles: List[str] = Field(default_factory=list)
    serp_features: List[str] = Field(default_factory=list)
    faq_opportunities: List[FaqOpportunityOutput] = Field(default_factory=list)
    metadata_recommendations: MetadataRecommendationsOutput = Field(default_factory=MetadataRecommendationsOutput)
    intent_strategy: str = ""
    suggested_title: str = ""


class PlanSectionOutput(BaseModel):
    title: str = ""
    goals: List[str] = Field(default_factory=list)


class ContentPlanOutput(BaseModel):
    sections: List[PlanSectionOutput] = Field(default_factory=list)
    estimated_word_count: int = 0
    formatting_requirements: List[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _ensure_canonical_sections(self) -> "ContentPlanOutput":
        """Ensure all 5 canonical sections are present (case-insensitive)."""
        from app.workflows.ai_review_agent.services.proposal_structure import CANONICAL_SECTIONS
        existing = {s.title.strip().lower() for s in self.sections}
        missing = [
            name for name in CANONICAL_SECTIONS
            if name.lower() not in existing
        ]
        if missing:
            # Append missing sections with empty goals — the critic will request revision
            for name in missing:
                self.sections.append(PlanSectionOutput(title=name, goals=[]))
        return self


class ContentPlanValidationOutput(BaseModel):
    approved: bool = False
    coverage_score: int = 0
    missing_facts: List[str] = Field(default_factory=list)
    missing_entities: List[str] = Field(default_factory=list)
    revision_instructions: List[str] = Field(default_factory=list)
    reasoning: str = ""


class GroundedIdentityOutput(BaseModel):
    game_title: str = ""
    source_url: str = ""
    source_domain: str = ""
    confidence_score: int = 0


class GroundedGameplayOutput(BaseModel):
    controls: str = ""
    rules: str = ""
    objective: str = ""
    developer: str = ""
    publisher: str = ""
    how_to_play: str = ""
    features: List[str] = Field(default_factory=list)


class GroundedSeoSupportOutput(BaseModel):
    primary_keywords: List[str] = Field(default_factory=list)
    secondary_keywords: List[str] = Field(default_factory=list)
    faq_opportunities: List[FaqOpportunityOutput] = Field(default_factory=list)
    content_angles: List[str] = Field(default_factory=list)


class GroundedFaqEvidenceItemOutput(BaseModel):
    question: str = ""
    answer: str = ""


class GroundedContextOutput(BaseModel):
    canonical_identity: GroundedIdentityOutput = Field(default_factory=GroundedIdentityOutput)
    grounded_gameplay: GroundedGameplayOutput = Field(default_factory=GroundedGameplayOutput)
    seo_support: GroundedSeoSupportOutput = Field(default_factory=GroundedSeoSupportOutput)
    faq_evidence: List[GroundedFaqEvidenceItemOutput] = Field(default_factory=list)
    retrieval_queries: List[str] = Field(default_factory=list)
    evidence_notes: List[str] = Field(default_factory=list)


class AuditReportOutput(BaseModel):
    approved: bool = False
    factual_accuracy_score: int = 0
    completeness_score: int = 0
    unsupported_claims: List[str] = Field(default_factory=list)
    verified_claims: List[str] = Field(default_factory=list)
    revision_instructions: List[str] = Field(default_factory=list)
    reasoning: str = ""
    # New fields for structural compliance
    section_structure_ok: bool = True
    cross_section_duplicates: List[str] = Field(default_factory=list)
    trademark_violations: List[str] = Field(default_factory=list)


class FaqSchemaItemOutput(BaseModel):
    question: str = ""
    answer: str = ""


class OptimizerEvaluationOutput(BaseModel):
    factual_accuracy_score: int = 0
    completeness_score: int = 0
    overall_ready: bool = False


class SeoOptimizerOutput(BaseModel):
    meta_title: str = ""
    meta_description: str = ""
    primary_h1: str = ""
    faq_schema: List[FaqSchemaItemOutput] = Field(default_factory=list)
    heading_audit: Dict[str, Any] = Field(default_factory=dict)
    evaluation: OptimizerEvaluationOutput = Field(default_factory=OptimizerEvaluationOutput)


class GameMetadataOutput(BaseModel):
    howToPlay: str = ""
    faqOverride: str = ""
    features: List[str] = Field(default_factory=list)
    tags: List[str] = Field(default_factory=list)
    seoKeywords: str = ""
    developer: str = ""
    platform: List[str] = Field(default_factory=lambda: ["Browser"])
    releaseDate: str = ""


class ProposedGameDataOutput(BaseModel):
    title: str = ""
    description: str = ""
    categoryId: str = ""
    metadata: GameMetadataOutput = Field(default_factory=GameMetadataOutput)


class StructuredArticleSectionOutput(BaseModel):
    """Internal model used to validate that the scribe produced all 5 sections."""
    heading: str = ""
    content_html: str = ""
    word_count: int = 0


class StructuredArticleOutput(BaseModel):
    """Internal validation model for the scribe's structured article output."""
    overview: StructuredArticleSectionOutput = Field(default_factory=StructuredArticleSectionOutput)
    how_to_play: StructuredArticleSectionOutput = Field(default_factory=StructuredArticleSectionOutput)
    controls: StructuredArticleSectionOutput = Field(default_factory=StructuredArticleSectionOutput)
    strategy: StructuredArticleSectionOutput = Field(default_factory=StructuredArticleSectionOutput)
    faq_items: List[FaqSchemaItemOutput] = Field(default_factory=list)
