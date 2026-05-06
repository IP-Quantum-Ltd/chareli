import asyncio
import logging
from dataclasses import dataclass
from typing import Awaitable, Callable, Protocol

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class QueueJob:
    job_id: str


class JobQueue(Protocol):
    def is_queued(self, job_id: str) -> bool:
        ...

    async def enqueue(self, job_id: str) -> bool:
        ...

    async def run_worker(self, handler: Callable[[str], Awaitable[None]]) -> None:
        ...


class InMemoryJobQueue:
    def __init__(self) -> None:
        self._queued: set[str] = set()
        self._queue: asyncio.Queue[str] = asyncio.Queue()

    def is_queued(self, job_id: str) -> bool:
        return job_id in self._queued

    async def enqueue(self, job_id: str) -> bool:
        if job_id in self._queued:
            logger.debug("[queue] Job %s already queued — skipping", job_id)
            return False
        self._queued.add(job_id)
        await self._queue.put(job_id)
        logger.info("[queue] Enqueued job %s", job_id)
        return True

    async def run_worker(self, handler: Callable[[str], Awaitable[None]]) -> None:
        logger.info("[queue] Worker started")
        while True:
            job_id = await self._queue.get()
            try:
                await handler(job_id)
            except Exception as exc:
                logger.error("[queue] Error processing job %s: %s", job_id, exc, exc_info=True)
            finally:
                self._queued.discard(job_id)
                self._queue.task_done()


InMemoryProposalQueue = InMemoryJobQueue
