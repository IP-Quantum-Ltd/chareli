import logging
from typing import Dict, Any
from fastapi import APIRouter, HTTPException, BackgroundTasks
from app.services.graph_orchestrator import run_pipeline_with_tracking
from app.services.arcade_client import get_game

router = APIRouter(prefix="/api/v1/review", tags=["Review Management"])
logger = logging.getLogger(__name__)

@router.post("/trigger/{game_id}", summary="Manually trigger high-precision review")
async def trigger_manual_review(game_id: str, max_candidates: int = 3):
    """
    Launches the LangGraph Visual Review Pipeline for a specific game proposal.
    - **game_id**: The UUID of the game proposal.
    - **max_candidates**: How many external search results to verify in parallel (Default 3).
    """
    try:
        # 1. Resolve game details for metadata
        game_data = await get_game(game_id)
        if not game_data:
            raise HTTPException(status_code=404, detail="Game proposal not found in Arcade database.")
            
        game_title = game_data.get("title", "Unknown Game")
        logger.info(f"Manual trigger received for: {game_title} ({game_id}) | Candidates: {max_candidates}")

        # 2. Run the pipeline
        final_state = await run_pipeline_with_tracking(game_id, game_title, max_candidates=max_candidates)
        
        return {
            "status": final_state.get("status", "unknown"),
            "game_id": game_id,
            "game_title": game_title,
            "pipeline_summary": {
                "total_cost": final_state.get("accumulated_cost", 0),
                "visual_confidence": final_state.get("investigation", {}).get("best_match", {}).get("confidence_score", 0),
                "best_match_url": final_state.get("investigation", {}).get("best_match", {}).get("url")
            },
            "investigation_details": final_state.get("investigation", {})
        }
        
    except Exception as e:
        logger.error(f"Manual trigger failed for {game_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/status/{game_id}", summary="Check review status (Stub)")
async def get_test_status(game_id: str):
    """Placeholder for future status checks."""
    return {"game_id": game_id, "status": "In progress or completed", "note": "Sync with MongoDB for real status."}
