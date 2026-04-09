"""
AI Agent pipeline.
Agent 1 (Harriet): Playwright screenshot capture — implemented.
Agent 2 (Victoria): OpenAI web search + evaluation metrics — implemented.
"""

import base64
import logging
import os
import tempfile

from app.models.schemas import AiReviewResult
from app.services import arcade_client, web_search_agent
from app.services import browser_agent

logger = logging.getLogger(__name__)


async def run_pipeline(proposal_id: str) -> None:
    """
    Full agent pipeline for a single proposal:
      1. Fetch proposal data from main API
      2. Agent 1 (Harriet) — capture screenshot as PNG, convert to base64
      3. Agent 2 (Victoria) — web search verification + evaluation metrics
      4. Submit review result back to main API
    """
    logger.info(f"[agent] Starting pipeline for proposal {proposal_id}")

    try:
        proposal = await arcade_client.get_proposal(proposal_id)
        proposed_data = proposal.get("proposedData", {})

        # --- Agent 1: Screenshot capture (Harriet) ---
        screenshot_base64 = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
                tmp_path = tmp.name

            await browser_agent.capture_game_preview(proposal_id, output_path=tmp_path)

            with open(tmp_path, "rb") as f:
                screenshot_base64 = base64.b64encode(f.read()).decode("utf-8")

            logger.info(f"[agent] Screenshot captured and encoded for proposal {proposal_id}")
        except Exception as e:
            logger.warning(f"[agent] Agent 1 screenshot failed, proceeding text-only: {e}")
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

        # --- Agent 2: Web search + metric scoring (Victoria) ---
        review: AiReviewResult = await web_search_agent.analyse(proposed_data, screenshot_base64)

        await arcade_client.submit_review(proposal_id, review.model_dump())
        logger.info(f"[agent] Pipeline complete for proposal {proposal_id}")

    except Exception as exc:
        logger.error(f"[agent] Pipeline failed for proposal {proposal_id}: {exc}", exc_info=True)
        raise
