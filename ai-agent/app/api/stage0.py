import json
from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter, HTTPException

from app.domain.schemas import Stage0ArtifactPaths, Stage0RunRequest, Stage0RunResponse
from app.runtime import get_runtime

router = APIRouter(prefix="/stage0")


def _load_json(path: Path) -> Dict[str, Any]:
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {path.name}")
    return json.loads(path.read_text(encoding="utf-8"))


def _artifact_paths(game_id: str, s3: Any) -> Stage0ArtifactPaths:
    return Stage0ArtifactPaths(
        internal_thumbnail_path=s3.proposal_key(game_id, "internal_thumbnail.png"),
        internal_gameplay_path=s3.proposal_key(game_id, "internal_gameplay.png"),
        comparison_scores_path=s3.proposal_key(game_id, "comparison_scores.json"),
        research_findings_path=s3.proposal_key(game_id, "research_findings.json"),
        stage0_manifest_path=s3.proposal_key(game_id, "stage0_manifest.json"),
    )


@router.post("/run", tags=["Stage 0"], response_model=Stage0RunResponse)
async def run_stage0(payload: Stage0RunRequest) -> Stage0RunResponse:
    runtime = get_runtime()
    proposal_id = payload.game_id

    capture_result = await runtime.internal_capture.capture_stage0_internal_assets(payload.game_id, proposal_id)

    result = await runtime.visual_verification.verify_and_research(
        proposal_id=proposal_id,
        game_title=capture_result.game_title,
        internal_screenshots=capture_result.image_urls,
    )
    best_match = (result.get("best_match") or {}) if isinstance(result, dict) else {}
    all_candidates = result.get("all_candidates") or []
    return Stage0RunResponse(
        game_id=payload.game_id,
        game_title=capture_result.game_title,
        status=result.get("status", "failed"),
        reason=result.get("reason"),
        search_query=result.get("search_query"),
        candidate_count=len(all_candidates),
        best_match_url=best_match.get("url", ""),
        confidence_score=int(best_match.get("confidence_score") or 0),
        artifact_paths=_artifact_paths(proposal_id, runtime.s3_storage),
    )


@router.get("/{game_id}/result", tags=["Stage 0"])
async def get_stage0_result(game_id: str) -> Dict[str, Any]:
    return _load_json(_proposal_dir(game_id) / "stage0_manifest.json")


@router.get("/{game_id}/comparison-scores", tags=["Stage 0"])
async def get_stage0_comparison_scores(game_id: str) -> Dict[str, Any]:
    return _load_json(_proposal_dir(game_id) / "comparison_scores.json")


@router.get("/{game_id}/research-findings", tags=["Stage 0"])
async def get_stage0_research_findings(game_id: str) -> Dict[str, Any]:
    return _load_json(Path(__file__).resolve().parents[1] / f"research_findings_{game_id}.json")


@router.get("/{game_id}/candidates", tags=["Stage 0"])
async def get_stage0_candidates(game_id: str) -> Dict[str, Any]:
    scores = _load_json(_proposal_dir(game_id) / "comparison_scores.json")
    return {
        "game_id": game_id,
        "candidate_count": len(scores.get("candidates") or []),
        "candidates": scores.get("candidates") or [],
        "failures": scores.get("failures") or [],
    }
