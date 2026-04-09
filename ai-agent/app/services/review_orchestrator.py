import base64
import logging
from app.services.arcade_client import get_proposal
from app.services.browser_agent import capture_game_preview

logger = logging.getLogger(__name__)


async def prepare_review_bundle(proposal_id: str) -> dict:
    logger.info(
        f"[Orchestrator] Starting bundle preparation for proposal: {proposal_id}"
    )

    # 1. Fetch proposal data from the backend
    proposal = await get_proposal(proposal_id)
    if not proposal:
        raise ValueError(f"Proposal {proposal_id} not found in database.")

    proposed_data = proposal.get("proposedData", {})
    metadata = proposed_data.get("metadata", {})

    # 2. Extract Metadata for Agent 2
    # Victoria's Agent 2 needs these fields for its analysis
    analysis_metadata = {
        "title": proposed_data.get("title", "Untitled Game"),
        "description": proposed_data.get("description", "No description provided."),
        "developer": metadata.get("developer", "Unknown Developer"),
        "platform": metadata.get("platform", "Not specified"),
        "category_id": proposed_data.get("categoryId"),
        "how_to_play": metadata.get("howToPlay", ""),
    }

    # 3. Capture Screenshot
    # We use the gameId if it exists (for updates) or proposalId (for new games)
    # The browser_agent will try to navigate to /gameplay/:id
    target_id = proposal.get("gameId") or proposal_id
    screenshot_filename = f"screenshot_{proposal_id}.png"

    try:
        await capture_game_preview(target_id, screenshot_filename)

        # 4. Convert Screenshot to Base64
        with open(screenshot_filename, "rb") as image_file:
            screenshot_base64 = base64.b64encode(image_file.read()).decode("utf-8")

        screenshot_available = True
        logger.info(f"[Orchestrator] Screenshot captured and encoded for {proposal_id}")

        # Clean up the file after encoding to keep workspace clean
        # os.remove(screenshot_filename)

    except Exception as e:
        logger.error(f"[Orchestrator] Screenshot capture failed for {proposal_id}: {e}")
        screenshot_base64 = ""
        screenshot_available = False

    # 5. Final Package for Victoria
    return {
        "proposal_id": proposal_id,
        "screenshot_available": screenshot_available,
        "screenshot_base64": screenshot_base64,
        "metadata": analysis_metadata,
    }


if __name__ == "__main__":
    # Test Orchestrator with your "Feed Monster" proposal ID
    import asyncio

    test_proposal_id = "9927a533-92e2-40b5-956c-9bb7f9059b4d"

    async def test():
        bundle = await prepare_review_bundle(test_proposal_id)
        # We print keys and metadata to verify, but not the giant base64 string
        print("--- Orchestrator Test ---")
        print(f"Proposal ID: {bundle['proposal_id']}")
        print(f"Screenshot Available: {bundle['screenshot_available']}")
        print(
            f"Metadata Extracted: {bundle['metadata']['title']} by {bundle['metadata']['developer']}"
        )

    asyncio.run(test())
