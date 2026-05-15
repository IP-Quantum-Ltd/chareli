import asyncio
import logging
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
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
    Automated approach: Communicates directly with the DB to identify and process work.
    
    The cron queries all jobs that don't currently fit our 'completed' or 'processing' 
    conditions (i.e., those that are pending or have stalled) and sequentially 
    processes them all. This ensures that any backlog is cleared efficiently while 
    remaining safe for future multi-agent concurrency via SKIP LOCKED.

    Only considers proposals created after this process started — proposals that existed
    before the current deployment are ignored to prevent historical backlog from flooding
    the queue on restart.
    """
    logger.info("[cron] Scanning database for pending work...")
    try:
        runtime = get_runtime()
        config = runtime.config.queue
        
        count = 0
        while True:
            # We pick one task at a time but loop until the DB is drained.
            # We respect the process start time to avoid processing old backlog.
            proposal = await runtime.game_repository.get_next_pending_proposal(
                min_created_at=_process_start_time
            )
            if not proposal:
                break

            proposal_id = proposal["id"]
            # Deduplicate against in-memory jobs
            existing_job = runtime.job_store.find_recent_job("proposal_review", proposal_id)
            if existing_job:
                logger.info(f"[cron] Proposal {proposal_id} already has a recent job record. Status: {existing_job.status}")
                continue

            job = runtime.job_store.create_job("proposal_review", proposal_id, submit_review=True)
            await runtime.queue.enqueue(job.job_id)
            logger.info(f"[cron] Claimed and enqueued proposal {proposal_id}")
            count += 1

        # Proactive enrichment (if enabled and proposal queue is empty)
        if count == 0 and config.enable_proactive_enrichment:
            while True:
                game = await runtime.game_repository.get_next_enrichment_candidate_game()
                if not game:
                    break
                
                game_id = game["id"]
                existing_job = runtime.job_store.find_recent_job("game_review", game_id)
                if existing_job:
                    continue

                job = runtime.job_store.create_job("game_review", game_id, submit_review=True)
                await runtime.queue.enqueue(job.job_id)
                logger.info(f"[cron] Claimed and enqueued game {game_id} for enrichment")
                count += 1
                # Limit proactive enrichment to avoid huge bursts
                if count >= 10: 
                    break

        logger.info(f"[cron] Scan complete. Enqueued {count} tasks.")
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
        "interval", 
        minutes=settings.CRON_INTERVAL_MINUTES, 
        id="cron_scan",
        misfire_grace_time=30
    )
    scheduler.start()
    logger.info(f"[cron] Scheduler started — interval: {settings.CRON_INTERVAL_MINUTES} min, misfire_grace_time: 30s")

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
