import logging
from typing import Any, Awaitable, Callable, Dict, List

try:
    from langsmith import traceable
except ModuleNotFoundError:  # pragma: no cover
    def traceable(*args: Any, **kwargs: Any) -> Callable[[Callable[..., Awaitable[Any]]], Callable[..., Awaitable[Any]]]:
        def decorator(func: Callable[..., Awaitable[Any]]) -> Callable[..., Awaitable[Any]]:
            return func
        return decorator

from app.workflows.ai_review_agent.context import record_stage

logger = logging.getLogger(__name__)


class FinalizeResultNode:
    def __init__(self, review_mapper):
        self.review_mapper = review_mapper

    def _build_seo_meta(self, state: Dict[str, Any]) -> Dict[str, Any]:
        seo_blueprint = state.get("seo_blueprint") or {}
        optimization = state.get("optimization") or {}
        investigation = state.get("investigation") or {}
        grounded_context = state.get("grounded_context") or {}

        meta_recs = seo_blueprint.get("metadata_recommendations") or {}
        grounded_gameplay = (grounded_context.get("grounded_gameplay") or {})
        verified_facts = ((investigation.get("best_match") or {}).get("extracted_facts") or {})

        # Stage 7 optimizer wins; Stage 1 blueprint is the fallback
        title_tag = (
            optimization.get("meta_title")
            or meta_recs.get("title_tag")
            or state.get("game_title")
            or ""
        ).strip()
        meta_description = (
            optimization.get("meta_description")
            or meta_recs.get("meta_description")
            or ""
        ).strip()[:160]
        primary_h1 = (
            optimization.get("primary_h1")
            or meta_recs.get("primary_h1")
            or title_tag
        ).strip()
        slug = (meta_recs.get("slug") or "").strip()
        primary_keywords: List[str] = seo_blueprint.get("primary_keywords") or []

        developer = (
            grounded_gameplay.get("developer")
            or verified_facts.get("original_developer")
            or ""
        ).strip() or "Unknown"

        # Build FAQ schema — prefer Stage 7 (full Q&A), fall back to Stage 1 opportunities
        faq_items: List[Dict[str, Any]] = []
        for item in (optimization.get("faq_schema") or []):
            q = (item.get("question") or "").strip()
            a = (item.get("answer") or "").strip()
            if q and a:
                faq_items.append({
                    "@type": "Question",
                    "name": q,
                    "acceptedAnswer": {"@type": "Answer", "text": a},
                })
        if not faq_items:
            for opp in (seo_blueprint.get("faq_opportunities") or [])[:5]:
                q = (opp.get("question") or "").strip()
                angle = (opp.get("answer_angle") or "").strip()
                if q:
                    faq_items.append({
                        "@type": "Question",
                        "name": q,
                        "acceptedAnswer": {"@type": "Answer", "text": angle},
                    })

        json_ld: Dict[str, Any] = {
            "@context": "https://schema.org",
            "@type": "VideoGame",
            "name": state.get("game_title") or "",
            "description": meta_description,
            "gamePlatform": "Browser",
            "applicationCategory": "Game",
            "author": {"@type": "Organization", "name": developer},
            "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"},
        }

        return {
            "slug": slug,
            "title_tag": title_tag,
            "meta_description": meta_description,
            "primary_h1": primary_h1,
            "primary_keywords": primary_keywords,
            "json_ld": json_ld,
            "faq_schema": faq_items,
        }

    @traceable(run_type="chain", name="Finalize Agent Result")
    async def __call__(self, state):
        game_title = state.get("game_title") or state.get("game_id") or state.get("proposal_id") or ""
        review = self.review_mapper.build_review_from_state(game_title, state)
        state["review"] = review.model_dump(exclude_none=True)
        seo_meta = self._build_seo_meta(state)
        state["seo_meta"] = seo_meta
        state["result_payload"] = {
            "game_id": state.get("game_id"),
            "game_title": state.get("game_title"),
            "status": state.get("status"),
            "current_stage": state.get("current_stage"),
            "error_message": state.get("error_message", ""),
            "recommendation": review.recommendation,
            "confidence_score": review.confidence_score,
            "metrics": review.metrics,
            "review": state["review"],
            "proposed_game_data": state.get("proposed_game_data") or {},
            "optimization": state.get("optimization") or {},
            "final_article": state.get("article") or "",
            "audit_report": state.get("audit_report") or {},
            "content_plan_validation": state.get("content_plan_validation") or {},
            "revision_history": state.get("revision_history") or [],
            "warnings": state.get("warnings") or [],
            "stage_trace": state.get("stage_trace") or [],
            "seo_meta": seo_meta,
        }
        record_stage(
            state,
            "finalize",
            "completed" if state.get("status") != "failed" else "failed",
            f"Recommendation: {review.recommendation}",
        )
        return state
