import { AppDataSource } from '../config/database';
import { Analytics } from '../entities/Analytics';
import { redisService } from '../services/redis.service';
import logger from '../utils/logger';

/**
 * Analytics Flush Worker
 * Processes buffered analytics updates from Redis and performs bulk writes to Postgres
 * Runs every 60 seconds via cron job
 */
export async function flushBufferedAnalytics(): Promise<void> {
  const startTime = Date.now();
  
  try {
    // Get all buffered analytics from Redis
    const bufferedData = await redisService.getAllBufferedAnalytics();
    const analyticsIds = Object.keys(bufferedData);

    if (analyticsIds.length === 0) {
      logger.debug('[ANALYTICS-FLUSH] No buffered analytics to process');
      return;
    }

    logger.info(`[ANALYTICS-FLUSH] Processing ${analyticsIds.length} buffered analytics updates`);

    const analyticsRepository = AppDataSource.getRepository(Analytics);
    
    // Build bulk update data
    const updates: Array<{
      id: string;
      lastSeenAt?: Date;
      endTime?: Date;
      endedAt?: Date;
      exitReason?: string;
    }> = [];

    const idsToDelete: string[] = []; // For sessions < 30s

    for (const [analyticsId, fields] of Object.entries(bufferedData)) {
      const update: any = { id: analyticsId };

      if (fields.lastSeenAt) {
        update.lastSeenAt = new Date(fields.lastSeenAt);
      }

      if (fields.endTime) {
        update.endTime = new Date(fields.endTime);
        update.endedAt = new Date(fields.endedAt || fields.endTime);
      }

      if (fields.exitReason) {
        update.exitReason = fields.exitReason;
      }

      // Check if we need to validate duration (for session ends)
      if (update.endTime) {
        // Fetch the analytics record to check duration
        const analytics = await analyticsRepository.findOne({
          where: { id: analyticsId },
          select: ['id', 'gameId', 'startTime'],
        });

        if (analytics && analytics.gameId && analytics.startTime) {
          const duration = Math.floor(
            (update.endTime.getTime() - analytics.startTime.getTime()) / 1000
          );

          // For game sessions < 30 seconds, mark for deletion
          if (duration < 30) {
            idsToDelete.push(analyticsId);
            logger.debug(
              `[ANALYTICS-FLUSH] Marking analytics ${analyticsId} for deletion (duration: ${duration}s < 30s)`
            );
            continue; // Skip adding to updates
          }
        }
      }

      updates.push(update);
    }

    // Perform bulk update if we have data
    if (updates.length > 0) {
      // Use query builder for bulk update
      // PostgreSQL supports UPDATE with VALUES for bulk operations
      const queryRunner = AppDataSource.createQueryRunner();
      
      try {
        // Build the VALUES clause
        const values = updates
          .map((update, index) => {
            const parts: string[] = [`'${update.id}'`];
            
            if (update.lastSeenAt) {
              parts.push(`'${update.lastSeenAt.toISOString()}'`);
            } else {
              parts.push('NULL');
            }
            
            if (update.endTime) {
              parts.push(`'${update.endTime.toISOString()}'`);
            } else {
              parts.push('NULL');
            }
            
            if (update.endedAt) {
              parts.push(`'${update.endedAt.toISOString()}'`);
            } else {
              parts.push('NULL');
            }
            
            if (update.exitReason) {
              parts.push(`'${update.exitReason.replace(/'/g, "''")}'`); // Escape single quotes
            } else {
              parts.push('NULL');
            }
            
            return `(${parts.join(', ')})`;
          })
          .join(', ');

        // Build and execute bulk UPDATE query
        const query = `
          UPDATE internal.analytics
          SET 
            "lastSeenAt" = COALESCE(v.last_seen_at::timestamp, internal.analytics."lastSeenAt"),
            "endTime" = COALESCE(v.end_time::timestamp, internal.analytics."endTime"),
            "endedAt" = COALESCE(v.ended_at::timestamp, internal.analytics."endedAt"),
            "exitReason" = COALESCE(v.exit_reason, internal.analytics."exitReason")
          FROM (VALUES ${values}) AS v(id, last_seen_at, end_time, ended_at, exit_reason)
          WHERE internal.analytics.id::text = v.id
        `;

        await queryRunner.query(query);
        
        logger.info(
          `[ANALYTICS-FLUSH] ✅ Bulk updated ${updates.length} analytics records`
        );
      } finally {
        await queryRunner.release();
      }
    }

    // Delete analytics records with insufficient duration
    if (idsToDelete.length > 0) {
      await analyticsRepository.delete(idsToDelete);
      logger.info(
        `[ANALYTICS-FLUSH] ✅ Deleted ${idsToDelete.length} analytics records (duration < 30s)`
      );
    }

    // Clear Redis buffers for processed analytics
    await redisService.clearBufferedAnalytics(analyticsIds);
    logger.info(`[ANALYTICS-FLUSH] ✅ Cleared ${analyticsIds.length} Redis buffers`);

    const duration = Date.now() - startTime;
    logger.info(
      `[ANALYTICS-FLUSH] ✅ Flush completed in ${duration}ms (${updates.length} updated, ${idsToDelete.length} deleted)`
    );
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(
      `[ANALYTICS-FLUSH] ❌ Flush failed after ${duration}ms:`,
      error
    );
    // Don't throw - let cron retry on next run
  }
}
