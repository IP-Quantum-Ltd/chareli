import asyncio
import logging
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI

from app.config import settings
from app.db.mongo import close_mongodb
from app.db.postgres import close_postgres_pool
from app.routers import health, webhook
from app.services import task_queue as queue, agent
from app.services.arcade_client import get_pending_proposals

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")
logger = logging.getLogger(__name__)


async def cron_scan():
    """
    Fallback scan: fetches all PENDING proposals and enqueues any not already queued.
    Runs every CRON_INTERVAL_MINUTES minutes as a safety net for missed webhooks.
    """
    logger.info("[cron] Scanning for pending proposals...")
    try:
        proposals = await get_pending_proposals()
        count = 0
        for p in proposals:
            enqueued = await queue.enqueue(p["id"])
            if enqueued:
                count += 1
        logger.info(f"[cron] Enqueued {count} new proposals from {len(proposals)} pending")
    except Exception as exc:
        logger.error(f"[cron] Scan failed: {exc}", exc_info=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start queue worker
    worker_task = asyncio.create_task(queue.run_worker(agent.run_pipeline))

    # Start cron scheduler
    scheduler = AsyncIOScheduler()
    scheduler.add_job(cron_scan, "interval", minutes=settings.CRON_INTERVAL_MINUTES, id="cron_scan")
    scheduler.start()
    logger.info(f"[cron] Scheduler started — interval: {settings.CRON_INTERVAL_MINUTES} min")

    yield

    scheduler.shutdown(wait=False)
    worker_task.cancel()
    await close_mongodb()
    await close_postgres_pool()


app = FastAPI(title="ArcadeBox AI Game Review Agent", lifespan=lifespan)

app.include_router(health.router)
app.include_router(webhook.router)
