import { schedule, ScheduledTask } from 'node-cron';
import { flushBufferedAnalytics } from '../workers/analyticsFlush.worker';
import logger from '../utils/logger';

let analyticsFlushTask: ScheduledTask | null = null;

/**
 * Start the analytics flush cron job
 * Runs every 60 seconds to batch-write buffered analytics to Postgres
 */
export function startAnalyticsFlushJob(): void {
  try {
    // Run every 60 seconds (every minute)
    analyticsFlushTask = schedule('*/1 * * * *', async () => {
      logger.debug('[ANALYTICS-FLUSH-JOB] Starting scheduled flush');
      await flushBufferedAnalytics();
    });

    logger.info('✅ [ANALYTICS-FLUSH-JOB] Scheduled to run every 60 seconds');
  } catch (error) {
    logger.error('[ANALYTICS-FLUSH-JOB] Failed to start:', error);
  }
}

/**
 * Stop the analytics flush cron job
 */
export function stopAnalyticsFlushJob(): void {
  if (analyticsFlushTask) {
    analyticsFlushTask.stop();
    logger.info('[ANALYTICS-FLUSH-JOB] Stopped');
  }
}
