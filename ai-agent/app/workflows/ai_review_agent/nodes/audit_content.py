from app.workflows.ai_review_agent.context import record_stage


class AuditContentNode:
    def __init__(self, content_auditor_service, min_factual_score: int = 75, min_completeness_score: int = 70):
        self.auditor = content_auditor_service
        self.min_factual_score = max(0, min(min_factual_score, 100))
        self.min_completeness_score = max(0, min(min_completeness_score, 100))

    async def __call__(self, state):
        if state["status"] == "failed":
            return state
        report = await self.auditor.audit_article(
            state["game_title"],
            state["article"],
            state["grounded_context"],
            state["investigation"],
            state["outline"],
        )
        state["accumulated_cost"] = float(state.get("accumulated_cost") or 0.0) + self.auditor.last_cost
        state["audit_report"] = report
        approved = bool(report.get("approved"))
        factual_score = int(report.get("factual_accuracy_score") or 0)
        completeness_score = int(report.get("completeness_score") or 0)
        if approved:
            state["status"] = "audited"
            record_stage(state, "auditor", "completed", "Draft approved by auditor.")
            return state
        state["draft_revision_count"] = int(state.get("draft_revision_count") or 0) + 1
        state.setdefault("revision_history", []).append(
            {
                "stage": "auditor",
                "revision_count": state["draft_revision_count"],
                "instructions": report.get("revision_instructions") or [],
                "reasoning": report.get("reasoning", ""),
            }
        )
        if (
            factual_score >= self.min_factual_score
            and completeness_score >= self.min_completeness_score
            and state["draft_revision_count"] >= state["max_draft_revisions"]
        ):
            warning = (
                "Stage 6 Auditor still wanted revisions, but the draft met the minimum factual and completeness "
                "thresholds. Continuing with warnings."
            )
            state.setdefault("warnings", []).append(warning)
            state["status"] = "audited_with_warnings"
            record_stage(state, "auditor", "completed_with_warnings", warning)
        elif state["draft_revision_count"] > state["max_draft_revisions"]:
            state["status"] = "failed"
            state["error_message"] = "Stage 6 Auditor rejected the article after the maximum revision attempts."
            record_stage(state, "auditor", "failed", state["error_message"])
        else:
            state["status"] = "draft_revise"
            record_stage(state, "auditor", "revision_requested", "Auditor requested draft revisions.")
        return state
