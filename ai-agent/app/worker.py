import logging
from arq.connections import RedisSettings
from app.config import settings
from app.services import agent, sync_service
from app.database import async_engine
from sqlalchemy.orm import sessionmaker
from sqlmodel.ext.asyncio.session import AsyncSession

logger = logging.getLogger("worker")

async def startup(ctx):
    """
    Initialize resources needed by tasks (e.g., DB sessions).
    """
    logger.info("Worker starting up...")
    ctx["session_factory"] = sessionmaker(
        async_engine, class_=AsyncSession, expire_on_commit=False
    )

async def shutdown(ctx):
    """
    Cleanup resources.
    """
    logger.info("Worker shutting down...")

async def run_pipeline_task(ctx, proposal_id: str):
    """
    Background job to run the content generation pipeline.
    """
    logger.info(f"Running pipeline for proposal: {proposal_id}")
    await agent.run_pipeline(proposal_id)

async def sync_metadata_task(ctx):
    """
    Periodic task to sync PG metadata to MongoDB.
    """
    logger.info("Starting metadata sync task...")
    async_session = ctx["session_factory"]
    async with async_session() as session:
        count = await sync_service.sync_pg_to_mongo(session)
        logger.info(f"Sync complete. Processed {count} games.")

class WorkerSettings:
    """
    Configuration for the arq worker.
    """
    functions = [run_pipeline_task, sync_metadata_task]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = settings.ARQ_REDIS_SETTINGS
    # Run sync every hour as a cron job
    cron_jobs = [
        sync_metadata_task # We'll trigger this manually for now or via cron setting
    ]
