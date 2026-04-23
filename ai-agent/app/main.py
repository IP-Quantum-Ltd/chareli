import asyncio
import logging
from contextlib import asynccontextmanager
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI

from app.config import settings
from app.db.mongo import close_mongodb
from app.db.postgres import close_postgres_pool
from app.routers import health, webhook, review
from app.services import task_queue as queue, agent
from app.services.arcade_client import get_game

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start queue worker
    worker_task = asyncio.create_task(queue.run_worker(agent.run_pipeline))

    yield

    worker_task.cancel()
    await close_mongodb()
    await close_postgres_pool()


app = FastAPI(title="ArcadeBox AI Game Review Agent", lifespan=lifespan)

app.include_router(health.router)
app.include_router(webhook.router)
app.include_router(review.router)
