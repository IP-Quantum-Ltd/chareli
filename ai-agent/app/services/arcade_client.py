"""
HTTP client for the ArcadeBox main API.
All calls use the non-expiry editor-role service account token.
"""

import httpx
import logging
from app.config import settings

logger = logging.getLogger(__name__)

_headers = {
    "Authorization": f"Bearer {settings.ARCADE_API_TOKEN}",
    "Content-Type": "application/json",
}


async def get_pending_proposals() -> list[dict]:
    """
    Cron fallback: fetch all PENDING proposals.
    Endpoint: GET /api/game-proposals/pending  (editor-accessible)
    """
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{settings.ARCADE_API_BASE_URL}/api/game-proposals/pending",
            headers=_headers,
        )
        resp.raise_for_status()
        return resp.json().get("data", [])


async def get_proposal(proposal_id: str) -> dict:
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{settings.ARCADE_API_BASE_URL}/api/game-proposals/{proposal_id}",
            headers=_headers,
        )
        resp.raise_for_status()
        return resp.json().get("data", {})


async def submit_review(proposal_id: str, review: dict) -> None:
    """
    Submit the AI review as an editor using the existing proposal revision endpoint.
    The review payload is embedded in proposedData so the admin sees it on review.
    """
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.put(
            f"{settings.ARCADE_API_BASE_URL}/api/game-proposals/{proposal_id}",
            headers=_headers,
            json={"proposedData": {"aiReview": review}},
        )
        resp.raise_for_status()
        logger.info(f"[arcade_client] Submitted AI review for proposal {proposal_id}")
