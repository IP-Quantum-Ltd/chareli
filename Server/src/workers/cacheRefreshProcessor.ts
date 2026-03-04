import { queueService, JobType } from '../services/queue.service';
import { processCacheRefreshJob } from './cacheRefresh.worker';
import logger from '../utils/logger';

/**
 * Initialize the cache refresh worker
 * This worker handles background cache refresh jobs for the SWR (Stale-While-Revalidate) pattern
 */
export function initializeCacheRefreshWorker(): void {
  try {
    const worker = queueService.createWorker<any>(
      JobType.CACHE_REFRESH,
      processCacheRefreshJob
    );

    logger.info('✅ [CACHE-REFRESH] Worker initialized successfully');
  } catch (error) {
    logger.error('❌ [CACHE-REFRESH] Failed to initialize worker:', error);
    throw error;
  }
}
