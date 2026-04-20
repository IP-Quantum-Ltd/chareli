import base64
import logging
import asyncio
import os
from app.services.arcade_client import get_proposal
from app.services.browser_agent import capture_game_preview
from app.services.visual_librarian import VisualLibrarian
from app.services.analyst_agent import AnalystAgent
from app.services.architect_agent import ArchitectAgent
from app.services.scribe_agent import ScribeAgent

logger = logging.getLogger(__name__)

async def run_full_generation(proposal_id: str) -> str:
    """
    FULL 14-DAY SPRINT PIPELINE (Visual-First Refactor)
    Stages: 0, 1, 3, 5, 7.
    """
    logger.info(f"[Orchestrator] Starting 14-Day SEO Sprint for: {proposal_id}")

    # 1. Fetch proposal data
    proposal = await get_proposal(proposal_id)
    title = proposal.get("proposedData", {}).get("title", "Untitled Game")

    # 2. Stage -1: Capture Internal Game Asset
    target_id = proposal.get("gameId") or proposal_id
    internal_screenshot = f"internal_{proposal_id}.png"
    
    try:
        await capture_game_preview(target_id, internal_screenshot)
        with open(internal_screenshot, "rb") as f:
            internal_base64 = base64.b64encode(f.read()).decode("utf-8")
    except Exception as e:
        logger.error(f"Internal capture failed: {e}")
        return "Critical Failure: Could not capture reference screenshot."

    # 3. Stage 0: Visual Librarian (Correlation Analysis)
    librarian = VisualLibrarian()
    investigation = await librarian.verify_and_research(title, internal_base64)
    
    if investigation["status"] == "failed":
        logger.warning(f"Visual Verification Failed: {investigation['reason']}")
        return f"Pipeline stopped: {investigation['reason']}"
        
    best_match = investigation["best_match"]
    verified_facts = best_match["extracted_facts"]
    
    # 4. Stage 1: SEO Intelligence
    analyst = AnalystAgent()
    seo_blueprint = await analyst.analyze_seo_potential(title, verified_facts)

    # 5. Stage 3: Architect (Outline)
    architect = ArchitectAgent()
    outline = await architect.build_outline(title, {
        "visual_description": best_match["reasoning"],
        "canonical_url": best_match["url"]
    })

    # 6. Stage 5: Scribe (Drafting)
    scribe = ScribeAgent()
    article = await scribe.draft_from_facts(title, {
        "source_url": best_match["url"],
        "facts": verified_facts,
        "seo": seo_blueprint
    })

    # 7. Final Cleanup & Export
    if os.path.exists(internal_screenshot): os.remove(internal_screenshot)
    
    output_path = f"draft_{proposal_id}.md"
    with open(output_path, "w") as f:
        f.write(article)
    
    logger.info(f"[Orchestrator] 14-Day Sprint Complete. Article saved to {output_path}")
    return article

if __name__ == "__main__":
    # Test with "Football Kicks"
    import sys
    test_id = "d1fbe524-b5e6-434c-91c4-bd3e7032fc72"
    asyncio.run(run_full_generation(test_id))
