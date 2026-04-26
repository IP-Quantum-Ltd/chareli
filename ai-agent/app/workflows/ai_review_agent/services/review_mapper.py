from typing import Any, Dict

from app.domain.schemas import AiReviewResult


class ReviewMapper:
    def build_review_from_state(self, game_title: str, final_state: Dict[str, Any]) -> AiReviewResult:
        investigation = final_state.get("investigation") or {}
        best_match = investigation.get("best_match") or {}
        audit_report = final_state.get("audit_report") or {}
        optimization = final_state.get("optimization") or {}
        visual_confidence = int(best_match.get("confidence_score") or 0)
        review_confidence = round(visual_confidence / 100, 2)
        pipeline_status = final_state.get("status", "failed")
        screenshot_available = bool(final_state.get("internal_imgs_paths"))
        audit_approved = bool(audit_report.get("approved"))

        if pipeline_status == "complete" and visual_confidence >= 70 and audit_approved:
            recommendation = "accept"
            reasoning = (
                f"The agent visually verified '{game_title}' with {visual_confidence}% confidence, "
                f"approved the plan and draft, and completed SEO optimization using grounded evidence "
                f"from {best_match.get('url', 'an external source')}."
            )
        elif best_match:
            recommendation = "decline"
            reasoning = (
                f"Stage 0 could not verify '{game_title}' strongly enough for safe downstream use. "
                f"Best match confidence was {visual_confidence}% and the pipeline status ended as "
                f"'{pipeline_status}'."
            )
        else:
            recommendation = "decline"
            reasoning = final_state.get(
                "error_message",
                "Stage 0 failed before a trustworthy external match could be established.",
            )

        mapped_investigation = None
        if best_match:
            mapped_investigation = {
                "confidence_score": visual_confidence,
                "reasoning": best_match.get("reasoning", ""),
                "verified_facts": best_match.get("extracted_facts") or {},
                "source_url": best_match.get("url", ""),
                "all_candidates": investigation.get("all_candidates") or [],
                "deep_research_results": best_match.get("deep_research_results") or {},
            }

        return AiReviewResult(
            recommendation=recommendation,
            reasoning=reasoning,
            metrics={
                "pipeline_status": pipeline_status,
                "game_id": final_state.get("game_id") or None,
                "visual_confidence": visual_confidence,
                "candidate_count": len(investigation.get("all_candidates") or []),
                "best_match_url": best_match.get("url"),
                "stage2_postgres_hits": len((((final_state.get("grounded_context") or {}).get("postgres") or {}).get("results") or [])),
                "stage2_mongo_hits": len((((final_state.get("grounded_context") or {}).get("mongo") or {}).get("results") or [])),
                "stage2_mongo_persistence_status": (((final_state.get("grounded_context") or {}).get("mongo_persistence") or {}).get("status")),
                "critic_approved": bool((final_state.get("content_plan_validation") or {}).get("approved")),
                "plan_revision_count": int(final_state.get("plan_revision_count") or 0),
                "audit_approved": audit_approved,
                "draft_revision_count": int(final_state.get("draft_revision_count") or 0),
                "factual_accuracy_score": audit_report.get("factual_accuracy_score"),
                "completeness_score": audit_report.get("completeness_score"),
                "optimizer_ready": ((optimization.get("evaluation") or {}).get("overall_ready")),
                "total_cost_usd": round(float(final_state.get("accumulated_cost") or 0.0), 4),
            },
            confidence_score=review_confidence,
            screenshot_available=screenshot_available,
            investigation=mapped_investigation,
            seo_blueprint=final_state.get("seo_blueprint") or None,
            grounded_context=((final_state.get("grounded_context") or {}).get("grounded_packet") or None),
            content_plan=final_state.get("outline") or None,
            final_article=final_state.get("article") or None,
            audit_report=audit_report or None,
            optimization=optimization or None,
        )

    def build_failure_review(self, reason: str) -> AiReviewResult:
        return AiReviewResult(
            recommendation="decline",
            reasoning=reason,
            metrics={"pipeline_status": "failed"},
            confidence_score=0.0,
            screenshot_available=False,
        )
