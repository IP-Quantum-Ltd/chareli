import { Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../config/database';
import { Analytics } from '../entities/Analytics';
import { User } from '../entities/User';
import { ApiError } from '../middlewares/errorHandler';
import { Between, FindOptionsWhere } from 'typeorm';
import { cacheService } from '../services/cache.service';
import { queueService } from '../services/queue.service';
import logger from '../utils/logger';
import { validate } from 'class-validator';
import { AdminExclusionService } from '../services/adminExclusion.service';

const analyticsRepository = AppDataSource.getRepository(Analytics);
const userRepository = AppDataSource.getRepository(User);

/**
 * @swagger
 * /analytics:
 *   post:
 *     summary: Create a new analytics entry
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - activityType
 *               - startTime
 *             properties:
 *               gameId:
 *                 type: string
 *                 format: uuid
 *                 description: Optional for non-game activities like login/signup
 *               activityType:
 *                 type: string
 *               startTime:
 *                 type: string
 *                 format: date-time
 *               endTime:
 *                 type: string
 *                 format: date-time
 *               sessionCount:
 *                 type: integer
 *                 minimum: 1
 *                 default: 1
 *     responses:
 *       201:
 *         description: Analytics entry created successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
export const createAnalytics = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const {
      gameId,
      activityType,
      startTime,
      endTime,
      sessionCount,
      sessionId,
    } = req.body;

    // Get user ID from authenticated user (if logged in)
    const userId = req.user?.userId || null;

    // Require either userId or sessionId
    if (!userId && !sessionId) {
      return next(
        ApiError.badRequest('Either authentication or sessionId is required')
      );
    }

    // Enqueue analytics processing job
    const job = await queueService.addAnalyticsProcessingJob({
      userId,
      sessionId: sessionId || null,
      gameId: gameId || null,
      activityType,
      startTime: new Date(startTime),
      endTime: endTime ? new Date(endTime) : undefined,
      sessionCount,
    });

    // Wait for the job to complete and get the result
    // This adds minimal delay but ensures we get the analytics ID
    const analytics = await job.waitUntilFinished(queueService.queueEvents);

    // Return 201 Created with the analytics ID
    res.status(201).json({
      success: true,
      message: 'Analytics event created successfully',
      id: analytics.id,
      data: analytics,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @swagger
 * /analytics:
 *   get:
 *     summary: Get all analytics entries
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by user ID
 *       - in: query
 *         name: gameId
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by game ID
 *       - in: query
 *         name: activityType
 *         schema:
 *           type: string
 *         description: Filter by activity type
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by start date (inclusive)
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by end date (inclusive)
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Number of items per page
 *     responses:
 *       200:
 *         description: List of analytics entries
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
export const getAllAnalytics = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const {
      userId,
      gameId,
      activityType,
      startDate,
      endDate,
      page = 1,
      limit = 10,
    } = req.query;

    const pageNumber = parseInt(page as string, 10);
    const limitNumber = parseInt(limit as string, 10);

    // Try cache first - create cache key from filters
    const filterParts = [
      userId ? `user:${userId}` : '',
      gameId ? `game:${gameId}` : '',
      activityType ? `type:${activityType}` : '',
      startDate ? `start:${startDate}` : '',
      endDate ? `end:${endDate}` : '',
      `page:${pageNumber}`,
      `limit:${limitNumber}`,
    ].filter(Boolean);

    const cacheKey = filterParts.join(':') || 'all';
    const cached = await cacheService.getAnalytics('list', cacheKey);

    if (cached) {
      logger.debug(`Cache hit for analytics query: ${cacheKey}`);
      res.status(200).json(cached);
      return;
    }

    // Build where conditions
    const whereConditions: FindOptionsWhere<Analytics> = {};

    if (userId) {
      whereConditions.userId = userId as string;
    }

    if (gameId) {
      whereConditions.gameId = gameId as string;
    }

    if (activityType) {
      whereConditions.activityType = activityType as string;
    }

    if (startDate && endDate) {
      whereConditions.startTime = Between(
        new Date(startDate as string),
        new Date(endDate as string)
      );
    } else if (startDate) {
      whereConditions.startTime = Between(
        new Date(startDate as string),
        new Date()
      );
    }

    // Get total count for pagination
    const total = await analyticsRepository.count({
      where: whereConditions,
    });

    // Get analytics entries with pagination
    const analytics = await analyticsRepository.find({
      where: whereConditions,
      skip: (pageNumber - 1) * limitNumber,
      take: limitNumber,
      order: {
        startTime: 'DESC',
      },
      relations: ['user', 'game'],
    });

    const responseData = {
      success: true,
      count: analytics.length,
      total,
      page: pageNumber,
      limit: limitNumber,
      totalPages: Math.ceil(total / limitNumber),
      data: analytics,
    };

    // Cache for 1 hour (3600s) - analytics data changes infrequently
    await cacheService.setAnalytics(
      'list',
      cacheKey,
      responseData,
      undefined,
      3600
    );
    logger.debug(`Cached analytics query: ${cacheKey}`);

    res.status(200).json(responseData);
  } catch (error) {
    next(error);
  }
};

/**
 * @swagger
 * /analytics/{id}:
 *   get:
 *     summary: Get analytics entry by ID
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Analytics entry ID
 *     responses:
 *       200:
 *         description: Analytics entry found
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Analytics entry not found
 *       500:
 *         description: Internal server error
 */
export const getAnalyticsById = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;

    const analytics = await analyticsRepository.findOne({
      where: { id },
      relations: ['user', 'game'],
    });

    if (!analytics) {
      return next(ApiError.notFound(`Analytics entry with id ${id} not found`));
    }

    res.status(200).json({
      success: true,
      data: analytics,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @swagger
 * /analytics/{id}:
 *   put:
 *     summary: Update analytics entry
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Analytics entry ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               endTime:
 *                 type: string
 *                 format: date-time
 *               sessionCount:
 *                 type: integer
 *                 minimum: 1
 *     responses:
 *       200:
 *         description: Analytics entry updated successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Analytics entry not found
 *       500:
 *         description: Internal server error
 */
export const updateAnalytics = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const {
      endTime,
      sessionCount,
      exitReason,
      loadTime,
      milestone,
      errorMessage,
    } = req.body;

    const analytics = await analyticsRepository.findOne({
      where: { id },
    });

    if (!analytics) {
      return next(ApiError.notFound(`Analytics entry with id ${id} not found`));
    }

    // Always update lastSeenAt on any update
    analytics.lastSeenAt = new Date();

    // Update fields
    if (endTime !== undefined) {
      if (endTime) {
        analytics.endTime = new Date(endTime);
        // If we are setting endTime, we can populate endedAt as well if not already set,
        // or let the inferencing logic handle it.
        // For now, let's treat explicit endTime as endedAt too for consistency.
        analytics.endedAt = new Date(endTime);
      }
    }

    if (sessionCount !== undefined) analytics.sessionCount = sessionCount;
    if (exitReason !== undefined) analytics.exitReason = exitReason;
    if (loadTime !== undefined) analytics.loadTime = loadTime;
    if (milestone !== undefined) analytics.milestone = milestone;
    if (errorMessage !== undefined) analytics.errorMessage = errorMessage;

    // Calculate duration before saving
    if (analytics.startTime && analytics.endTime) {
      const duration = Math.floor(
        (analytics.endTime.getTime() - analytics.startTime.getTime()) / 1000
      );

      // For game sessions, only save if duration >= 30 seconds
      if (analytics.gameId && duration < 30) {
        // Delete the analytics record if it's a game session with duration < 30 seconds
        await analyticsRepository.remove(analytics);

        res.status(200).json({
          success: true,
          message:
            'Analytics entry removed due to insufficient duration (< 30 seconds)',
          data: null,
        });
        return;
      }
    }

    // Validate updated entity
    const errors = await validate(analytics, { skipMissingProperties: true });
    if (errors.length > 0) {
      res.status(400).json({
        error: 'Validation failed',
        details: errors.map((e) => ({
          field: e.property,
          messages: Object.values(e.constraints || {}),
        })),
      });
      return;
    }

    await analyticsRepository.save(analytics);

    res.status(200).json({
      success: true,
      data: analytics,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @swagger
 * /analytics/{id}/heartbeat:
 *   post:
 *     summary: Update analytics lastSeenAt (heartbeat)
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Analytics entry ID
 *     responses:
 *       204:
 *         description: Heartbeat received
 *       404:
 *         description: Analytics entry not found
 *       500:
 *         description: Internal server error
 */
export const heartbeatAnalytics = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;

    // Use update for efficiency (avoid fetch if possible, but typeorm update won't check existance/ownership strictly unless we check result)
    // For simplicity and correctness with entities, fetch then save
    // Or simpler: update directly
    const result = await analyticsRepository.update(id, {
      lastSeenAt: new Date(),
    });

    if (result.affected === 0) {
       // Optional: return 404 if we want strict checking, but usually for heartbeat
       // we can just return 204.
       // However, if the ID doesn't exist, we probably shouldn't return 204 success.
       // But the plan says "Lightweight endpoint", so maybe just ignore.
       // Let's stick to 204.
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};


/**
 * @swagger
 * /analytics/{id}/end:
 *   post:
 *     summary: Update analytics end time during page unload
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - endTime
 *             properties:
 *               endTime:
 *                 type: string
 *                 format: date-time
 */
export const updateAnalyticsEndTime = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const { endTime, exitReason } = req.body;

    const analytics = await analyticsRepository.findOne({
      where: { id },
    });

    if (!analytics) {
      return next(ApiError.notFound(`Analytics entry with id ${id} not found`));
    }

    analytics.endTime = new Date(endTime);
    analytics.endedAt = new Date(endTime); // Explicit end implies endedAt
    analytics.lastSeenAt = new Date(); // Always update lastSeenAt
    if (exitReason) {
      analytics.exitReason = exitReason;
    }

    // Calculate duration before saving
    if (analytics.startTime && analytics.endTime) {
      const duration = Math.floor(
        (analytics.endTime.getTime() - analytics.startTime.getTime()) / 1000
      );

      // For game sessions, only save if duration >= 30 seconds
      if (analytics.gameId && duration < 30) {
        // Delete the analytics record if it's a game session with duration < 30 seconds
        await analyticsRepository.remove(analytics);

        res.status(200).json({
          success: true,
          message:
            'Analytics entry removed due to insufficient duration (< 30 seconds)',
          data: null,
        });
        return;
      }
    }

    await analyticsRepository.save(analytics);

    res.status(200).json({
      success: true,
      data: analytics,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @swagger
 * /analytics/{id}:
 *   delete:
 *     summary: Delete analytics entry
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Analytics entry ID
 *     responses:
 *       200:
 *         description: Analytics entry deleted successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Analytics entry not found
 *       500:
 *         description: Internal server error
 */
export const deleteAnalytics = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;

    const analytics = await analyticsRepository.findOne({
      where: { id },
    });

    if (!analytics) {
      return next(ApiError.notFound(`Analytics entry with id ${id} not found`));
    }

    await analyticsRepository.remove(analytics);

    res.status(200).json({
      success: true,
      message: 'Analytics entry deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 *@swagger
 * /analytics/homepage-visit:
 *   post:
 *     summary: Track homepage visit
 *     tags: [Analytics]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               sessionId:
 *                 type: string
 *                 description: Anonymous session ID (if not authenticated)
 *     responses:
 *       202:
 *         description: Homepage visit tracking queued successfully
 *       500:
 *         description: Internal server error
 */
export const trackHomepageVisit = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Get user ID from authenticated user (if logged in)
    const userId = req.user?.userId || null;

    // Get session ID from body (for anonymous users)
    const { sessionId } = req.body || {};

    // Require either userId or sessionId
    if (!userId && !sessionId) {
      return next(
        ApiError.badRequest('Either authentication or sessionId is required')
      );
    }

    // Additional safeguard: Check if authenticated user is admin
    // This provides triple-layer protection:
    // 1. Controller level (here) - prevents queueing
    // 2. Worker level - prevents saving if somehow queued
    // 3. Query level - filters out if somehow saved
    if (userId) {
      const shouldTrack = await AdminExclusionService.shouldTrack(userId);

      if (!shouldTrack) {
        logger.debug(
          `[Analytics Controller] Skipping homepage visit for user ${userId} - admin activities excluded from analytics`
        );
        res.status(202).json({
          success: true,
          message: 'Admin activities excluded from analytics',
        });
        return;
      }
    }

    // Enqueue homepage visit tracking job (non-blocking)
    await queueService.addHomepageVisitJob({
      userId,
      sessionId: sessionId || null,
    });

    // Return immediately without waiting for processing
    res.status(202).json({
      success: true,
      message: 'Homepage visit tracking queued successfully',
    });
  } catch (error) {
    // Don't block user experience even if tracking fails
    logger.error('Failed to queue homepage visit tracking:', error);
    res.status(202).json({
      success: true,
      message: 'Request acknowledged',
    });
  }
};
