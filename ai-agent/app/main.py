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


async def cron_game_sweep():
    """
    Periodic sweep: finds all games that the agent has not yet reviewed and
    enqueues them as game_review jobs with submit_review=True.

    A game is considered already handled when it has at least one PENDING or
    APPROVED proposal submitted by the agent (SERVICE_USER_ID).  Games whose
    proposals were declined — or that never had one — are included so the agent
    gets another pass.

    Jobs are queued into the existing single-worker queue, so games are processed
    one at a time (no parallel token spend).  Subsequent sweep runs will naturally
    find fewer games as approvals accumulate.
    """
    logger.info("[game-sweep] Starting game sweep scan...")
    try:
        settings = get_settings()
        runtime = get_runtime()
        game_ids = await runtime.game_repository.get_unreviewed_game_ids(
            service_user_id=settings.SERVICE_USER_ID,
        )
        logger.info("[game-sweep] Found %d games without an active agent review", len(game_ids))

        enqueued = 0
        skipped = 0
        for game_id in game_ids:
            existing = runtime.job_store.find_recent_job("game_review", game_id)
            if existing is not None:
                skipped += 1
                continue
            job = runtime.job_store.create_job("game_review", game_id, submit_review=True)
            if await runtime.queue.enqueue(job.job_id):
                enqueued += 1

        logger.info(
            "[game-sweep] Enqueued %d games (%d already in queue — skipped)",
            enqueued, skipped,
        )
    except Exception as exc:
        logger.error("[game-sweep] Sweep failed: %s", exc, exc_info=True)


def _register_game_sweep(scheduler: AsyncIOScheduler, settings) -> None:
    """Add the game-sweep job to the scheduler using the configured schedule."""
    schedule = (settings.GAME_SWEEP_SCHEDULE or "weekly").lower().strip()
    day_value = (settings.GAME_SWEEP_DAY or "sun").strip()

    if schedule == "monthly":
        day_kwargs = {"day": day_value}
        desc = f"monthly on day {day_value}"
    else:
        day_kwargs = {"day_of_week": day_value}
        desc = f"weekly on {day_value}"

    scheduler.add_job(
        cron_game_sweep,
        "cron",
        **day_kwargs,
        hour=settings.GAME_SWEEP_HOUR,
        minute=settings.GAME_SWEEP_MINUTE,
        id="cron_game_sweep",
        misfire_grace_time=300,
    )
    logger.info(
        "[game-sweep] Scheduled %s at %02d:%02d UTC",
        desc,
        settings.GAME_SWEEP_HOUR,
        settings.GAME_SWEEP_MINUTE,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    runtime = init_runtime()
    # Start queue worker
    worker_task = asyncio.create_task(runtime.queue.run_worker(runtime.process_job))

    # Start cron scheduler
    scheduler = AsyncIOScheduler()

    if settings.GAME_SWEEP_ENABLED:
        _register_game_sweep(scheduler, settings)
    else:
        logger.info("[game-sweep] Disabled (set GAME_SWEEP_ENABLED=true to activate)")

    scheduler.start()
    logger.info("[cron] Scheduler started")

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
