import cron from 'node-cron';
import { queueService } from '../services/queue.service';
import logger from '../utils/logger';
import config from '../config/config';
import { redisService } from '../services/redis.service';

/**
 * Scheduled job to refresh JSON CDN files
 * Uses leader election to ensure only one instance runs the cron
 */
export const startJsonCdnRefreshJob = async (): Promise<void> => {
  if (!config.jsonCdn.enabled) {
    logger.info('JSON CDN is disabled, skipping refresh job');
    return;
  }

  const intervalMinutes = config.jsonCdn.refreshIntervalMinutes || 5;
  const cronSchedule = `*/${intervalMinutes} * * * *`;
  const LEADER_KEY = 'cron:json-cdn:leader';
  const LEADER_TTL = 60; // 60 seconds

  // Try to become the leader
  const becomeLeader = async (): Promise<boolean> => {
    try {
      const redis = redisService.getClient();
      // Use SET NX (set if not exists) with expiry
      const result = await redis.set(
        LEADER_KEY,
        process.pid.toString(),
        'EX',
        LEADER_TTL,
        'NX'
      );
      return result === 'OK';
    } catch (error) {
      logger.error('Error in leader election for JSON CDN cron:', error);
      return false;
    }
  };

  // Renew leadership periodically
  const renewLeadership = async (): Promise<void> => {
    try {
      const redis = redisService.getClient();
      await redis.expire(LEADER_KEY, LEADER_TTL);
    } catch (error) {
      logger.error('Error renewing JSON CDN cron leadership:', error);
    }
  };

  // Check if this instance is the leader
  const isLeader = await becomeLeader();

  if (!isLeader) {
    logger.info(
      'JSON CDN refresh job: Another instance is the leader, skipping cron initialization'
    );
    return;
  }

  logger.info(
    `JSON CDN refresh job: This instance is the LEADER, initializing cron (every ${intervalMinutes} minutes)`
  );

  // Renew leadership every 30 seconds
  setInterval(renewLeadership, 30000);

  // Schedule the cron job (only runs on leader)
  cron.schedule(cronSchedule, async () => {
    try {
      // Verify still leader before scheduling
      const redis = redisService.getClient();
      const currentLeader = await redis.get(LEADER_KEY);

      if (currentLeader !== process.pid.toString()) {
        logger.warn('JSON CDN cron: Lost leadership, skipping this execution');
        return;
      }

      logger.info('Scheduling JSON CDN refresh job...');

      // Schedule job in existing queue
      await queueService.addJsonCdnJob({ type: 'full' });

      logger.info('JSON CDN refresh job scheduled successfully');
    } catch (error) {
      logger.error('Error scheduling JSON CDN refresh job:', error);
    }
  });

  // Schedule initial generation on startup (after 5s delay)
  setTimeout(async () => {
    try {
      // Guard clause: Prevent running if system time is invalid (e.g. 1970)
      if (new Date().getFullYear() < 2025) {
        logger.warn(
          `[JSON CDN] System time invalid (${new Date().toISOString()}), skipping initial generation`
        );
        return;
      }

      logger.info('Scheduling initial JSON CDN generation...');
      await queueService.addJsonCdnJob({ type: 'full' });
      logger.info('Initial JSON CDN generation scheduled');
    } catch (error) {
      logger.error('Error scheduling initial JSON CDN generation:', error);
    }
  }, 5000);
};
