import asyncio
import logging
import os
from datetime import datetime, timezone
from dotenv import load_dotenv

from app.runtime import init_runtime, shutdown_runtime, get_runtime
from app.config import get_settings
from app.main import cron_scan

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")
logger = logging.getLogger("audit-test")

async def test_audit():
    load_dotenv()
    logger.info("Initializing runtime for Library Audit test...")
    runtime = init_runtime()
    settings = get_settings()
    
    logger.info(f"Agent Service User ID: {settings.SERVICE_USER_ID}")
    
    # 1. Preview the "Missing Review" count
    pool = await runtime.postgres_provider.get_pool()
    async with pool.acquire() as conn:
        agent_filter = ""
        args = []
        if settings.SERVICE_USER_ID and len(settings.SERVICE_USER_ID) >= 32:
            agent_filter = """
              AND NOT EXISTS (
                  SELECT 1 FROM public.game_proposals p 
                  WHERE p."gameId" = g.id 
                    AND p.status = 'approved' 
                    AND p."editorId" = $1
              )
            """
            args.append(settings.SERVICE_USER_ID)
        else:
            logger.warning("SERVICE_USER_ID is missing or invalid. Audit will include all games without pending proposals.")

        count = await conn.fetchval(f"""
            SELECT COUNT(*)
            FROM public.games g
            WHERE g.status = 'active'
              AND NOT EXISTS (
                  SELECT 1 FROM public.game_proposals p 
                  WHERE p."gameId" = g.id AND p.status = 'pending'
              )
              {agent_filter}
        """, *args)
        
        logger.info(f"--- LIBRARY STATUS ---")
        logger.info(f"Games needing AI review: {count}")
        
        if count > 0:
            samples = await conn.fetch(f"""
                SELECT g.id, g.title
                FROM public.games g
                WHERE g.status = 'active'
                  AND NOT EXISTS (
                      SELECT 1 FROM public.game_proposals p 
                      WHERE p."gameId" = g.id AND p.status = 'pending'
                  )
                  {agent_filter}
                ORDER BY g."createdAt" ASC
                LIMIT 5
            """, *args)
            logger.info("Next 5 candidates in queue:")
            for s in samples:
                logger.info(f"  - [{s['id']}] {s['title']}")
    
    # 2. Trigger the actual cron_scan logic
    logger.info("\n--- TRIGGERING CRON SCAN ---")
    await cron_scan()
    
    # 3. Check the in-memory queue
    queued_jobs = list(runtime.job_store._jobs.keys())
    logger.info(f"Jobs currently enqueued in memory: {len(queued_jobs)}")
    
    logger.info("Test complete. Shutting down...")
    await shutdown_runtime()

if __name__ == "__main__":
    asyncio.run(test_audit())
