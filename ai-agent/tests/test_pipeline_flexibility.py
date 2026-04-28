import unittest
from unittest.mock import AsyncMock

from app.workflows.ai_review_agent.nodes.audit_content import AuditContentNode
from app.workflows.ai_review_agent.nodes.critic_plan import CriticPlanNode


class PipelineFlexibilityTests(unittest.IsolatedAsyncioTestCase):
    async def test_critic_can_continue_with_warnings_after_revision_limit(self) -> None:
        critic_service = AsyncMock()
        critic_service.last_cost = 0.2
        critic_service.validate_outline.return_value = {
            "approved": False,
            "coverage_score": 74,
            "revision_instructions": ["Tighten section coverage."],
            "reasoning": "Coverage is acceptable but still incomplete.",
        }
        node = CriticPlanNode(critic_service, min_coverage_score=70)
        state = {
            "status": "drafting",
            "game_title": "Pinball",
            "outline": {"sections": []},
            "grounded_context": {},
            "seo_blueprint": {},
            "accumulated_cost": 0.0,
            "plan_revision_count": 1,
            "max_plan_revisions": 2,
            "revision_history": [],
            "warnings": [],
            "stage_trace": [],
        }

        result = await node(state)

        self.assertEqual(result["status"], "plan_approved_with_warnings")
        self.assertEqual(result["plan_revision_count"], 2)
        self.assertTrue(result["warnings"])

    async def test_auditor_can_continue_with_warnings_after_revision_limit(self) -> None:
        auditor_service = AsyncMock()
        auditor_service.last_cost = 0.3
        auditor_service.audit_article.return_value = {
            "approved": False,
            "factual_accuracy_score": 82,
            "completeness_score": 74,
            "revision_instructions": ["Clarify one unsupported sentence."],
            "reasoning": "Mostly acceptable with minor issues.",
        }
        node = AuditContentNode(
            auditor_service,
            min_factual_score=75,
            min_completeness_score=70,
        )
        state = {
            "status": "complete",
            "game_title": "Pinball",
            "article": "# Draft",
            "grounded_context": {},
            "investigation": {},
            "outline": {},
            "accumulated_cost": 0.0,
            "draft_revision_count": 1,
            "max_draft_revisions": 2,
            "revision_history": [],
            "warnings": [],
            "stage_trace": [],
        }

        result = await node(state)

        self.assertEqual(result["status"], "audited_with_warnings")
        self.assertEqual(result["draft_revision_count"], 2)
        self.assertTrue(result["warnings"])
