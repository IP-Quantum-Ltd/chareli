import base64
import logging
import asyncio
from app.services.arcade_client import get_proposal
from app.services.browser_agent import capture_game_preview
from app.services.research_agent import ResearchAgent
from app.services.scribe_agent import ScribeAgent

logger = logging.getLogger(__name__)

async def run_full_generation(proposal_id: str) -> str:
    """
    The main entry point for generating content.
    1. Screenshot -> 2. OpenAI Research (Vision+Search) -> 3. Drafting.
    """
    logger.info(f"[Orchestrator] Starting GENERATION for proposal: {proposal_id}")

    # 1. Fetch proposal data
    proposal = await get_proposal(proposal_id)
    title = proposal.get("proposedData", {}).get("title", "Untitled Game")

    # 2. Capture Screenshot
    target_id = proposal.get("gameId") or proposal_id
    screenshot_filename = f"screenshot_{proposal_id}.png"
    
    try:
        await capture_game_preview(target_id, screenshot_filename)
        with open(screenshot_filename, "rb") as image_file:
            screenshot_base64 = base64.b64encode(image_file.read()).decode("utf-8")
        logger.info("[Orchestrator] Screenshot captured.")
    except Exception as e:
        logger.error(f"Screenshot failed: {e}")
        screenshot_base64 = ""

    # 3. Stage 1: OpenAI Research (Vision + Web Search)
    researcher = ResearchAgent()
    fact_sheet = await researcher.gather_facts(title, screenshot_base64)
    logger.info("[Orchestrator] Research complete.")

    # 4. Stage 2: Scribe (Final Drafting)
    scribe = ScribeAgent()
    article = await scribe.draft_from_facts(title, fact_sheet)
    logger.info("[Orchestrator] Drafting complete.")

    # 5. Save Output
    output_path = f"draft_{proposal_id}.md"
    with open(output_path, "w") as f:
        f.write(article)
    
    logger.info(f"[Orchestrator] Final article saved to {output_path}")
    return article

if __name__ == "__main__":
    # Test generation for a specific proposal
    test_id = "d1fbe524-b5e6-434c-91c4-bd3e7032fc72"
    asyncio.run(run_full_generation(test_id))
