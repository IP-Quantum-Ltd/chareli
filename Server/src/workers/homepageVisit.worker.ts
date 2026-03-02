import { Job } from 'bullmq';
import { queueService, HomepageVisitJobData } from '../services/queue.service';
import { AppDataSource } from '../config/database';
import { Analytics } from '../entities/Analytics';
import { User } from '../entities/User';
import logger from '../utils/logger';

const analyticsRepository = AppDataSource.getRepository(Analytics);
const userRepository = AppDataSource.getRepository(User);

/**
 * Worker to process homepage visit tracking jobs
 * Records when users (authenticated or anonymous) land on the homepage
 */
queueService.createWorker<HomepageVisitJobData>(
  'homepage-visit',
  async (job: Job<HomepageVisitJobData>) => {
    const { userId, sessionId } = job.data;

    try {
      // Check if user is admin - skip analytics for admin users
      if (userId) {
        const user = await userRepository.findOne({
          where: { id: userId },
          relations: ['role'],
        });

        // Exclude all admin-type roles from analytics
        const adminRoles = ['superadmin', 'admin', 'editor', 'viewer'];
        if (user && user.role && adminRoles.includes(user.role.name)) {
          logger.debug(
            `[Homepage Visit Worker] Skipping homepage visit tracking for ${user.role.name} user ${userId} - admin activities are excluded from analytics`
          );
          return { success: true, analyticsId: 'admin-excluded' };
        }
      }

      // Create analytics entry for homepage visit
      const analytics = analyticsRepository.create({
        userId: userId || null,
        sessionId: sessionId || null,
        gameId: null, // Homepage visit, no game
        activityType: 'homepage_visit',
        startTime: new Date(),
        endTime: new Date(),
        duration: 0, // Instantaneous event
        sessionCount: 1,
      });

      await analyticsRepository.save(analytics);

      logger.debug(
        `Homepage visit tracked for ${userId ? `user ${userId}` : `session ${sessionId}`}`
      );

      return { success: true, analyticsId: analytics.id };
    } catch (error) {
      logger.error('Failed to process homepage visit job:', error);
      throw error; // Let BullMQ handle retries
    }
  }
);

logger.info('Homepage visit tracking worker initialized');
