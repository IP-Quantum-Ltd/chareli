import logging
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin

import httpx

from app.config import ArcadeApiConfig

logger = logging.getLogger(__name__)


class ArcadeApiClient:
    def __init__(self, config: ArcadeApiConfig):
        self._config = config
        self._base_url = config.base_url.strip().rstrip("/")
        self._headers = {
            "Authorization": f"Bearer {config.api_token}",
            "Content-Type": "application/json",
        }

    def _url(self, path: str) -> str:
        return urljoin(f"{self._base_url}/", path.lstrip("/"))

    async def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                response = await client.request(
                    method,
                    self._url(path),
                    headers=self._headers,
                    **kwargs,
                )
                response.raise_for_status()
                return response
        except httpx.ConnectError as exc:
            raise RuntimeError(
                f"Failed to connect to Arcade API at {self._base_url!r}. "
                "Check ARCADE_API_BASE_URL DNS/host configuration in the deployment environment."
            ) from exc

    async def get_pending_proposals(self) -> List[Dict[str, Any]]:
        response = await self._request("GET", "/api/game-proposals/pending")
        return response.json().get("data", [])

    async def get_proposal(self, proposal_id: str) -> Dict[str, Any]:
        response = await self._request("GET", f"/api/game-proposals/{proposal_id}")
        return response.json().get("data", {})

    async def create_game_proposal(self, game_id: str, proposed_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new UPDATE-type proposal for an existing game (editor PUT flow)."""
        response = await self._request("PUT", f"/api/games/{game_id}", json=proposed_data)
        data = response.json()
        logger.info("[arcade_client] Created proposal for game %s", game_id)
        return data.get("data", data)

    async def submit_review(
        self,
        proposal_id: str,
        review: Dict[str, Any],
        proposed_game_data: Optional[Dict[str, Any]] = None,
        seo_meta: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Submit AI review + structured game data to the server.

        proposedData layout:
          - top-level game fields (title, description, metadata) → applied to Game on approval
          - aiReview → decision context shown to admin (recommendation, confidence, findings, seo_meta)
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
            "seo_meta": seo_meta or {},
        }

        proposed_data: Dict[str, Any] = dict(proposed_game_data or {})
        proposed_data["aiReview"] = ai_review_context

        await self._request(
            "PUT",
            f"/api/game-proposals/{proposal_id}",
            json={"proposedData": proposed_data},
        )
        logger.info(
            "[arcade_client] Submitted review for proposal %s | recommendation=%s",
            proposal_id,
            ai_review_context.get("recommendation"),
        )
