"""
In-memory job queue with proposal-id deduplication.
Prevents double-processing when webhook and cron both fire for the same proposal.

Day 3: swap this for a Redis-backed queue if needed for multi-worker deployments.
"""

import asyncio
import logging
from typing import Callable, Awaitable

logger = logging.getLogger(__name__)

_queued: set[str] = set()
_queue: asyncio.Queue[str] = asyncio.Queue()


def is_queued(proposal_id: str) -> bool:
    return proposal_id in _queued


async def enqueue(proposal_id: str) -> bool:
    """
    Add a proposal to the queue. Returns False if already queued (dedup).
    """
    if proposal_id in _queued:
        logger.debug(f"[queue] Proposal {proposal_id} already queued — skipping")
        return False
    _queued.add(proposal_id)
    await _queue.put(proposal_id)
    logger.info(f"[queue] Enqueued proposal {proposal_id}")
    return True


async def run_worker(handler: Callable[[str], Awaitable[None]]) -> None:
    """
    Continuously pulls proposal IDs from the queue and calls handler.
    Runs as a background asyncio task.
    """
    logger.info("[queue] Worker started")
    while True:
        proposal_id = await _queue.get()
        try:
            await handler(proposal_id)
        except Exception as exc:
            logger.error(f"[queue] Error processing proposal {proposal_id}: {exc}", exc_info=True)
        finally:
            _queued.discard(proposal_id)
            _queue.task_done()
