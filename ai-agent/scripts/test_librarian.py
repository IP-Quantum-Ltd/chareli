import asyncio
import logging
import sys
import os

# Add the project root to sys.path so we can import 'app'
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy.orm import sessionmaker
from sqlmodel.ext.asyncio.session import AsyncSession
from app.database import async_engine
from app.services.librarian_service import LibrarianService
from app.models.enums import SearchDepth

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")
logger = logging.getLogger("test_librarian")

async def run_librarian_test():
    # Use centralized engine with proper connect_args
    async_session = sessionmaker(async_engine, class_=AsyncSession, expire_on_commit=False)
    
    # Using 'Football Kicks' PG ID pulled securely from Postgres earlier logs
    test_pg_id = '74098748-0e72-4bbb-b93f-d4a92ad3c249'
    
    logger.info("Initializing connection to databases (Class-based Test)...")
    
    async with async_session() as session:
        # Instantiate the LibrarianService class
        librarian = LibrarianService(pg_session=session)
        
        logger.info(f"Targeting Librarian Service with PG ID: {test_pg_id}")
        chunks_saved = await librarian.enrich_game(test_pg_id, depth=SearchDepth.ADVANCED)
        
        if chunks_saved:
            print(f"\n✅ Librarian Class Test Complete. Successfully saved {chunks_saved} chunks to MongoDB!")
        else:
            print("\n❌ Librarian Class Test Failed to save chunks.")
            
if __name__ == "__main__":
    asyncio.run(run_librarian_test())
