import asyncio
import logging
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI

from app.config import get_settings
from app.runtime import get_runtime, init_runtime, shutdown_runtime
from app.api import agent, health, jobs, stage0, webhook

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")
logger = logging.getLogger(__name__)


async def cron_scan():
    """
    Automated approach: Communicates directly with the DB to find work.
    1. Checks for pending proposals that need AI review.
    2. If none, checks for published games that need SEO/metadata enrichment.
    Uses SKIP LOCKED for safe concurrent execution across multiple instances.
    """
    logger.info("[cron] Scanning database for next task...")
    try:
        runtime = get_runtime()
        
        # Step 1: Look for pending proposals (highest priority)
        proposal = await runtime.game_repository.get_next_pending_proposal()
        if proposal:
            proposal_id = proposal["id"]
            # Check if we already have an active job for this to avoid redundant memory usage
            existing_job = runtime.job_store.find_active_job("proposal_review", proposal_id)
            if existing_job:
                logger.info(f"[cron] Proposal {proposal_id} is already being processed in-memory.")
                return

            job = runtime.job_store.create_job("proposal_review", proposal_id, submit_review=True)
            await runtime.queue.enqueue(job.job_id)
            logger.info(f"[cron] Claimed proposal {proposal_id} from DB for concurrent processing")
            return

        # Step 2: Look for games needing enrichment (proactive approach)
        game = await runtime.game_repository.get_next_enrichment_candidate_game()
        if game:
            game_id = game["id"]
            existing_job = runtime.job_store.find_active_job("game_review", game_id)
            if existing_job:
                logger.info(f"[cron] Game {game_id} is already being processed in-memory.")
                return

            job = runtime.job_store.create_job("game_review", game_id, submit_review=True)
            await runtime.queue.enqueue(job.job_id)
            logger.info(f"[cron] Claimed game {game_id} ('{game['title']}') from DB for proactive enrichment")
            return

        logger.info("[cron] No pending work found in database.")
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
    scheduler.add_job(cron_scan, "interval", minutes=settings.CRON_INTERVAL_MINUTES, id="cron_scan")
    scheduler.start()
    logger.info(f"[cron] Scheduler started — interval: {settings.CRON_INTERVAL_MINUTES} min")

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
