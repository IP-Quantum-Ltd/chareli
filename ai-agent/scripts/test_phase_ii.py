import asyncio
import logging
import sys
import os
import json

# Add the project root to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy.orm import sessionmaker
from sqlmodel.ext.asyncio.session import AsyncSession
from app.database import async_engine
from app.services.analyst_agent import AnalystAgent
from app.services.librarian_service import LibrarianService
from app.models.enums import SearchDepth

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")
logger = logging.getLogger("test_phase_ii")

async def run_end_to_end_test():
    # Setup
    async_session = sessionmaker(async_engine, class_=AsyncSession, expire_on_commit=False)
    test_pg_id = '74098748-0e72-4bbb-b93f-d4a92ad3c249' # Football Kicks
    keyword = "Football Kicks game update patch notes guide"
    
    logger.info("--- Phase II End-to-End Test Started ---")
    
    # 1. Stage 1: Analyst Agent
    logger.info(f"Stepping into Stage 1 (Analyst) for keyword: '{keyword}'")
    analyst = AnalystAgent()
    blueprint = await analyst.analyze_keyword(keyword)
    
    print("\n[Stage 1] SEO Blueprint & Ground Truth Result:")
    print(json.dumps(blueprint, indent=2))
    
    # 2. Stage 2: Librarian Service (Integrated with Blueprint)
    logger.info(f"Stepping into Stage 2 (Librarian) for PG ID: {test_pg_id}")
    async with async_session() as session:
        librarian = LibrarianService(pg_session=session)
        
        # We pass the blueprint from Stage 1 into Stage 2
        chunks_saved = await librarian.enrich_game(
            test_pg_id, 
            seo_blueprint=blueprint, 
            depth=SearchDepth.ADVANCED,
            persist=False # TRIAL MODE: Don't save to MongoDB yet
        )
        
        if chunks_saved:
            print(f"\n✅ Phase II Trial Complete. Pipeline verified with {chunks_saved} virtual chunks!")
            print("The flow: Websearch -> Pydantic -> (Skipped MongoDB) was executed.")
        else:
            print("\n❌ Phase II Test Failed.")

if __name__ == "__main__":
    asyncio.run(run_end_to_end_test())
