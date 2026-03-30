"""
AI Agent pipeline — stub for Day 1.
Day 2 (Harriet): implement Agent 1 (Playwright screenshot capture).
Day 2 (Victoria): implement Agent 2 (OpenAI web search + evaluation metrics).
"""

import logging
from app.models.schemas import AiReviewResult
from app.services import arcade_client

logger = logging.getLogger(__name__)


async def run_pipeline(proposal_id: str) -> None:
    """
    Full agent pipeline for a single proposal:
      1. Fetch proposal data from main API
      2. Agent 1 — capture screenshot of game preview (Harriet, Day 2)
      3. Agent 2 — web search verification + evaluation metrics (Victoria, Day 2)
      4. Submit review result back to main API
    """
    logger.info(f"[agent] Starting pipeline for proposal {proposal_id}")

    try:
        proposal = await arcade_client.get_proposal(proposal_id)
        proposed_data = proposal.get("proposedData", {})

        # --- Agent 1: Screenshot capture (stub) ---
        # screenshot_base64, screenshot_available = await browser_agent.capture(proposal)
        screenshot_base64 = None
        screenshot_available = False

        # --- Agent 2: Web search + metric scoring (stub) ---
        # review: AiReviewResult = await web_search_agent.analyse(proposed_data, screenshot_base64)
        review = AiReviewResult(
            recommendation="accept",
            reasoning="[STUB] Agent not yet implemented.",
            metrics={},
            confidence_score=0.0,
            screenshot_available=screenshot_available,
        )

        await arcade_client.submit_review(proposal_id, review.model_dump())
        logger.info(f"[agent] Pipeline complete for proposal {proposal_id}")

    except Exception as exc:
        logger.error(f"[agent] Pipeline failed for proposal {proposal_id}: {exc}", exc_info=True)
        raise
