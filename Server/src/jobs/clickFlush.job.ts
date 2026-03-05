import cron from 'node-cron';
import { flushClickCounters } from '../workers/clickFlush.worker';
import logger from '../utils/logger';

/**
 * Click Counter Flush Job
 * Flushes buffered click counters from Redis to Postgres every 60 seconds
 */
export function startClickFlushJob(): void {
  logger.info('[CLICK-FLUSH-JOB] Initializing click counter flush job (every 60 seconds)');

  // Run every 60 seconds (every minute)
  cron.schedule('*/1 * * * *', async () => {
    try {
      logger.debug('[CLICK-FLUSH-JOB] Triggering click counter flush...');
      await flushClickCounters();
    } catch (error) {
      logger.error('[CLICK-FLUSH-JOB] Failed to flush click counters:', error);
    }
  });

  logger.info('[CLICK-FLUSH-JOB] ✅ Click counter flush job started successfully');
}
