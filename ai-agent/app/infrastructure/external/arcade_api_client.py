import logging
from typing import Any, Dict, List, Optional

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

    async def create_game_proposal(self, game_id: str, proposed_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new UPDATE-type proposal for an existing game (editor PUT flow)."""
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.put(
                f"{self._config.base_url}/api/games/{game_id}",
                headers=self._headers,
                json=proposed_data,
            )
            response.raise_for_status()
            data = response.json()
            logger.info("[arcade_client] Created proposal for game %s", game_id)
            return data.get("data", data)

    async def submit_review(
        self,
        proposal_id: str,
        review: Dict[str, Any],
        proposed_game_data: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Submit AI review + structured game data to the server.

        proposedData layout:
          - top-level game fields (title, description, metadata) → applied to Game on approval
          - aiReview → decision context shown to admin (recommendation, confidence, findings)
        """
        metrics = review.get("metrics") or {}
        ai_review_context = {
            "recommendation": review.get("recommendation"),
            "confidence_score": review.get("confidence_score"),
            "reasoning": review.get("reasoning") or metrics.get("reasoning") or "",
            "pipeline_status": metrics.get("pipeline_status"),
            "visual_confidence": metrics.get("visual_confidence"),
            "best_match_url": metrics.get("best_match_url"),
            "candidate_count": metrics.get("candidate_count"),
            "total_cost_usd": metrics.get("total_cost_usd"),
            "warnings": review.get("warnings") or [],
            "stage_trace": review.get("stage_trace") or [],
        }

        proposed_data: Dict[str, Any] = dict(proposed_game_data or {})
        proposed_data["aiReview"] = ai_review_context

        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.put(
                f"{self._config.base_url}/api/game-proposals/{proposal_id}",
                headers=self._headers,
                json={"proposedData": proposed_data},
            )
            response.raise_for_status()
            logger.info(
                "[arcade_client] Submitted review for proposal %s | recommendation=%s",
                proposal_id,
                ai_review_context.get("recommendation"),
            )
