import base64
import json
from pathlib import Path
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException

from app.models.schemas import Stage0ArtifactPaths, Stage0RunRequest, Stage0RunResponse
from app.services.browser_agent import capture_stage0_internal_assets
from app.services.visual_librarian import VisualLibrarian

router = APIRouter(prefix="/stage0")


def _proposal_dir(game_id: str) -> Path:
    return Path(__file__).resolve().parents[2] / "stage0_artifacts" / game_id


def _load_json(path: Path) -> Dict[str, Any]:
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {path.name}")
    return json.loads(path.read_text(encoding="utf-8"))


def _artifact_paths(game_id: str) -> Stage0ArtifactPaths:
    proposal_dir = _proposal_dir(game_id)
    return Stage0ArtifactPaths(
        internal_thumbnail_path=str(proposal_dir / "internal_thumbnail.png"),
        internal_gameplay_path=str(proposal_dir / "internal_gameplay.png"),
        comparison_scores_path=str(proposal_dir / "comparison_scores.json"),
        research_findings_path=str(Path(__file__).resolve().parents[2] / f"research_findings_{game_id}.json"),
        stage0_manifest_path=str(proposal_dir / "stage0_manifest.json"),
    )


@router.post(
    "/run",
    tags=["Stage 0"],
    summary="Run Stage 0 end-to-end for a game",
    description="Captures internal screenshots for a public game record, runs external search/capture, and writes comparison outputs.",
    response_model=Stage0RunResponse,
)
async def run_stage0(payload: Stage0RunRequest) -> Stage0RunResponse:
    proposal_dir = _proposal_dir(payload.game_id)
    proposal_dir.mkdir(parents=True, exist_ok=True)

    capture_result = await capture_stage0_internal_assets(payload.game_id, str(proposal_dir))
    internal_base64: List[str] = []
    for path_str in capture_result["paths"]:
        with open(path_str, "rb") as handle:
            internal_base64.append(base64.b64encode(handle.read()).decode("utf-8"))

    librarian = VisualLibrarian()
    result = await librarian.verify_and_research(
        proposal_id=payload.game_id,
        game_title=capture_result["game_title"],
        internal_screenshots=internal_base64,
    )

    best_match = (result.get("best_match") or {}) if isinstance(result, dict) else {}
    all_candidates = result.get("all_candidates") or []
    return Stage0RunResponse(
        game_id=payload.game_id,
        game_title=capture_result["game_title"],
        status=result.get("status", "failed"),
        reason=result.get("reason"),
        search_query=result.get("search_query"),
        candidate_count=len(all_candidates),
        best_match_url=best_match.get("url", ""),
        confidence_score=int(best_match.get("confidence_score") or 0),
        artifact_paths=_artifact_paths(payload.game_id),
    )


@router.get(
    "/{game_id}/result",
    tags=["Stage 0"],
    summary="Get Stage 0 manifest/result",
    description="Returns the saved Stage 0 manifest for a game ID.",
)
async def get_stage0_result(game_id: str) -> Dict[str, Any]:
    return _load_json(_proposal_dir(game_id) / "stage0_manifest.json")


@router.get(
    "/{game_id}/comparison-scores",
    tags=["Stage 0"],
    summary="Get Stage 0 comparison scores",
    description="Returns the saved comparison_scores.json for a game ID.",
)
async def get_stage0_comparison_scores(game_id: str) -> Dict[str, Any]:
    return _load_json(_proposal_dir(game_id) / "comparison_scores.json")


@router.get(
    "/{game_id}/research-findings",
    tags=["Stage 0"],
    summary="Get Stage 0 research findings",
    description="Returns the saved combined research findings JSON for a game ID.",
)
async def get_stage0_research_findings(game_id: str) -> Dict[str, Any]:
    return _load_json(Path(__file__).resolve().parents[2] / f"research_findings_{game_id}.json")


@router.get(
    "/{game_id}/candidates",
    tags=["Stage 0"],
    summary="Get Stage 0 candidates",
    description="Returns the candidate entries from comparison_scores.json for a game ID.",
)
async def get_stage0_candidates(game_id: str) -> Dict[str, Any]:
    scores = _load_json(_proposal_dir(game_id) / "comparison_scores.json")
    return {
        "game_id": game_id,
        "candidate_count": len(scores.get("candidates") or []),
        "candidates": scores.get("candidates") or [],
        "failures": scores.get("failures") or [],
    }
