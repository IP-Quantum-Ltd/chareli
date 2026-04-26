import logging
from typing import Any, Dict, List

import httpx

from app.config import ArcadeApiConfig

logger = logging.getLogger(__name__)


class ArcadeApiClient:
    def __init__(self, config: ArcadeApiConfig):
        self._config = config
        self._headers = {
            "Authorization": f"Bearer {config.api_token}",
            "Content-Type": "application/json",
        }

    async def get_pending_proposals(self) -> List[Dict[str, Any]]:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(
                f"{self._config.base_url}/api/game-proposals/pending",
                headers=self._headers,
            )
            response.raise_for_status()
            return response.json().get("data", [])

    async def get_proposal(self, proposal_id: str) -> Dict[str, Any]:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(
                f"{self._config.base_url}/api/game-proposals/{proposal_id}",
                headers=self._headers,
            )
            response.raise_for_status()
            return response.json().get("data", {})

    async def submit_review(self, proposal_id: str, review: Dict[str, Any]) -> None:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.put(
                f"{self._config.base_url}/api/game-proposals/{proposal_id}",
                headers=self._headers,
                json={"proposedData": {"aiReview": review}},
            )
            response.raise_for_status()
            logger.info("[arcade_client] Submitted AI review for proposal %s", proposal_id)
