class AuditContentNode:
    def __init__(self, content_auditor_service):
        self.auditor = content_auditor_service

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
        if report.get("approved"):
            state["status"] = "audited"
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
        if state["draft_revision_count"] > state["max_draft_revisions"]:
            state["status"] = "failed"
            state["error_message"] = "Stage 6 Auditor rejected the article after the maximum revision attempts."
        else:
            state["status"] = "draft_revise"
        return state
