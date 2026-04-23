import asyncio
import logging
import json
from app.services.graph_orchestrator import run_pipeline_with_tracking

# Configure Logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")
logger = logging.getLogger(__name__)

async def test_full_flow():
    """
    Simulates a full SEO content generation run for 'Football Kicks'
    using the new LangGraph state machine with cost tracking.
    """
    logger.info("=== STARTING LANGGRAPH TEST FLOW (COST TRACKING ENABLED) ===")
    
    # Proposal ID for 'Feed Monster' based on live staging slug
    test_id = "74098748-0e72-4bbb-b93f-d4a92ad3c249"
    game_title = "Football Kicks"
    
    try:
        final_state = await run_pipeline_with_tracking(test_id, game_title)
        
        logger.info("=== TEST RUN COMPLETE ===")
        logger.info(f"Final Status: {final_state['status']}")
        logger.info(f"Cumulative Run Cost: ${final_state['accumulated_cost']:.4f}")
        
        if final_state["status"] == "complete":
            # Save the raw investigation data for team verification
            output_file = f"research_findings_{test_id}.json"
            
            report_data = {
                "game_title": game_title,
                "game_id": test_id,
                "total_cost_usd": final_state["accumulated_cost"],
                "best_match_url": final_state["investigation"]["best_match"]["url"],
                "visual_confidence": final_state["investigation"]["best_match"]["confidence_score"],
                "all_candidates": [
                    {k: v for k, v in c.items() if k != "screenshot_base64"} 
                    for c in final_state["investigation"]["all_candidates"]
                ],
                "seo_blueprint": final_state["seo_blueprint"],
                "outline": final_state.get("outline", {}),
                "final_article": final_state.get("article", "")
            }
            
            with open(output_file, "w") as f:
                json.dump(report_data, f, indent=4)
                
            logger.info(f"Team Investigation Report saved to: {output_file}")
            logger.info(f"Visual Confidence: {report_data['visual_confidence']}%")
        else:
            logger.error(f"Reason for Failure: {final_state.get('error_message', 'Unknown Error')}")
            
    except Exception as e:
        logger.error(f"Test crashed: {e}", exc_info=True)

if __name__ == "__main__":
    asyncio.run(test_full_flow())
