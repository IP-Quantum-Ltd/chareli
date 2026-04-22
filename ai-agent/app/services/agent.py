import logging
from typing import Any, Dict

from app.models.schemas import AiReviewResult
from app.db.postgres import get_game_record
from app.services import arcade_client
from app.services.graph_orchestrator import run_pipeline_with_tracking

logger = logging.getLogger(__name__)


def _extract_game_id(proposal: Dict[str, Any]) -> str:
    game = proposal.get("game") or {}
    for value in (
        proposal.get("gameId"),
        game.get("id"),
        game.get("gameId"),
    ):
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _merge_game_record_into_proposal(proposal: Dict[str, Any], game_record: Dict[str, Any]) -> Dict[str, Any]:
    merged = dict(proposal)
    merged_game = dict(game_record)
    proposal_game = proposal.get("game") or {}
    if isinstance(proposal_game, dict):
        merged_game.update({key: value for key, value in proposal_game.items() if value not in (None, "", [], {})})
    merged["game"] = merged_game
    if merged.get("gameId") in (None, "") and game_record.get("id"):
        merged["gameId"] = game_record["id"]
    return merged


def _extract_game_title(proposal: Dict[str, Any], proposal_id: str) -> str:
    """Prefer explicit proposal titles, but fall back safely when data is incomplete."""
    proposed_data = proposal.get("proposedData") or {}
    game = proposal.get("game") or {}

    for value in (
        proposed_data.get("title"),
        proposed_data.get("name"),
        proposed_data.get("gameTitle"),
        proposal.get("title"),
        proposal.get("name"),
        game.get("title"),
        game.get("name"),
    ):
        if isinstance(value, str) and value.strip():
            return value.strip()

    return f"Game Proposal {proposal_id}"


def _build_review_from_state(game_title: str, final_state: Dict[str, Any]) -> AiReviewResult:
    investigation = final_state.get("investigation") or {}
    best_match = investigation.get("best_match") or {}
    visual_confidence = int(best_match.get("confidence_score") or 0)
    review_confidence = round(visual_confidence / 100, 2)
    pipeline_status = final_state.get("status", "failed")
    screenshot_available = bool(final_state.get("internal_imgs_paths"))

    if pipeline_status == "complete" and visual_confidence >= 70:
        recommendation = "accept"
        reasoning = (
            f"Stage 0 visually verified '{game_title}' against live web results with "
            f"{visual_confidence}% confidence. The strongest match was "
            f"{best_match.get('url', 'an external source')}."
        )
    elif best_match:
        recommendation = "decline"
        reasoning = (
            f"Stage 0 could not verify '{game_title}' strongly enough for safe downstream use. "
            f"Best match confidence was {visual_confidence}% and the pipeline status ended as "
            f"'{pipeline_status}'."
        )
    else:
        recommendation = "decline"
        reasoning = final_state.get(
            "error_message",
            "Stage 0 failed before a trustworthy external match could be established.",
        )

    mapped_investigation = None
    if best_match:
        mapped_investigation = {
            "confidence_score": visual_confidence,
            "reasoning": best_match.get("reasoning", ""),
            "verified_facts": best_match.get("extracted_facts") or {},
            "source_url": best_match.get("url", ""),
            "all_candidates": investigation.get("all_candidates") or [],
            "deep_research_results": best_match.get("deep_research_results") or {},
        }

    return AiReviewResult(
        recommendation=recommendation,
        reasoning=reasoning,
        metrics={
            "pipeline_status": pipeline_status,
            "game_id": final_state.get("game_id") or None,
            "visual_confidence": visual_confidence,
            "candidate_count": len(investigation.get("all_candidates") or []),
            "best_match_url": best_match.get("url"),
            "stage2_postgres_hits": len((((final_state.get("grounded_context") or {}).get("postgres") or {}).get("results") or [])),
            "stage2_mongo_hits": len((((final_state.get("grounded_context") or {}).get("mongo") or {}).get("results") or [])),
            "stage2_mongo_persistence_status": (((final_state.get("grounded_context") or {}).get("mongo_persistence") or {}).get("status")),
            "total_cost_usd": round(float(final_state.get("accumulated_cost") or 0.0), 4),
        },
        confidence_score=review_confidence,
        screenshot_available=screenshot_available,
        investigation=mapped_investigation,
        seo_blueprint=final_state.get("seo_blueprint") or None,
        grounded_context=((final_state.get("grounded_context") or {}).get("grounded_packet") or None),
        content_plan=final_state.get("outline") or None,
        final_article=final_state.get("article") or None,
    )


def _build_failure_review(reason: str) -> AiReviewResult:
    return AiReviewResult(
        recommendation="decline",
        reasoning=reason,
        metrics={"pipeline_status": "failed"},
        confidence_score=0.0,
        screenshot_available=False,
    )


async def run_pipeline(proposal_id: str) -> None:
    """
    Live proposal-processing pipeline:
      1. Fetch proposal metadata
      2. Run the visual-first LangGraph workflow
      3. Submit a structured AI review back to the main ArcadeBox API
    """
    logger.info(f"[agent] Starting pipeline for proposal {proposal_id}")

    try:
        proposal = await arcade_client.get_proposal(proposal_id)
        game_id = _extract_game_id(proposal)
        if not game_id:
            raise ValueError(
                f"Proposal {proposal_id} does not include a game id, so the canonical game table cannot be queried."
            )

        game_record = await get_game_record(game_id)
        if not game_record:
            raise ValueError(f"Game {game_id} was not found in the Postgres game table.")

        proposal_with_game = _merge_game_record_into_proposal(proposal, game_record)
        game_title = _extract_game_title(proposal_with_game, proposal_id)
        final_state = await run_pipeline_with_tracking(proposal_id, game_title, proposal_with_game)
        review = _build_review_from_state(game_title, final_state)
    except Exception as exc:
        logger.error(f"[agent] Pipeline failed for proposal {proposal_id}: {exc}", exc_info=True)
        review = _build_failure_review(
            f"Visual-first verification failed before completion for proposal {proposal_id}: {exc}"
        )

    await arcade_client.submit_review(
        proposal_id,
        review.model_dump(exclude_none=True),
    )
    logger.info(
        f"[agent] Pipeline complete for proposal {proposal_id} "
        f"with recommendation '{review.recommendation}'"
    )
