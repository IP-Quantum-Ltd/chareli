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
    
    # Proposal ID for 'Feed Monster' (or similar) based on available asset
    test_id = "9927a533-92e2-40b5-956c-9bb7f9059b4d"
    game_title = "Feed Monster"
    
    try:
        final_state = await run_pipeline_with_tracking(test_id, game_title)
        
        logger.info("=== TEST RUN COMPLETE ===")
        logger.info(f"Final Status: {final_state['status']}")
        logger.info(f"Cumulative Run Cost: ${final_state['accumulated_cost']:.4f}")
        
        if final_state["status"] == "complete":
            # Save the article
            output_file = f"vision_graph_output_{test_id}.md"
            with open(output_file, "w") as f:
                f.write(final_state["article"])
            logger.info(f"SEO Draft saved to: {output_file}")
        else:
            logger.error(f"Reason for Failure: {final_state.get('error_message', 'Unknown Error')}")
            
    except Exception as e:
        logger.error(f"Test crashed: {e}", exc_info=True)

if __name__ == "__main__":
    asyncio.run(test_full_flow())
