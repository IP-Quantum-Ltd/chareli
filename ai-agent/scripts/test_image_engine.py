import asyncio
import logging
import base64
from app.services.investigator_agent import InvestigatorAgent
from app.services.librarian_service import LibrarianService
from app.services.architect_agent import ArchitectAgent
from app.services.scribe_agent import ScribeAgent

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s — %(message)s")
logger = logging.getLogger("ImageEngine")

async def run_image_engine():
    # 1. Setup - We use one of the existing screenshots from your root
    game_id = "d1fbe524-b5e6-434c-91c4-bd3e7032fc72"
    game_title = "Feed Monster" # Example title
    screenshot_path = f"screenshot_{game_id}.png"
    
    logger.info(f"--- STARTING IMAGE-BASED ENGINE FOR: {game_title} ---")

    # Read and encode screenshot
    with open(screenshot_path, "rb") as f:
        screenshot_base64 = base64.b64encode(f.read()).decode("utf-8")

    bundle = {
        "metadata": {"title": game_title},
        "screenshot_base64": screenshot_base64
    }

    # 2. Stage 1: Investigator (Vision)
    investigator = InvestigatorAgent()
    investigation = await investigator.investigate_game(bundle)
    logger.info(f"Investigation Complete. Canonical URL: {investigation['canonical_url']}")

    # 3. Stage 2: Librarian (Targeted Scrape)
    librarian = LibrarianService()
    success = await librarian.scrape_and_store(game_id, investigation["canonical_url"])
    if not success:
        logger.error("Scraping failed.")
        return

    # 4. Stage 3: Architect
    architect = ArchitectAgent()
    outline = await architect.build_outline(game_title, investigation)
    logger.info("Stage 3 (Architect) Complete.")

    # 5. Stage 5: Scribe
    scribe = ScribeAgent()
    article = await scribe.draft_article(game_id, game_title, outline)
    logger.info("Stage 5 (Scribe) Complete.")

    print("\n" + "="*50)
    print("FINAL ARCADE-FOCUSED ARTICLE")
    print("="*50)
    print(article[:2000] + "...")
    
    with open("vision_draft_output.md", "w") as f:
        f.write(article)
    logger.info("Saved vision-based draft to vision_draft_output.md")

if __name__ == "__main__":
    asyncio.run(run_image_engine())
