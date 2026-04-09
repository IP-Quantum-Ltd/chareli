import asyncio
import logging
import sys
import os

# Add the project root to sys.path so we can import 'app'
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import async_engine
from app.services.sync_service import sync_pg_to_mongo
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlalchemy.orm import sessionmaker

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")
logger = logging.getLogger("sync_script")

async def main():
    logger.info("Starting PG to MongoDB sync process...")
    
    # Create an async session factory
    async_session = sessionmaker(
        async_engine, class_=AsyncSession, expire_on_commit=False
    )
    
    try:
        async with async_session() as session:
            count = await sync_pg_to_mongo(session)
            logger.info(f"Sync complete. {count} documents processed.")
    except Exception as e:
        logger.error(f"Sync failed: {e}", exc_info=True)
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())
