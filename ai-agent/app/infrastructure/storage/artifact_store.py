"""S3-backed store for Stage 0 research artifacts.

All JSON documents (manifests, scores, findings) are written directly to S3.
The store returns S3 keys so callers can reference artifacts without holding
local file paths.
"""

import logging
from typing import Any, Dict, List, Optional

from app.domain.dto import CandidateCapture
from app.infrastructure.storage.s3_storage_service import S3StorageService

logger = logging.getLogger(__name__)


class ArtifactStore:
    def __init__(self, s3: S3StorageService):
        self._s3 = s3

    def proposal_key(self, proposal_id: str, *parts: str) -> str:
        """Return the S3 key prefix for a proposal artifact."""
        return self._s3.proposal_key(proposal_id, *parts)

    async def write_research_findings(
        self,
        proposal_id: str,
        game_title: str,
        search_query: str,
        candidates: List[CandidateCapture],
        failures: List[Dict[str, Any]],
        total_cost_usd: float,
        best_match: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Upload research findings JSON. Returns the S3 key."""
        payload = {
            "game_title": game_title,
            "proposal_id": proposal_id,
            "search_query": search_query,
            "total_cost_usd": total_cost_usd,
            "best_match_url": (best_match or {}).get("url", ""),
            "visual_confidence": (best_match or {}).get("confidence_score", ""),
            "all_candidates": [
                {
                    "url": c.url,
                    "confidence_score": c.confidence_score,
                    "reasoning": c.reasoning,
                    "extracted_facts": c.extracted_facts,
                    "screenshot_path": c.screenshot_path,
                    "metadata_path": c.metadata_path,
                    "seo_intelligence": c.seo_intelligence,
                    "scoring": c.scoring,
                    "comparison_triplet": c.comparison_triplet,
                }
                for c in candidates
            ],
            "failures": failures,
        }
        key = self._s3.proposal_key(proposal_id, "research_findings.json")
        return await self._s3.upload_json(key, payload)

    async def write_comparison_scores(
        self,
        proposal_id: str,
        game_title: str,
        search_query: str,
        candidates: List[CandidateCapture],
        failures: List[Dict[str, Any]],
    ) -> str:
        """Upload comparison scores JSON. Returns the S3 key."""
        payload = {
            "proposal_id": proposal_id,
            "game_title": game_title,
            "search_query": search_query,
            "candidate_count": len(candidates),
            "candidates": [
                {
                    "rank": c.rank,
                    "url": c.url,
                    "screenshot_path": c.screenshot_path,
                    "metadata_path": c.metadata_path,
                    "confidence_score": c.confidence_score,
                    "correlation": c.correlation,
                    "seo_intelligence": c.seo_intelligence,
                    "scoring": c.scoring,
                    "comparison_triplet": c.comparison_triplet,
                }
                for c in candidates
            ],
            "failures": failures,
        }
        key = self._s3.proposal_key(proposal_id, "comparison_scores.json")
        return await self._s3.upload_json(key, payload)

    async def write_manifest(self, proposal_id: str, payload: Dict[str, Any]) -> str:
        """Upload stage0 manifest JSON. Returns the S3 key."""
        key = self._s3.proposal_key(proposal_id, "stage0_manifest.json")
        return await self._s3.upload_json(key, payload)
