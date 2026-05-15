import asyncio
import logging
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import FastAPI

from app.config import get_settings
from app.runtime import get_runtime, init_runtime, shutdown_runtime
from app.api import agent, health, jobs, stage0, webhook

from datetime import datetime, timezone

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")
logger = logging.getLogger(__name__)

# Set at startup. The cron ignores proposals created before this process started,
# preventing historical PENDING backlog from flooding the queue on restart.
_process_start_time: datetime = datetime.now(timezone.utc)


async def cron_scan():
    """
    Automated Library Auditor: Proactively ensures all games have an AI review.
    
    The cron queries all active games that don't currently have:
    1. An approved submission submitted by the agent service account.
    2. A pending approval that hasn't been approved/rejected yet.
    
    These IDs are processed sequentially with submit_review set to true. 
    Subsequent runs will naturally process fewer games as the catalog gets enriched.
    """
    logger.info("[cron] Starting library audit scan...")
    try:
        runtime = get_runtime()
        settings = get_settings()
        
        count = 0
        while True:
            # Query for the next game that lacks an approved AI review.
            # We use SKIP LOCKED to ensure safety if multiple instances were to run.
            game = await runtime.game_repository.get_next_enrichment_candidate_game(
                agent_id=settings.SERVICE_USER_ID
            )
            
            if not game:
                # Also check for any existing pending proposals that might need a safety-net pickup
                proposal = await runtime.game_repository.get_next_pending_proposal()
                if not proposal:
                    break
                
                job = runtime.job_store.create_job("proposal_review", proposal["id"], submit_review=True)
                await runtime.queue.enqueue(job.job_id)
                logger.info(f"[cron] Claimed pending proposal {proposal['id']} for processing")
            else:
                game_id = game["id"]
                # Deduplicate against in-memory jobs
                existing_job = runtime.job_store.find_recent_job("game_review", game_id)
                if existing_job:
                    logger.info(f"[cron] Game {game_id} already has a recent job record. Status: {existing_job.status}")
                    continue

                job = runtime.job_store.create_job("game_review", game_id, submit_review=True)
                await runtime.queue.enqueue(job.job_id)
                logger.info(f"[cron] Audit: Identified and enqueued game {game_id} ('{game['title']}') for review")
            
            count += 1
            # We process them sequentially, so we just enqueue and let the worker handle it.
            # We break after a reasonable batch to allow the scheduler to breathe, 
            # or keep looping if you want to drain it all at once.
            if count >= 100: # Safety break for very large catalogs
                break

        logger.info(f"[cron] Scan complete. Identified {count} games/proposals needing attention.")
    except Exception as exc:
        logger.error(f"[cron] Autonomous scan failed: {exc}", exc_info=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    runtime = init_runtime()
    # Start queue worker
    worker_task = asyncio.create_task(runtime.queue.run_worker(runtime.process_job))

    # Start cron scheduler
    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        cron_scan, 
        CronTrigger(
            day_of_week=settings.CRON_SCHEDULE_DAY_OF_WEEK,
            hour=settings.CRON_SCHEDULE_HOUR,
            minute=0
        ),
        id="cron_scan",
        misfire_grace_time=30
    )
    scheduler.start()
    logger.info(
        f"[cron] Scheduler started — Schedule: {settings.CRON_SCHEDULE_DAY_OF_WEEK} at {settings.CRON_SCHEDULE_HOUR}:00, "
        f"misfire_grace_time: 30s"
    )

    yield

    scheduler.shutdown(wait=False)
    worker_task.cancel()
    await shutdown_runtime()


app = FastAPI(
    title="ArcadeBox AI Game Review Agent",
    description=(
        "Visual-first AI review service for ArcadeBox game submissions. "
        "It exposes health and webhook endpoints, then processes proposals asynchronously "
        "through Stage 0 visual verification, SEO intelligence, and downstream grounding."
    ),
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    swagger_ui_parameters={
        "displayRequestDuration": True,
        "docExpansion": "list",
        "defaultModelsExpandDepth": 1,
    },
    openapi_tags=[
        {
            "name": "Health",
            "description": "Service readiness and liveness endpoints.",
        },
        {
            "name": "Webhook",
            "description": "Inbound ArcadeBox webhook endpoints for queueing proposal review jobs.",
        },
        {
            "name": "Agent",
            "description": "Direct agent execution endpoints for running the workflow from a game id.",
        },
        {
            "name": "Jobs",
            "description": "Queue job tracking and job status inspection endpoints.",
        },
        {
            "name": "Stage 0",
            "description": "On-demand Stage 0 visual verification and artifact retrieval endpoints.",
        },
    ],
)

app.include_router(health.router)
app.include_router(webhook.router)
app.include_router(agent.router)
app.include_router(jobs.router)
app.include_router(stage0.router)
