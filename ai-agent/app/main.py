import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import FastAPI

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
    if not settings.ENABLE_PROACTIVE_ENRICHMENT:
        logger.info("[cron] Library audit is disabled. Skipping scan.")
        # We still run the safety net though
    
    logger.info("[cron] Starting autonomous scan...")
    try:
        runtime = get_runtime()
        
        count = 0
        while True:
            # A. Check for pending/stalled proposals (Safety Net)
            # This handles webhooks that were missed or crashed jobs.
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
                # get_next_enrichment_candidate_game atomically creates a proposal
                # and returns it, so we treat it like a proposal review.
                audit_proposal = await runtime.game_repository.get_next_enrichment_candidate_game(
                    agent_id=settings.SERVICE_USER_ID
                )
                
                if audit_proposal:
                    proposal_id = audit_proposal["id"]
                    job = runtime.job_store.create_job("proposal_review", proposal_id, submit_review=True)
                    await runtime.queue.enqueue(job.job_id)
                    logger.info(f"[cron] Audit: Created and enqueued proposal {proposal_id} for game '{audit_proposal['title']}'")
                    count += 1
                    continue
            
            # Nothing left to do
            break

            if count >= 100: # Safety break for very large bursts
                logger.warning("[cron] Batch limit reached (100). Will continue in next run.")
                break

        logger.info(f"[cron] Scan complete. Enqueued {count} tasks.")
    except Exception as exc:
        logger.error(f"[cron] Autonomous scan failed: {exc}", exc_info=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load and validate settings at startup
    settings = get_settings()
    try:
        settings.validate_setup()
        logger.info("[startup] Configuration validated successfully.")
    except ValueError as e:
        logger.error(f"[startup] FATAL CONFIG ERROR: {e}")
        # In a real production app, we might exit here.
        # For now, we log it and continue so the dev can fix .env
    
    # Initialize services (DB pools, etc.)
    init_runtime()
    
    # Start cron scheduler
    scheduler = AsyncIOScheduler()
    
    # Support for both weekly and monthly triggers
    trigger_kwargs = {
        "day_of_week": settings.CRON_SCHEDULE_DAY_OF_WEEK,
        "hour": settings.CRON_SCHEDULE_HOUR,
        "minute": 0
    }
    
    # If a specific day of the month is set (other than *), it becomes a monthly job
    if settings.CRON_SCHEDULE_MONTH_DAY != "*":
        trigger_kwargs["day"] = settings.CRON_SCHEDULE_MONTH_DAY
        # Remove day_of_week if we are targeting a specific date
        trigger_kwargs.pop("day_of_week", None)
        logger.info(f"[cron] Monthly schedule detected: Day {settings.CRON_SCHEDULE_MONTH_DAY} at {settings.CRON_SCHEDULE_HOUR}:00")
    else:
        logger.info(f"[cron] Weekly schedule detected: {settings.CRON_SCHEDULE_DAY_OF_WEEK} at {settings.CRON_SCHEDULE_HOUR}:00")

    scheduler.add_job(
        cron_scan, 
        CronTrigger(**trigger_kwargs),
        id="cron_scan",
        # Convert hours to seconds for APScheduler
        misfire_grace_time=settings.CRON_MISFIRE_GRACE_HOURS * 3600
    )
    
    scheduler.start()
    logger.info(f"[cron] Scheduler started with {settings.CRON_MISFIRE_GRACE_HOURS}h misfire grace.")

    yield
    
    # Shutdown gracefully
    await shutdown_runtime()


app = FastAPI(lifespan=lifespan)
# app.include_router(...)
