"""
Redis-backed job queue using Arq.
Prevents double-processing and ensures job persistence.
"""

import logging
from typing import Optional
from arq import create_pool
from app.config import settings

logger = logging.getLogger(__name__)

# Singleton pool instance
_redis_pool = None

async def get_redis_pool():
    global _redis_pool
    if _redis_pool is None:
        _redis_pool = await create_pool(settings.ARQ_REDIS_SETTINGS)
    return _redis_pool

async def enqueue(proposal_id: str) -> bool:
    """
    Add a proposal to the Arq queue. 
    Arq handles job IDs for deduplication if we provide a unique job_id.
    """
    try:
        pool = await get_redis_pool()
        # Use proposal_id as job_id for automatic deduplication by Arq
        await pool.enqueue_job("run_pipeline_task", proposal_id, _job_id=f"pipeline_{proposal_id}")
        logger.info(f"[queue] Enqueued pipeline task for {proposal_id}")
        return True
    except Exception as e:
        logger.error(f"[queue] Failed to enqueue {proposal_id}: {e}")
        return False

async def close_queue():
    global _redis_pool
    if _redis_pool:
        await _redis_pool.close()
        _redis_pool = None
