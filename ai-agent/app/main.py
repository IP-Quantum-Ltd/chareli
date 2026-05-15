import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import FastAPI

from app.api.agent import router as agent_router
from app.api.health import router as health_router
from app.api.jobs import router as jobs_router
from app.api.stage0 import router as stage0_router
from app.api.webhook import router as webhook_router
from app.config import get_settings
from app.runtime import get_runtime, init_runtime, shutdown_runtime

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")
logger = logging.getLogger(__name__)

# Set at startup. The watchdog in cron_scan ignores stalled proposals created 
# before this process started, preventing historical "dead" work from flooding the queue.
_process_start_time: datetime = datetime.now(timezone.utc)


async def cron_scan():
    """
    Autonomous Job Discoverer.
    
    1. Safety Net: Finds pending proposals (manual or stalled) and claims them.
       Respects _process_start_time for the watchdog.
    
    2. Library Audit: If enabled, finds games missing AI reviews and creates 
       proposals for them atomically.
    
    Sequential processing: Enqueues tasks one by one to avoid overwhelming workers.
    """
    settings = get_settings()
    logger.info("[cron] Starting autonomous scan...")
    
    try:
        runtime = get_runtime()
        count = 0
        
        while True:
            # Safety break for very large bursts
            if count >= 100:
                logger.warning("[cron] Batch limit reached (100). Will continue in next run.")
                break

            # A. Check for pending/stalled proposals (Safety Net)
            proposal = await runtime.game_repository.get_next_pending_proposal(
                min_created_at=_process_start_time
            )
            
            if proposal:
                proposal_id = proposal["id"]
                # Deduplicate against in-memory jobs
                existing_job = runtime.job_store.find_recent_job("proposal_review", proposal_id)
                if existing_job:
                    logger.info(f"[cron] Proposal {proposal_id} already has a recent job record. Status: {existing_job.status}")
                    continue

                job = runtime.job_store.create_job("proposal_review", proposal_id, submit_review=True)
                await runtime.queue.enqueue(job.job_id)
                logger.info(f"[cron] Claimed pending proposal {proposal_id} for processing")
                count += 1
                continue # Priority: clear the proposal queue first
            
            # B. Check for Library Audit (Proactive Enrichment)
            if settings.ENABLE_PROACTIVE_ENRICHMENT:
                audit_proposal = await runtime.game_repository.get_next_enrichment_candidate_game(
                    agent_id=settings.SERVICE_USER_ID
                )
                
                if audit_proposal:
                    proposal_id = audit_proposal["id"]
                    job = runtime.job_store.create_job("proposal_review", proposal_id, submit_review=True)
                    await runtime.queue.enqueue(job.job_id)
                    logger.info(f"[cron] Audit: Created and enqueued proposal {proposal_id} for game '{audit_proposal['title']}'")
                    count += 1
                    
                    # Sequential strategy: break after one to avoid flooding the dashboard.
                    # The next cron tick will pick up the next game.
                    break
            else:
                logger.debug("[cron] Library audit is disabled. Skipping enrichment step.")
                break
            
            # Nothing left to do
            break

        logger.info(f"[cron] Scan complete. Enqueued {count} tasks.")
    except Exception as exc:
        logger.error(f"[cron] Autonomous scan failed: {exc}", exc_info=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Load and validate settings (Crash early if misconfigured)
    settings = get_settings()
    settings.validate_setup()
    logger.info("[startup] Configuration validated successfully.")
    
    # 2. Initialize runtime services
    init_runtime()
    runtime = get_runtime()
    
    # 3. Start Background Queue Worker
    # This is essential for processing the jobs enqueued by webhooks or cron.
    worker_task = asyncio.create_task(runtime.queue.run_worker(runtime.process_job))
    logger.info("[startup] Background worker task started.")
    
    # 4. Start Cron Scheduler
    scheduler = AsyncIOScheduler()
    
    trigger_kwargs = {
        "day_of_week": settings.CRON_SCHEDULE_DAY_OF_WEEK,
        "hour": settings.CRON_SCHEDULE_HOUR,
        "minute": 0
    }
    
    if settings.CRON_SCHEDULE_MONTH_DAY != "*":
        trigger_kwargs["day"] = settings.CRON_SCHEDULE_MONTH_DAY
        trigger_kwargs.pop("day_of_week", None)
        logger.info(f"[cron] Monthly schedule: Day {settings.CRON_SCHEDULE_MONTH_DAY} at {settings.CRON_SCHEDULE_HOUR}:00")
    else:
        logger.info(f"[cron] Weekly schedule: {settings.CRON_SCHEDULE_DAY_OF_WEEK} at {settings.CRON_SCHEDULE_HOUR}:00")

    scheduler.add_job(
        cron_scan, 
        CronTrigger(**trigger_kwargs),
        id="cron_scan",
        misfire_grace_time=settings.CRON_MISFIRE_GRACE_HOURS * 3600
    )
    
    scheduler.start()
    logger.info(f"[cron] Scheduler started (misfire_grace={settings.CRON_MISFIRE_GRACE_HOURS}h).")

    yield
    
    # Shutdown gracefully
    logger.info("[shutdown] Stopping worker and scheduler...")
    scheduler.shutdown()
    worker_task.cancel()
    try:
        await worker_task
    except (asyncio.CancelledError, Exception):
        pass
    await shutdown_runtime()


app = FastAPI(
    title="ArcadeBox AI Agent",
    description="Autonomous SEO and Metadata Enrichment Agent",
    version="1.0.0",
    lifespan=lifespan
)

# Attach Routers with correct prefixing to avoid double-nesting
app.include_router(health_router)
app.include_router(webhook_router, prefix="/api")
app.include_router(agent_router, prefix="/api")
app.include_router(jobs_router, prefix="/api")
app.include_router(stage0_router, prefix="/api")
