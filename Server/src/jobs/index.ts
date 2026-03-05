import cron from 'node-cron';
import logger from '../utils/logger';
import { checkInactiveUsers } from './userInactivityCheck';
import { updateLikeCounts } from '../cron/updateLikeCounts';

export { startJsonCdnRefreshJob } from './jsonCdnRefresh.job';
export { startAnalyticsFlushJob } from './analyticsFlush.job';
export { startClickFlushJob } from './clickFlush.job';

/**
 * Initialize all scheduled jobs
 */
export function initializeScheduledJobs(): void {
  try {
    logger.info('Initializing scheduled jobs...');

    // User inactivity check - runs daily at midnight
    cron.schedule('0 0 * * *', async () => {
      logger.info('Running scheduled job: User inactivity check');
      try {
        await checkInactiveUsers();
      } catch (error) {
        logger.error('Error in user inactivity check job:', error);
      }
    });

    // Like count cache update - runs daily at 2 AM
    cron.schedule('0 2 * * *', async () => {
      try {
        await updateLikeCounts();
      } catch (error) {
        logger.error('[Cron] Like count cache update failed:', error);
      }
    });

    logger.info('Scheduled jobs initialized successfully');
    logger.info('Note: Analytics and Click flush jobs start separately via their respective functions');
  } catch (error) {
    logger.error('Failed to initialize scheduled jobs:', error);
  }
}
