import asyncio
import logging
import json
from app.services.analyst_agent import AnalystAgent
from app.services.architect_agent import ArchitectAgent
from app.services.scribe_agent import ScribeAgent

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s — %(message)s")
logger = logging.getLogger("ContentEngine")

async def run_content_engine():
    # Use Football Kicks since we already have chunks for it in MongoDB
    game_id = "74098748-0e72-4bbb-b93f-d4a92ad3c249"
    game_title = "Football Kicks"
    
    logger.info(f"--- STARTING CONTENT ENGINE FOR: {game_title} ---")

    # 1. Stage 1: Analyst
    analyst = AnalystAgent()
    seo_intel = await analyst.analyze_keyword(f"{game_title} walkthrough guide tricks")
    logger.info("Stage 1 (Analyst) Complete.")

    # 2. Stage 3: Architect
    architect = ArchitectAgent()
    outline = await architect.build_outline(game_title, seo_intel)
    logger.info("Stage 3 (Architect) Complete.")

    # 3. Stage 5: Scribe
    scribe = ScribeAgent()
    article = await scribe.draft_article(game_id, game_title, outline)
    logger.info("Stage 5 (Scribe) Complete.")

    print("\n" + "="*50)
    print("FINAL GENERATED ARTICLE (PREVIEW)")
    print("="*50)
    print(article[:1000] + "...")
    print("\n" + "="*50)
    
    # Save the draft
    with open("draft_output.md", "w") as f:
        f.write(article)
    logger.info("Saved full draft to draft_output.md")

if __name__ == "__main__":
    asyncio.run(run_content_engine())
