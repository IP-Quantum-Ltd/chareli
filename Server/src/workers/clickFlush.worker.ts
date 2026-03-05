import { AppDataSource } from '../config/database';
import { GamePositionHistory } from '../entities/GamePositionHistory';
import { redisService } from '../services/redis.service';
import logger from '../utils/logger';

/**
 * Click Flush Worker
 * Processes buffered click counters from Redis and performs bulk writes to Postgres
 * Runs every 60 seconds via cron job
 */
export async function flushClickCounters(): Promise<void> {
  const startTime = Date.now();
  
  try {
    // Get all click counters from Redis
    const clickCounters = await redisService.getAllClickCounters();
    const positions = Object.keys(clickCounters).map(Number);

    if (positions.length === 0) {
      logger.debug('[CLICK-FLUSH] No click counters to process');
      return;
    }

    logger.info(`[CLICK-FLUSH] Processing ${positions.length} position click counters`);

    const gamePositionHistoryRepository = AppDataSource.getRepository(GamePositionHistory);
    
    // Build bulk update data
    const updates: Array<{ position: number; clicks: number }> = [];

    for (const position of positions) {
      const clicks = clickCounters[position];
      if (clicks > 0) {
        updates.push({ position, clicks });
      }
    }

    // Perform bulk update if we have data
    if (updates.length > 0) {
      // Use query builder for bulk update
      // PostgreSQL supports UPDATE with VALUES for bulk operations
      const queryRunner = AppDataSource.createQueryRunner();
      
      try {
        // Build the VALUES clause
        const values = updates
          .map(update => {
            return `(${update.position}, ${update.clicks})`;
          })
          .join(', ');

        // Build and execute bulk UPDATE query
        // This updates ALL game_position_history records for each position
        const query = `
          UPDATE internal.game_position_history
          SET "clickCount" = "clickCount" + v.clicks
          FROM (VALUES ${values}) AS v(position, clicks)
          WHERE internal.game_position_history.position = v.position
        `;

        await queryRunner.query(query);
        
        logger.info(
          `[CLICK-FLUSH] ✅ Bulk updated ${updates.length} positions`
        );
      } finally {
        await queryRunner.release();
      }
    }

    // Clear Redis counters for processed positions
    await redisService.clearClickCounters(positions);
    logger.info(`[CLICK-FLUSH] ✅ Cleared ${positions.length} Redis counters`);

    const duration = Date.now() - startTime;
    logger.info(
      `[CLICK-FLUSH] ✅ Flush completed in ${duration}ms (${updates.length} positions updated)`
    );
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(
      `[CLICK-FLUSH] ❌ Flush failed after ${duration}ms:`,
      error
    );
    // Don't throw - let cron retry on next run
  }
}
