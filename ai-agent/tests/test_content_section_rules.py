import unittest
from unittest.mock import AsyncMock

from app.workflows.ai_review_agent.services.content_critic_service import ContentCriticService
from app.workflows.ai_review_agent.services.content_drafting_service import ContentDraftingService
from app.workflows.ai_review_agent.services.content_planning_service import ContentPlanningService

_PLAN_RETURN = {
    "sections": [
        {"title": "Overview", "goals": []},
        {"title": "How to Play", "goals": []},
        {"title": "Strategy", "goals": []},
        {"title": "FAQ", "goals": []},
    ],
    "estimated_word_count": 500,
    "formatting_requirements": [],
}

_CRITIC_RETURN = {
    "approved": True,
    "coverage_score": 80,
    "missing_facts": [],
    "missing_entities": [],
    "revision_instructions": [],
    "reasoning": "ok",
}

LOCKED_ORDER = ["Overview", "How to Play", "Strategy", "FAQ"]


def _make_ai(return_value):
    ai = AsyncMock()
    ai.last_cost = 0.0
    ai.chat_completion.return_value = return_value
    return ai


def _planner_user_prompt(ai):
    return ai.chat_completion.call_args.kwargs["messages"][1]["content"]


def _drafter_user_prompt(ai):
    return ai.chat_completion.call_args.kwargs["messages"][1]["content"]


def _critic_system_prompt(ai):
    return ai.chat_completion.call_args.kwargs["messages"][0]["content"]


class ContentPlanningServiceSectionRulesTests(unittest.IsolatedAsyncioTestCase):
    async def test_uses_how_to_play_not_controls(self):
        ai = _make_ai(_PLAN_RETURN)
        await ContentPlanningService(ai).build_outline("Test Game", {})
        prompt = _planner_user_prompt(ai)
        self.assertIn('"How to Play"', prompt)
        self.assertNotIn('"Controls"', prompt)

    async def test_all_four_locked_titles_present_in_order(self):
        ai = _make_ai(_PLAN_RETURN)
        await ContentPlanningService(ai).build_outline("Test Game", {})
        prompt = _planner_user_prompt(ai)
        json_template = prompt[prompt.index("Return ONLY valid JSON"):]
        positions = [json_template.index(f'"{t}"') for t in LOCKED_ORDER]
        self.assertEqual(positions, sorted(positions), "Section titles must appear in locked order in the JSON template")

    async def test_scoping_rules_present(self):
        ai = _make_ai(_PLAN_RETURN)
        await ContentPlanningService(ai).build_outline("Test Game", {})
        prompt = _planner_user_prompt(ai)
        self.assertIn("How to Play", prompt)
        self.assertIn("FAQ", prompt)
        self.assertIn("Overview", prompt)
        self.assertIn("Do not rename", prompt)


class ContentDraftingServiceSectionRulesTests(unittest.IsolatedAsyncioTestCase):
    async def test_section_order_rule_present(self):
        ai = _make_ai("<h2>Overview</h2>")
        await ContentDraftingService(ai).draft_from_facts("Test Game", {})
        prompt = _drafter_user_prompt(ai)
        positions = [prompt.index(t) for t in LOCKED_ORDER]
        self.assertEqual(positions, sorted(positions), "Section order must be stated in locked order")

    async def test_faq_restricted_to_faq_section(self):
        ai = _make_ai("<h2>Overview</h2>")
        await ContentDraftingService(ai).draft_from_facts("Test Game", {})
        prompt = _drafter_user_prompt(ai)
        self.assertIn("FAQ section", prompt)
        self.assertIn("only", prompt)

    async def test_controls_restricted_to_how_to_play(self):
        ai = _make_ai("<h2>Overview</h2>")
        await ContentDraftingService(ai).draft_from_facts("Test Game", {})
        prompt = _drafter_user_prompt(ai)
        self.assertIn("Controls", prompt)
        self.assertIn("How to Play", prompt)
        self.assertIn("only", prompt)

    async def test_exactly_four_sections_no_extras(self):
        ai = _make_ai("<h2>Overview</h2>")
        await ContentDraftingService(ai).draft_from_facts("Test Game", {})
        prompt = _drafter_user_prompt(ai)
        self.assertIn("exactly four sections", prompt)
        self.assertIn("Do not add", prompt)

    async def test_no_verbatim_source_reproduction(self):
        ai = _make_ai("<h2>Overview</h2>")
        await ContentDraftingService(ai).draft_from_facts("Test Game", {})
        prompt = _drafter_user_prompt(ai)
        self.assertIn("verbatim", prompt)


class ContentCriticServiceSectionRulesTests(unittest.IsolatedAsyncioTestCase):
    async def test_system_prompt_does_not_penalise_absent_facts(self):
        ai = _make_ai(_CRITIC_RETURN)
        await ContentCriticService(ai).validate_outline("Test Game", {}, {}, {})
        prompt = _critic_system_prompt(ai)
        self.assertIn("absent from the research data", prompt)

    async def test_system_prompt_retains_coverage_mandate(self):
        ai = _make_ai(_CRITIC_RETURN)
        await ContentCriticService(ai).validate_outline("Test Game", {}, {}, {})
        prompt = _critic_system_prompt(ai)
        self.assertIn("grounded facts", prompt)
        self.assertIn("FAQ coverage", prompt)
