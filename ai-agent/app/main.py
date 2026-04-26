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
    Fallback scan: fetches all PENDING proposals and enqueues any not already queued.
    Runs every CRON_INTERVAL_MINUTES minutes as a safety net for missed webhooks.
    """
    logger.info("[cron] Scanning for pending proposals...")
    try:
        runtime = get_runtime()
        proposals = await runtime.arcade_client.get_pending_proposals()
        count = 0
        for p in proposals:
            existing_job = runtime.job_store.find_active_job("proposal_review", p["id"])
            job = existing_job or runtime.job_store.create_job("proposal_review", p["id"], submit_review=True)
            enqueued = existing_job is None and await runtime.queue.enqueue(job.job_id)
            if enqueued:
                count += 1
        logger.info(f"[cron] Enqueued {count} new proposals from {len(proposals)} pending")
    except Exception as exc:
        logger.error(f"[cron] Scan failed: {exc}", exc_info=True)


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
