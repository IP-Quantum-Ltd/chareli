"""
HTTP client for the ArcadeBox main API.
All calls use the non-expiry editor-role service account token.
"""

import httpx
import logging
from app.config import settings
from typing import List, Dict

logger = logging.getLogger(__name__)

_headers = {
    "Authorization": f"Bearer {settings.ARCADE_API_TOKEN}",
    "Content-Type": "application/json",
}


async def get_pending_games() -> List[Dict]:
    """
    Cron fallback: fetch all PENDING games.
    Endpoint: GET /api/games/pending  (editor-accessible)
    """
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{settings.ARCADE_API_BASE_URL}/api/games/pending",
            headers=_headers,
        )
        resp.raise_for_status()
        return resp.json().get("data", [])


async def get_game(game_id: str) -> Dict:
    """Fetch live game metadata by ID."""
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{settings.ARCADE_API_BASE_URL}/api/games/{game_id}",
            headers=_headers,
        )
        resp.raise_for_status()
        return resp.json().get("data", {})


async def submit_review(game_id: str, review: Dict) -> None:
    """
    Submit the AI review as an editor using the live game revision endpoint.
    The review payload is embedded in proposedData so the admin sees it on review.
    """
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.put(
            f"{settings.ARCADE_API_BASE_URL}/api/games/{game_id}",
            headers=_headers,
            json={"proposedData": {"aiReview": review}},
        )
        resp.raise_for_status()
        logger.info(f"[arcade_client] Submitted AI review for game {game_id}")
