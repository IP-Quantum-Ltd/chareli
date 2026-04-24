import { Job } from 'bullmq';
import { AppDataSource } from '../config/database';
import { Analytics } from '../entities/Analytics';
import { User } from '../entities/User';
import logger from '../utils/logger';
import { AnalyticsProcessingJobData } from '../services/queue.service';
import { getCountryFromIP } from '../utils/ipUtils';
import { AdminExclusionService } from '../services/adminExclusion.service';
import { cacheService } from '../services/cache.service';

const analyticsRepository = AppDataSource.getRepository(Analytics);
const userRepository = AppDataSource.getRepository(User);

/**
 * Worker processor for analytics processing jobs
 * Writes analytics data to database asynchronously
 * @returns The saved analytics object with ID
 */
export async function processAnalyticsJob(
  job: Job<AnalyticsProcessingJobData>
): Promise<Analytics> {
  const {
    userId,
    sessionId,
    gameId,
    activityType,
    startTime,
    endTime,
    sessionCount,
    ipAddress,
  } = job.data;

  try {
    logger.debug(
      `[Analytics Worker] Processing analytics job ${job.id} for ${
        userId ? `user ${userId}` : `session ${sessionId}`
      }`
    );

    // Validate that at least one identifier is present
    if (!userId && !sessionId) {
      throw new Error('Either userId or sessionId must be provided');
    }

    // Check if user is admin - skip analytics for admin users
    if (userId) {
      const user = await userRepository.findOne({
        where: { id: userId },
        relations: ['role'],
      });

      // Centralised admin exclusion — same source of truth as controllers and dashboard queries.
      if (user && !AdminExclusionService.shouldTrackUser(user)) {
        logger.debug(
          `[Analytics Worker] Skipping analytics for ${user.role!.name} user ${userId} - admin activities are excluded from analytics`
        );
        // Return a placeholder analytics object to maintain API compatibility
        // This will not be saved to the database
        return {
          id: 'admin-excluded',
          userId,
          sessionId,
          gameId,
          activityType,
          startTime,
          endTime,
          duration: 0,
          sessionCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as Analytics;
      }
    }

    let country: string | undefined;
    if (!userId && ipAddress) {
      try {
        const resolvedCountry = await getCountryFromIP(ipAddress);
        if (resolvedCountry) {
          country = resolvedCountry;
        }
      } catch (err) {
        logger.error(`Error resolving country for IP ${ipAddress}`, err);
      }
    }

    // Create analytics entry
    const analytics = analyticsRepository.create({
      userId,
      sessionId,
      gameId,
      activityType,
      startTime: startTime ? new Date(startTime) : undefined,
      endTime: endTime ? new Date(endTime) : undefined,
      sessionCount: sessionCount || 1,
      country,
    });

    // Save to database
    const saved = await analyticsRepository.save(analytics);
    await cacheService.invalidateDashboard();

    logger.debug(
      `[Analytics Worker] Successfully saved analytics ${saved.id} for ${
        userId ? `user ${userId}` : `session ${sessionId}`
      }`
    );

    // Return the saved analytics so the controller can access the ID
    return saved;
  } catch (error) {
    logger.error(
      `[Analytics Worker] Failed to process analytics job ${job.id}:`,
      error
    );
    throw error; // Re-throw to trigger retry
  }
}
