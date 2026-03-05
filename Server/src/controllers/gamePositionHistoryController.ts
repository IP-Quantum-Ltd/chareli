import { Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../config/database';
import { GamePositionHistory } from '../entities/GamePositionHistory';
import { Game } from '../entities/Games';
import { ApiError } from '../middlewares/errorHandler';
import { storageService } from '../services/storage.service';
import { redisService } from '../services/redis.service';
import logger from '../utils/logger';

const gamePositionHistoryRepository = AppDataSource.getRepository(GamePositionHistory);
const gameRepository = AppDataSource.getRepository(Game);

/**
 * @swagger
 * /game-position-history/{gameId}:
 *   get:
 *     summary: Get position history for a specific game
 *     description: Retrieve the complete position history for a game, including all positions it has occupied and click counts.
 *     tags: [Game Position History]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: gameId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID of the game to get position history for
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *         description: Number of items per page
 *     responses:
 *       200:
 *         description: Position history retrieved successfully
 *       404:
 *         description: Game not found
 *       500:
 *         description: Internal server error
 */
export const getGamePositionHistory = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { gameId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const pageNumber = parseInt(page as string, 10);
    const limitNumber = parseInt(limit as string, 10);

    // Check if game exists
    const game = await gameRepository.findOne({ where: { id: gameId } });
    if (!game) {
      return next(ApiError.notFound(`Game with id ${gameId} not found`));
    }

    // Get position history with pagination
    const [history, total] = await gamePositionHistoryRepository.findAndCount({
      where: { gameId },
      order: { createdAt: 'DESC' },
      skip: (pageNumber - 1) * limitNumber,
      take: limitNumber,
      relations: ['game']
    });

    res.status(200).json({
      success: true,
      count: history.length,
      total,
      page: pageNumber,
      limit: limitNumber,
      totalPages: Math.ceil(total / limitNumber),
      data: history,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @swagger
 * /game-position-history/{gameId}/click:
 *   post:
 *     summary: Record a click event for a game
 *     description: Increment the click count for the game's current position asynchronously.
 *     tags: [Game Position History]
 *     parameters:
 *       - in: path
 *         name: gameId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID of the game that was clicked
 *     responses:
 *       202:
 *         description: Click tracking queued successfully
 *       404:
 *         description: Game not found
 *       500:
 *         description: Internal server error
 */
export const recordGameClick = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { gameId } = req.params;

    // Get the game's current position
    const game = await gameRepository.findOne({ where: { id: gameId } });
    if (!game) {
      return next(ApiError.notFound(`Game with id ${gameId} not found`));
    }

    if (!game.position) {
      return next(ApiError.badRequest(`Game ${gameId} does not have a position assigned`));
    }

    // Increment click counter in Redis (atomic operation, < 2ms)
    // This replaces the heavy BullMQ job queue approach
    await redisService.incrementClickCounter(game.position);

    // Return immediately - clicks are flushed to DB every 60 seconds via cron
    res.status(202).json({
      success: true,
      message: 'Click tracked successfully',
    });
  } catch (error) {
    // Don't fail the request even if Redis increment fails
    logger.error('Failed to increment click counter:', error);
    res.status(202).json({
      success: true,
      message: 'Request acknowledged',
    });
  }
};

/**
 * @swagger
 * /game-position-history/analytics:
 *   get:
 *     summary: Get click analytics and position performance
 *     description: Retrieve analytics data showing position performance across all games.
 *     tags: [Game Position History]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Analytics data retrieved successfully
 *       500:
 *         description: Internal server error
 */
export const getClickAnalytics = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Get position performance analytics
    const positionPerformance = await gamePositionHistoryRepository
      .createQueryBuilder('history')
      .select([
        'history.position as position',
        'COUNT(history.id) as totalRecords',
        'SUM(history.clickCount) as totalClicks',
        'AVG(history.clickCount) as avgClicksPerGame',
        'MAX(history.clickCount) as maxClicks',
        'MIN(history.clickCount) as minClicks'
      ])
      .groupBy('history.position')
      .orderBy('history.position', 'ASC')
      .getRawMany();

    // Get most clicked positions
    const mostClickedPositions = await gamePositionHistoryRepository
      .createQueryBuilder('history')
      .select([
        'history.position as position',
        'SUM(history.clickCount) as totalClicks'
      ])
      .groupBy('history.position')
      .orderBy('SUM(history.clickCount)', 'DESC')
      .limit(10)
      .getRawMany();

    // Get recent activity
    const recentActivity = await gamePositionHistoryRepository
      .createQueryBuilder('history')
      .leftJoinAndSelect('history.game', 'game')
      .where('history.updatedAt >= :date', {
        date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
      })
      .orderBy('history.updatedAt', 'DESC')
      .limit(20)
      .getMany();

    res.status(200).json({
      success: true,
      data: {
        positionPerformance,
        mostClickedPositions,
        recentActivity
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @swagger
 * /game-position-history:
 *   get:
 *     summary: Get all position history (Admin only)
 *     description: Retrieve position history for all games with filtering options.
 *     tags: [Game Position History]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *         description: Number of items per page
 *       - in: query
 *         name: position
 *         schema:
 *           type: integer
 *         description: Filter by specific position
 *       - in: query
 *         name: positionMin
 *         schema:
 *           type: integer
 *         description: Filter by minimum position
 *       - in: query
 *         name: positionMax
 *         schema:
 *           type: integer
 *         description: Filter by maximum position
 *       - in: query
 *         name: clickCountMin
 *         schema:
 *           type: integer
 *         description: Filter by minimum click count
 *       - in: query
 *         name: clickCountMax
 *         schema:
 *           type: integer
 *         description: Filter by maximum click count
 *       - in: query
 *         name: gameTitle
 *         schema:
 *           type: string
 *         description: Filter by game title (partial match)
 *       - in: query
 *         name: categoryId
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by game category
 *       - in: query
 *         name: gameStatus
 *         schema:
 *           type: string
 *           enum: [active, disabled]
 *         description: Filter by game status
 *     responses:
 *       200:
 *         description: Position history retrieved successfully
 *       403:
 *         description: Forbidden - Admin access required
 *       500:
 *         description: Internal server error
 */
export const getAllPositionHistory = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const {
      page,
      limit,
      position,
      positionMin,
      positionMax,
      clickCountMin,
      clickCountMax,
      gameTitle
    } = req.query;

    // Only apply pagination if limit is explicitly provided
    const shouldPaginate = limit !== undefined;
    const pageNumber = shouldPaginate ? parseInt(page as string || '1', 10) : 1;
    const limitNumber = shouldPaginate ? parseInt(limit as string, 10) : undefined;

    let queryBuilder = gamePositionHistoryRepository
      .createQueryBuilder('history')
      .leftJoinAndSelect('history.game', 'game')
      .leftJoinAndSelect('game.thumbnailFile', 'thumbnailFile')
      .leftJoinAndSelect('game.gameFile', 'gameFile');

    // Apply history-specific filters
    if (position) {
      queryBuilder.andWhere('history.position = :position', { position: parseInt(position as string) });
    }

    if (positionMin) {
      queryBuilder.andWhere('history.position >= :positionMin', { positionMin: parseInt(positionMin as string) });
    }

    if (positionMax) {
      queryBuilder.andWhere('history.position <= :positionMax', { positionMax: parseInt(positionMax as string) });
    }

    if (clickCountMin) {
      queryBuilder.andWhere('history.clickCount >= :clickCountMin', { clickCountMin: parseInt(clickCountMin as string) });
    }

    if (clickCountMax) {
      queryBuilder.andWhere('history.clickCount <= :clickCountMax', { clickCountMax: parseInt(clickCountMax as string) });
    }

    if (gameTitle) {
      queryBuilder.andWhere('game.title ILIKE :gameTitle', { gameTitle: `%${gameTitle}%` });
    }

    // Get total count
    const total = await queryBuilder.getCount();

    // Apply ordering
    queryBuilder.orderBy('history.createdAt', 'DESC');

    // Apply pagination only if limit is provided
    if (shouldPaginate && limitNumber) {
      queryBuilder
        .skip((pageNumber - 1) * limitNumber)
        .take(limitNumber);
    }

    const history = await queryBuilder.getMany();

    // Transform game file and thumbnail URLs to direct storage URLs
    history.forEach(historyItem => {
      if (historyItem.game) {
        if (historyItem.game.gameFile) {
          const s3Key = historyItem.game.gameFile.s3Key;
          historyItem.game.gameFile.s3Key = storageService.getPublicUrl(s3Key);
        }
        if (historyItem.game.thumbnailFile) {
          const s3Key = historyItem.game.thumbnailFile.s3Key;
          historyItem.game.thumbnailFile.s3Key = storageService.getPublicUrl(s3Key);
        }
      }
    });

    // Build response object based on whether pagination is used
    const response: any = {
      success: true,
      count: history.length,
      total,
      data: history,
    };

    // Only include pagination info if pagination is being used
    if (shouldPaginate && limitNumber) {
      response.page = pageNumber;
      response.limit = limitNumber;
      response.totalPages = Math.ceil(total / limitNumber);
    }

    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
};

/**
 * @swagger
 * /game-position-history/performance:
 *   get:
 *     summary: Get position performance metrics
 *     description: Get detailed performance metrics for each position.
 *     tags: [Game Position History]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Performance metrics retrieved successfully
 *       500:
 *         description: Internal server error
 */
export const getPositionPerformance = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Get simplified position performance metrics
    const performance = await gamePositionHistoryRepository
      .createQueryBuilder('history')
      .select([
        'history.position as position',
        'COUNT(history.id) as gamesAtPosition',
        'SUM(history.clickCount) as totalClicks',
        'AVG(history.clickCount) as avgClicks',
        'MAX(history.clickCount) as maxClicks',
        'MIN(history.clickCount) as minClicks'
      ])
      .groupBy('history.position')
      .orderBy('history.position', 'ASC')
      .getRawMany();

    res.status(200).json({
      success: true,
      data: performance
    });
  } catch (error) {
    next(error);
  }
};
