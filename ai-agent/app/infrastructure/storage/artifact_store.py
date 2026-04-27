import asyncio
import json
from pathlib import Path
from typing import Any, Dict, List

from app.domain.dto import CandidateCapture


class ArtifactStore:
    def __init__(self, root: Path):
        self._root = root

    def proposal_dir(self, proposal_id: str) -> Path:
        return self._root / "stage0_artifacts" / proposal_id

    async def ensure_proposal_dirs(self, proposal_id: str) -> tuple[Path, Path]:
        proposal_dir = self.proposal_dir(proposal_id)
        external_dir = proposal_dir / "external"
        await asyncio.to_thread(external_dir.mkdir, parents=True, exist_ok=True)
        return proposal_dir, external_dir

    async def write_research_findings(
        self,
        proposal_id: str,
        game_title: str,
        search_query: str,
        candidates: List[CandidateCapture],
        failures: List[Dict[str, Any]],
        total_cost_usd: float,
        best_match: Dict[str, Any] | None = None,
    ) -> str:
        findings_path = self._root / f"research_findings_{proposal_id}.json"
        report = {
            "game_title": game_title,
            "proposal_id": proposal_id,
            "search_query": search_query,
            "total_cost_usd": total_cost_usd,
            "best_match_url": (best_match or {}).get("url", ""),
            "visual_confidence": (best_match or {}).get("confidence_score", ""),
            "all_candidates": [
                {
                    "url": candidate.url,
                    "confidence_score": candidate.confidence_score,
                    "reasoning": candidate.reasoning,
                    "extracted_facts": candidate.extracted_facts,
                    "screenshot_path": candidate.screenshot_path,
                    "metadata_path": candidate.metadata_path,
                    "seo_intelligence": candidate.seo_intelligence,
                    "scoring": candidate.scoring,
                    "comparison_triplet": candidate.comparison_triplet,
                }
                for candidate in candidates
            ],
            "failures": failures,
        }
        await asyncio.to_thread(findings_path.write_text, json.dumps(report, indent=4), encoding="utf-8")
        return str(findings_path)

    async def write_comparison_scores(
        self,
        proposal_dir: Path,
        proposal_id: str,
        game_title: str,
        search_query: str,
        candidates: List[CandidateCapture],
        failures: List[Dict[str, Any]],
    ) -> str:
        comparison_scores_path = proposal_dir / "comparison_scores.json"
        score_report = {
            "proposal_id": proposal_id,
            "game_title": game_title,
            "search_query": search_query,
            "candidate_count": len(candidates),
            "candidates": [
                {
                    "rank": candidate.rank,
                    "url": candidate.url,
                    "screenshot_path": candidate.screenshot_path,
                    "metadata_path": candidate.metadata_path,
                    "confidence_score": candidate.confidence_score,
                    "correlation": candidate.correlation,
                    "seo_intelligence": candidate.seo_intelligence,
                    "scoring": candidate.scoring,
                    "comparison_triplet": candidate.comparison_triplet,
                }
                for candidate in candidates
            ],
            "failures": failures,
        }
        await asyncio.to_thread(comparison_scores_path.write_text, json.dumps(score_report, indent=2), encoding="utf-8")
        return str(comparison_scores_path)

    async def write_manifest(self, proposal_dir: Path, payload: Dict[str, Any]) -> str:
        manifest_path = proposal_dir / "stage0_manifest.json"
        await asyncio.to_thread(manifest_path.write_text, json.dumps(payload, indent=2), encoding="utf-8")
        return str(manifest_path)
