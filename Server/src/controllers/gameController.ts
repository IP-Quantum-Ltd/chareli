import { Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../config/database';
import { Game, GameStatus, GameProcessingStatus } from '../entities/Games';
import { GamePositionHistory } from '../entities/GamePositionHistory';
import { Category } from '../entities/Category';
import { File } from '../entities/Files';
import { Analytics } from '../entities/Analytics';
import { GameLike } from '../entities/GameLike';
import { GameLikeCache } from '../entities/GameLikeCache';
import { SystemConfig } from '../entities/SystemConfig';
import { ApiError } from '../middlewares/errorHandler';
import { RoleType } from '../entities/Role';
import { Not, In } from 'typeorm';
import { storageService } from '../services/storage.service';
import { zipService } from '../services/zip.service';
import { queueService } from '../services/queue.service';
import multer from 'multer';
import logger from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import config from '../config/config';
import path from 'path';
import { moveFileToPermanentStorage } from '../utils/fileUtils';
import { generateUniqueSlug } from '../utils/slugify';
import { cacheService } from '../services/cache.service';
import { cacheInvalidationService } from '../services/cache-invalidation.service';
import { redisService } from '../services/redis.service';
import { multipartUploadHelpers } from '../utils/multipartUpload';
import { calculateLikeCount } from '../utils/gameUtils';
// import { processImage } from '../services/file.service';

import { GameProposal, GameProposalStatus, GameProposalType } from '../entities/GameProposal';

const gameRepository = AppDataSource.getRepository(Game);
const gamePositionHistoryRepository =
  AppDataSource.getRepository(GamePositionHistory);
const categoryRepository = AppDataSource.getRepository(Category);
const fileRepository = AppDataSource.getRepository(File);
const gameLikeRepository = AppDataSource.getRepository(GameLike);
const gameProposalRepository = AppDataSource.getRepository(GameProposal);

// Helper function to get the maximum position
const getMaxPosition = async (): Promise<number> => {
  const result = await gameRepository
    .createQueryBuilder('game')
    .select('MAX(game.position)', 'maxPosition')
    .getRawOne();

  return result?.maxPosition || 0;
};

// Helper function to create or update position history record
const createOrUpdatePositionHistoryRecord = async (
  gameId: string,
  position: number,
  queryRunner?: any
): Promise<void> => {
  const repository = queryRunner
    ? queryRunner.manager.getRepository(GamePositionHistory)
    : gamePositionHistoryRepository;

  // Check if record already exists for this game and position
  let historyRecord = await repository.findOne({
    where: { gameId, position },
  });

  if (!historyRecord) {
    // Create new record if it doesn't exist
    historyRecord = repository.create({
      gameId,
      position,
      clickCount: 0,
    });
    await repository.save(historyRecord);
  }
};

// Helper function to get the default category ID
const getDefaultCategoryId = async (queryRunner?: any): Promise<string> => {
  const repository = queryRunner
    ? queryRunner.manager.getRepository(Category)
    : categoryRepository;

  const defaultCategory = await repository.findOne({
    where: { isDefault: true },
  });

  if (!defaultCategory) {
    throw new ApiError(
      500,
      'Default category not found. Please ensure the "General" category exists.'
    );
  }

  return defaultCategory.id;
};

const assignPositionForNewGame = async (
  requestedPosition?: number,
  queryRunner?: any
): Promise<number> => {
  const repository = queryRunner
    ? queryRunner.manager.getRepository(Game)
    : gameRepository;

  if (requestedPosition) {
    const totalGames = await repository.count();
    if (requestedPosition > totalGames + 1) {
      throw new ApiError(
        400,
        `Position cannot be greater than ${totalGames + 1}`
      );
    }

    const existingGame = await repository.findOne({
      where: { position: requestedPosition },
    });

    if (existingGame) {
      const maxPosition = await getMaxPosition();
      existingGame.position = maxPosition + 1;
      await repository.save(existingGame);

      // Create or update position history for existing game at new position
      await createOrUpdatePositionHistoryRecord(
        existingGame.id,
        maxPosition + 1,
        queryRunner
      );
    }

    return requestedPosition;
  } else {
    // Auto-assign to next available position
    const maxPosition = await getMaxPosition();
    return maxPosition + 1;
  }
};



/**
 * @swagger
 * /games:
 *   get:
 *     summary: Get all games
 *     description: Retrieve a list of all games with pagination and filtering options. Accessible by admins.
 *     tags: [Games]
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
 *         name: categoryId
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by category ID
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, disabled]
 *         description: Filter by game status
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search term for game title or description
 *       - in: query
 *         name: createdById
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by creator ID
 *     responses:
 *       200:
 *         description: A list of games
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Internal server error
 */
export const getAllGames = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { categoryId, status, search, createdById, filter } = req.query;

    // Get pagination from middleware (with enforced limits)
    const pageNumber = req.pagination?.page || 1;
    const limitNumber = req.pagination?.limit || 20;

    // Try cache for standard list queries (not special filters)
    if (!filter && cacheService.isEnabled()) {
      const filterKey = [status, categoryId, search, createdById]
        .filter(Boolean)
        .join(':');
      const cached = await cacheService.getGamesList(
        pageNumber,
        limitNumber,
        filterKey
      );

      if (cached) {
        logger.debug(`Cache hit for games list page ${pageNumber}`);
        res.status(200).json(cached);
        return;
      }
    }

    let queryBuilder = gameRepository
      .createQueryBuilder('game')
      .leftJoinAndSelect('game.category', 'category')
      .leftJoinAndSelect('game.thumbnailFile', 'thumbnailFile')
      .leftJoinAndSelect('game.gameFile', 'gameFile')
      .leftJoinAndSelect('game.createdBy', 'createdBy');

    // Handle special filters
    // Flag to control ordering - recently_added uses createdAt DESC only
    let orderByRecent = false;

    if (filter === 'recently_added') {
      // Set flag to order by creation date instead of position
      orderByRecent = true;
      // Apply active status filter for recently_added
      queryBuilder.andWhere('game.status = :status', { status: GameStatus.ACTIVE });
    } else if (filter === 'popular') {
      // SWR Pattern: Try fresh cache first (5 min TTL)
      const cacheKey = 'filter:popular';
      const cached = await cacheService.getGamesList(1, 20, cacheKey);
      if (cached) {
        logger.debug('[SWR] Fresh cache hit for popular filter');
        res.status(200).json(cached);
        return;
      }

      // SWR Pattern: Try stale cache (30 min TTL)
      const staleCacheKey = 'filter:popular:stale';
      const staleCached = await cacheService.getGamesList(1, 20, staleCacheKey);
      if (staleCached) {
        logger.debug('[SWR] Stale cache hit for popular filter - serving stale + queuing refresh');
        
        // Return stale data immediately (no blocking)
        res.status(200).json(staleCached);
        
        // Queue background refresh job (non-blocking)
        queueService.addCacheRefreshJob({
          cacheKey: 'filter:popular',
          cacheType: 'games'
        }).catch(error => {
          logger.error('[SWR] Failed to queue cache refresh job:', error);
        });
        
        return;
      }

      // Cold start: Both caches empty, run expensive query
      logger.debug('[SWR] Both caches empty for popular filter - running expensive query');

      const systemConfigRepository = AppDataSource.getRepository(SystemConfig);
      const popularConfig = await systemConfigRepository.findOne({
        where: { key: 'popular_games_settings' },
      });

      if (popularConfig?.value?.mode === 'manual') {
        let gameIds: string[] = [];
        if (popularConfig.value.selectedGameIds) {
          if (Array.isArray(popularConfig.value.selectedGameIds)) {
            gameIds = popularConfig.value.selectedGameIds;
          } else if (typeof popularConfig.value.selectedGameIds === 'object') {
            gameIds = Object.values(popularConfig.value.selectedGameIds);
          }
        }

        // If manual mode is selected, always return the selected games (even if empty)
        if (gameIds.length > 0) {
          const games = await gameRepository.find({
            where: {
              id: In(gameIds),
              status: GameStatus.ACTIVE,
            },
            relations: ['category', 'thumbnailFile', 'gameFile', 'createdBy'],
            order: { position: 'ASC' }, // Order by position
          });

          // For manual mode, show ALL selected games (no limit applied)
          const orderedGames = gameIds
            .map((id: string) => games.find((game) => game.id === id))
            .filter(
              (game: Game | undefined): game is Game => game !== undefined
            );

          orderedGames.forEach((game: Game) => {
            if (game.gameFile) {
              const s3Key = game.gameFile.s3Key;
              game.gameFile.s3Key = storageService.getPublicUrl(s3Key);
            }
            if (game.thumbnailFile) {
              const s3Key = game.thumbnailFile.s3Key;
              game.thumbnailFile.s3Key = storageService.getPublicUrl(s3Key);
            }
          });

          const responseData = { data: orderedGames };

          // Cache for 5 minutes (300s) - manual selection changes infrequently
          await cacheService.setGamesList(1, 20, responseData, cacheKey, 300);
          logger.debug('Cached popular filter (manual mode)');

          res.status(200).json(responseData);
          return;
        } else {
          // Manual mode with no games selected - return empty array
          const responseData = { data: [] };
          await cacheService.setGamesList(1, 20, responseData, cacheKey, 300);
          res.status(200).json(responseData);
          return;
        }
      } else {
        // Auto mode: order by number of game sessions in the last 30 days (highest first)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        // Step 1: Get Game IDs and Counts efficiently using raw query
        // This avoids "must appear in GROUP BY" errors with getMany/leftJoinAndSelect
        const popularityQuery = gameRepository
          .createQueryBuilder('game')
          .select('game.id', 'id')
          .addSelect('COUNT(a.id)', 'session_count')
          .leftJoin(Analytics, 'a', 'a.gameId = game.id')
          .leftJoin('a.user', 'user')
          .leftJoin('user.role', 'role')
          .where('game.status = :status', { status: GameStatus.ACTIVE })
          .andWhere(
            '(a.createdAt >= :startDate OR a.createdAt IS NULL)',
            { startDate: thirtyDaysAgo }
          )
          // Exclude admin activity (only include players and anonymous users)
          .andWhere("(role.name = 'player' OR a.userId IS NULL OR a.id IS NULL)")
          .groupBy('game.id')
          .orderBy('session_count', 'DESC');

        // Apply filters to the COUNT query too (search/category)
        if (categoryId) {
          popularityQuery.andWhere('game.categoryId = :categoryId', { categoryId });
        }
        if (createdById) {
          popularityQuery.andWhere('game.createdById = :createdById', { createdById });
        }
        if (search) {
          popularityQuery.andWhere(
            '(game.title ILIKE :search OR game.description ILIKE :search)',
            { search: `%${search}%` }
          );
        }

        const total = await popularityQuery.getCount();
        const rawResults = await popularityQuery
          .offset((pageNumber - 1) * limitNumber)
          .limit(limitNumber)
          .getRawMany();

        const gameIds = rawResults.map(r => r.id);

        // Step 2: Fetch full game entities
        let games: Game[] = [];
        if (gameIds.length > 0) {
            games = await gameRepository.find({
                where: { id: In(gameIds) },
                relations: ['category', 'thumbnailFile', 'gameFile', 'createdBy'],
            });

            // Step 3: Sort games in memory to match the popularity order
            games.sort((a, b) => {
                const indexA = gameIds.indexOf(a.id);
                const indexB = gameIds.indexOf(b.id);
                return indexA - indexB;
            });
        }

        // Transform URLs
        games.forEach((game) => {
          if (game.gameFile) {
            game.gameFile.s3Key = storageService.getPublicUrl(game.gameFile.s3Key);
          }
          if (game.thumbnailFile) {
            game.thumbnailFile.s3Key = storageService.getPublicUrl(game.thumbnailFile.s3Key);
          }
        });

        const totalPages = Math.ceil(total / limitNumber);
        const responseData = {
          data: games,
          pagination: {
            page: pageNumber,
            limit: limitNumber,
            total,
            totalPages,
          },
        };

        // Cache result
        if (cacheService.isEnabled()) {
            await cacheService.setGamesList(
                pageNumber,
                limitNumber,
                responseData,
                'filter:popular'
            );
        }

        res.status(200).json(responseData);
        return;
      }
    } else if (filter === 'recommended' && req.user?.userId) {
      const userTopCategory = await AppDataSource.getRepository(Analytics)
        .createQueryBuilder('analytics')
        .select('g.categoryId', 'categoryId')
        .innerJoin('games', 'g', 'analytics.gameId = g.id')
        .where('analytics.userId = :userId', { userId: req.user.userId })
        .groupBy('g.categoryId')
        .orderBy('SUM(analytics.duration)', 'DESC')
        .limit(1)
        .getRawOne();

      if (!userTopCategory) {
        queryBuilder = gameRepository
          .createQueryBuilder('game')
          .leftJoinAndSelect('game.category', 'category')
          .leftJoinAndSelect('game.thumbnailFile', 'thumbnailFile')
          .leftJoinAndSelect('game.gameFile', 'gameFile')
          .leftJoinAndSelect('game.createdBy', 'createdBy')
          .leftJoin(Analytics, 'a', 'a.gameId = game.id')
          .leftJoin('a.user', 'user')
          .leftJoin('user.role', 'role')
          .addSelect([
            'COUNT(DISTINCT a.userId) as playerCount',
            'SUM(a.duration) as totalPlayTime',
            'COUNT(a.id) as sessionCount',
          ])
          .andWhere("(role.name = 'player' OR a.userId IS NULL OR a.id IS NULL)")
          .groupBy('game.id')
          .addGroupBy('category.id')
          .addGroupBy('thumbnailFile.id')
          .addGroupBy('gameFile.id')
          .addGroupBy('createdBy.id')
          .orderBy('playerCount', 'DESC')
          .addOrderBy('totalPlayTime', 'DESC')
          .addOrderBy('sessionCount', 'DESC');
      } else {
        const playedGameIds = await AppDataSource.getRepository(Analytics)
          .createQueryBuilder('analytics')
          .select('analytics.gameId', 'gameId')
          .where('analytics.userId = :userId', { userId: req.user.userId })
          .andWhere('analytics.gameId IS NOT NULL')
          .groupBy('analytics.gameId')
          .getRawMany();

        const playedIds = playedGameIds
          .map((item) => item.gameId)
          .filter((id) => id !== null && id !== undefined);
        const totalLimit = limitNumber || 20;
        const sameCategoryLimit = Math.ceil(totalLimit * 0.6);

        // Get games from user's preferred category
        let sameCategoryQuery = gameRepository
          .createQueryBuilder('game')
          .leftJoinAndSelect('game.category', 'category')
          .leftJoinAndSelect('game.thumbnailFile', 'thumbnailFile')
          .leftJoinAndSelect('game.gameFile', 'gameFile')
          .leftJoinAndSelect('game.createdBy', 'createdBy')
          .where('game.categoryId = :topCategoryId', {
            topCategoryId: userTopCategory.categoryId,
          })
          .andWhere('game.status = :status', { status: 'active' });

        if (playedIds.length > 0) {
          sameCategoryQuery.andWhere('game.id NOT IN (:...playedIds)', {
            playedIds,
          });
        }

        const sameCategoryGames = await sameCategoryQuery
          .orderBy('game.createdAt', 'DESC')
          .take(sameCategoryLimit)
          .getMany();

        // Calculate remaining slots
        const remainingSlots = totalLimit - sameCategoryGames.length;

        // Get games from other categories if we need more
        let otherCategoryGames: Game[] = [];
        if (remainingSlots > 0) {
          let otherCategoryQuery = gameRepository
            .createQueryBuilder('game')
            .leftJoinAndSelect('game.category', 'category')
            .leftJoinAndSelect('game.thumbnailFile', 'thumbnailFile')
            .leftJoinAndSelect('game.gameFile', 'gameFile')
            .leftJoinAndSelect('game.createdBy', 'createdBy')
            .where('game.categoryId != :topCategoryId', {
              topCategoryId: userTopCategory.categoryId,
            })
            .andWhere('game.status = :status', { status: 'active' });

          if (playedIds.length > 0) {
            otherCategoryQuery.andWhere('game.id NOT IN (:...playedIds)', {
              playedIds,
            });
          }

          otherCategoryGames = await otherCategoryQuery
            .take(remainingSlots)
            .getMany();
        }

        // Combine and shuffle the results
        const allRecommendations = [
          ...sameCategoryGames,
          ...otherCategoryGames,
        ];

        for (let i = allRecommendations.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [allRecommendations[i], allRecommendations[j]] = [
            allRecommendations[j],
            allRecommendations[i],
          ];
        }

        // Override the main query with our custom results
        const games = allRecommendations.slice(0, totalLimit);

        // Transform URLs and return early
        games.forEach((game) => {
          if (game.gameFile) {
            const s3Key = game.gameFile.s3Key;
            game.gameFile.s3Key = storageService.getPublicUrl(s3Key);
          }
          if (game.thumbnailFile) {
            const s3Key = game.thumbnailFile.s3Key;
            game.thumbnailFile.s3Key = storageService.getPublicUrl(s3Key);
          }
        });

        res.status(200).json({
          data: games,
        });
        return;
      }
    }

    // Apply standard filters
    if (categoryId) {
      queryBuilder.andWhere('game.categoryId = :categoryId', { categoryId });
    }

    if (status) {
      queryBuilder.andWhere('game.status = :status', { status });
    }

    if (createdById) {
      queryBuilder.andWhere('game.createdById = :createdById', { createdById });
    }

    if (search) {
      queryBuilder.andWhere(
        '(game.title ILIKE :search OR game.description ILIKE :search)',
        { search: `%${search}%` }
      );
    }

    // Apply ordering BEFORE pagination (critical for correct sorting)
    if (orderByRecent) {
      // For recently_added filter, order only by creation date (newest first)
      queryBuilder.orderBy('game.createdAt', 'DESC');
    } else if (filter === 'popular') {
      // Popular filter already specifies ordering in the query builder setup above
      // Do nothing here to preserve that ordering
    } else {
      // Default: order by position first, then by creation date
      queryBuilder
        .orderBy('game.position', 'ASC')
        .addOrderBy('game.createdAt', 'DESC');
    }

    // Get total count for pagination (after ordering is applied)
    const total = await queryBuilder.getCount();

    // Apply pagination (middleware ensures limitNumber is always set)
    queryBuilder.skip((pageNumber - 1) * limitNumber).take(limitNumber);

    const games = await queryBuilder.getMany();

    // Transform game file and thumbnail URLs to direct storage URLs
    games.forEach((game) => {
      if (game.gameFile) {
        const s3Key = game.gameFile.s3Key;
        game.gameFile.s3Key = storageService.getPublicUrl(s3Key);
      }
      if (game.thumbnailFile) {
        const s3Key = game.thumbnailFile.s3Key;
        game.thumbnailFile.s3Key = storageService.getPublicUrl(s3Key);
      }
    });

    const totalPages = Math.ceil(total / limitNumber);

    const responseData = {
      data: games,
      pagination: {
        page: pageNumber,
        limit: limitNumber,
        total,
        totalPages,
      },
    };

    // Cache the response for standard queries (not special filters)
    if (!filter && cacheService.isEnabled()) {
      const filterKey = [status, categoryId, search, createdById]
        .filter(Boolean)
        .join(':');
      await cacheService.setGamesList(
        pageNumber,
        limitNumber,
        responseData,
        filterKey
      );
      logger.debug(`Cached games list page ${pageNumber}`);
    }

    res.status(200).json(responseData);
  } catch (error) {
    next(error);
  }
};

/**
 * @swagger
 * /games/{id}:
 *   get:
 *     summary: Get game by ID
 *     description: Retrieve a single game by its ID with related entities and similar games. Accessible by admins.
 *     tags: [Games]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID of the game to retrieve
 *     responses:
 *       200:
 *         description: Game found with similar games
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     title:
 *                       type: string
 *                     description:
 *                       type: string
 *                     category:
 *                       type: object
 *                     thumbnailFile:
 *                       type: object
 *                     gameFile:
 *                       type: object
 *                     createdBy:
 *                       type: object
 *                     similarGames:
 *                       type: array
 *                       description: Up to 5 similar games from the same category
 *                       items:
 *                         type: object
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Game not found
 *       500:
 *         description: Internal server error
 */
export const getGameById = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;

    // Try cache first
    const cached = await cacheService.getGameById(id);
    if (cached) {
      logger.debug(`Cache hit for game ${id}`);
      void res.status(200).json({
        success: true,
        data: cached,
      });
      return;
    }

    // Check if identifier is a UUID or slug
    const isUUID =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id
      );

    // Get the requested game with its relations
    const game = await gameRepository.findOne({
      where: isUUID ? { id } : { slug: id },
      relations: ['category', 'thumbnailFile', 'gameFile', 'createdBy'],
    });



    if (!game) {
      return next(
        ApiError.notFound(`Game with ${isUUID ? 'id' : 'slug'} ${id} not found`)
      );
    }

    // Transform game file and thumbnail URLs to direct storage URLs
    if (game.gameFile) {
      const s3Key = game.gameFile.s3Key;
      game.gameFile.s3Key = storageService.getPublicUrl(s3Key);
    }
    if (game.thumbnailFile) {
      const s3Key = game.thumbnailFile.s3Key;
      game.thumbnailFile.s3Key = storageService.getPublicUrl(s3Key);
    }

    // Find recommended games (2 from same category + 3 from different categories)
    let recommendedGames: Game[] = [];

    if (game.categoryId) {
      // Get 2 random games from the same category
      // Using subquery to avoid DISTINCT + ORDER BY RANDOM() conflict
      const sameCategoryGames = await gameRepository
        .createQueryBuilder('game')
        .leftJoinAndSelect('game.thumbnailFile', 'thumbnailFile')
        .leftJoinAndSelect('game.gameFile', 'gameFile')
        .where('game.categoryId = :categoryId', { categoryId: game.categoryId })
        .andWhere('game.id != :gameId', { gameId: game.id })
        .andWhere('game.status = :status', { status: GameStatus.ACTIVE })
        .orderBy('game.createdAt', 'DESC') // Use deterministic ordering
        .take(10) // Get more than needed
        .getMany();

      // Shuffle and take 2 (Fisher-Yates shuffle)
      const shuffledSame = sameCategoryGames.sort(() => Math.random() - 0.5).slice(0, 2);

      // Get 3 random games from different categories
      const differentCategoryGames = await gameRepository
        .createQueryBuilder('game')
        .leftJoinAndSelect('game.thumbnailFile', 'thumbnailFile')
        .leftJoinAndSelect('game.gameFile', 'gameFile')
        .where('game.categoryId != :categoryId', { categoryId: game.categoryId })
        .andWhere('game.id != :gameId', { gameId: game.id })
        .andWhere('game.status = :status', { status: GameStatus.ACTIVE })
        .orderBy('game.createdAt', 'DESC') // Use deterministic ordering
        .take(15) // Get more than needed
        .getMany();

      // Shuffle and take 3
      const shuffledDifferent = differentCategoryGames.sort(() => Math.random() - 0.5).slice(0, 3);

      // Combine the results
      recommendedGames = [...shuffledSame, ...shuffledDifferent];

      // Transform recommended games' file and thumbnail URLs to direct storage URLs
      recommendedGames.forEach((recommendedGame) => {
        if (recommendedGame.gameFile) {
          const s3Key = recommendedGame.gameFile.s3Key;
          recommendedGame.gameFile.s3Key = storageService.getPublicUrl(s3Key);
        }
        if (recommendedGame.thumbnailFile) {
          const s3Key = recommendedGame.thumbnailFile.s3Key;
          recommendedGame.thumbnailFile.s3Key = storageService.getPublicUrl(s3Key);
        }
      });
    }

    // Calculate game statistics from Analytics table (excluding admin plays)
    const analyticsRepository = AppDataSource.getRepository(Analytics);
    const statsQuery = analyticsRepository
      .createQueryBuilder('analytics')
      .leftJoin('analytics.user', 'user')
      .leftJoin('user.role', 'role')
      .where('analytics.gameId = :gameId', { gameId: game.id })
      .andWhere("(role.name = 'player' OR analytics.userId IS NULL)"); // Exclude admin plays

    const [totalSessions, uniquePlayersResult, avgDurationResult] = await Promise.all([
      // Total sessions count
      statsQuery.getCount(),

      // Unique players count - use database column names (user_id, session_id)
      statsQuery
        .select('COUNT(DISTINCT COALESCE(analytics.user_id::text, analytics.session_id))', 'count')
        .getRawOne(),

      // Average session duration (in seconds)
      statsQuery
        .select('AVG(analytics.duration)', 'avgDuration')
        .getRawOne(),
    ]);

    const statistics = {
      totalSessions,
      uniquePlayers: parseInt(uniquePlayersResult?.count || '0', 10),
      averageSessionDuration: Math.round(parseFloat(avgDurationResult?.avgDuration || '0')),
    };

    // Get cached like count (avoid CPU-intensive calculation)
    const gameLikeCacheRepository = AppDataSource.getRepository(GameLikeCache);
    let likeCount = 0;
    const cacheEntry = await gameLikeCacheRepository.findOne({
      where: { gameId: game.id },
    });

    if (cacheEntry) {
      likeCount = cacheEntry.cachedLikeCount;
    } else {
      // Fallback to calculation if no cache (shouldn't happen after cron runs)
      const userLikesCount = await gameLikeRepository.count({
        where: { gameId: game.id },
      });
      likeCount = calculateLikeCount(game, userLikesCount);
    }

    // Check if current user has liked this game (if authenticated)
    let hasLiked = false;
    if (req.user?.userId) {
      // Check Redis first (fast), fallback to DB
      hasLiked = await redisService.hasUserLikedGame(req.user.userId, game.id);
    }

    // Prepare response data
    const responseData = {
      ...game,
      likeCount,
      hasLiked,
      statistics,
      recommendedGames,
    };

    // Cache the response for future requests
    await cacheService.setGameById(id, responseData);

    res.status(200).json({
      success: true,
      data: responseData,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @swagger
 * /games:
 *   post:
 *     summary: Create a new game
 *     description: Create a new game with file uploads. Accessible by admins.
 *     tags: [Games]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - thumbnailFile
 *               - gameFile
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               thumbnailFile:
 *                 type: string
 *                 format: binary
 *                 description: Thumbnail image file
 *               gameFile:
 *                 type: string
 *                 format: binary
 *                 description: Game file (HTML, ZIP, etc.)
 *               categoryId:
 *                 type: string
 *                 format: uuid
 *               status:
 *                 type: string
 *                 enum: [active, disabled]
 *               config:
 *                 type: integer
 *               position:
 *                 type: integer
 *                 minimum: 1
 *                 description: Position for the game (optional, auto-assigned if not provided)
 *     responses:
 *       201:
 *         description: Game created successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Internal server error
 */
// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Infinity, // No size limit for game files
  },
});

// Middleware to handle file uploads
export const uploadGameFiles = upload.fields([
  { name: 'thumbnailFile', maxCount: 1 },
  { name: 'gameFile', maxCount: 1 },
]);

// Middleware to handle file uploads for updates
export const uploadGameFilesForUpdate = upload.fields([
  { name: 'thumbnailFile', maxCount: 1 },
  { name: 'gameFile', maxCount: 1 },
]);

export const createGame = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const requestStartTime = Date.now();
  // Start a transaction
  const queryRunner = AppDataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const {
      title,
      description,
      categoryId,
      status = GameStatus.ACTIVE,
      config = 0,
      position,
      thumbnailFileKey: rawThumbnailFileKey,
      gameFileKey: rawGameFileKey,
      metadata, // Destructure metadata
    } = req.body;

    // Decode HTML entities in file keys
    const thumbnailFileKey = rawThumbnailFileKey?.replace(/&#x2F;/g, '/');
    const gameFileKey = rawGameFileKey?.replace(/&#x2F;/g, '/');

    if (!title) {
      return next(ApiError.badRequest('Game title is required'));
    }

    if (!thumbnailFileKey || !gameFileKey) {
      return next(
        ApiError.badRequest('Thumbnail and game file keys are required')
      );
    }

    if (position) {
      const requestedPosition = parseInt(position);
      if (requestedPosition < 1) {
        return next(ApiError.badRequest('Position must be a positive integer'));
      }
      const totalGames = await gameRepository.count();
      if (requestedPosition > totalGames + 1) {
        return next(
          ApiError.badRequest(
            `Position cannot be greater than ${
              totalGames + 1
            } (total number of games)`
          )
        );
      }
    }

    // Determine the final categoryId to use
    let finalCategoryId = categoryId;

    if (categoryId) {
      // Check if provided category exists
      const category = await queryRunner.manager.findOne(Category, {
        where: { id: categoryId },
      });

      if (!category) {
        throw new ApiError(400, `Category with id ${categoryId} not found`);
      }
    } else {
      // Auto-assign default "General" category if no category provided
      finalCategoryId = await getDefaultCategoryId(queryRunner);
    }

    // Move thumbnail to permanent storage using utility function (synchronous)
    logger.info('Moving thumbnail to permanent storage...');
    const thumbnailStartTime = performance.now();
    const permanentThumbnailKey = await moveFileToPermanentStorage(
      thumbnailFileKey,
      'thumbnails'
    );
    const thumbnailEndTime = performance.now();
    const thumbnailDuration = thumbnailEndTime - thumbnailStartTime;
    logger.info(`✅ [THUMBNAIL TIMING] Thumbnail processing completed`, {
      gameId: title, // Using title as gameId not created yet
      durationMs: thumbnailDuration.toFixed(2),
      durationSec: (thumbnailDuration / 1000).toFixed(2),
      sourceKey: thumbnailFileKey,
      destinationKey: permanentThumbnailKey,
    });
    console.log(
      `⏱️ [THUMBNAIL TIMING] Completed in ${(thumbnailDuration / 1000).toFixed(
        2
      )}s`
    );

    // Create thumbnail file record in the database using transaction
    logger.info('Creating thumbnail file record in the database...');
    const thumbnailFileRecord = fileRepository.create({
      s3Key: permanentThumbnailKey,
      type: 'thumbnail',
    });

    await queryRunner.manager.save(thumbnailFileRecord);

    // [EDITOR FLOW] Intercept and create proposal instead of Game
    if (req.user?.role === RoleType.EDITOR) {
      logger.info('Editor user detected, creating Game Proposal...');

      // Handle Game File Persistence (Move key to permanent storage to ensure it persists until approval)
      let permanentGameFileKey = gameFileKey;
      if (gameFileKey) {
        // Move to a 'proposals' folder or similar to keep it safe
        permanentGameFileKey = await moveFileToPermanentStorage(
          gameFileKey,
          'proposals/game-files'
        );
      }

      const proposal = gameProposalRepository.create({
        type: GameProposalType.CREATE,
        editorId: req.user.userId,
        status: GameProposalStatus.PENDING,
        proposedData: {
          title,
          description,
          categoryId: finalCategoryId,
          status: GameStatus.DISABLED, // Default for new proposals
          config,
          position, // Pass requested position, Admin/System will reconcile on approve
          thumbnailFileId: thumbnailFileRecord.id,
          gameFileKey: permanentGameFileKey,
          metadata: metadata || undefined,
        }
      });

      await queryRunner.manager.save(proposal);
      await queryRunner.commitTransaction();

      // We still queue the thumbnail image processing since the file record exists
       await queueService.addImageProcessingJob({
        fileId: thumbnailFileRecord.id,
        s3Key: permanentThumbnailKey,
      });

      res.status(200).json({
        success: true,
        message: 'Game creation submitted for review',
        data: proposal
      });
      return;
    }

    // Assign position for the new game
    logger.info('Assigning position for new game...');
    const assignedPosition = await assignPositionForNewGame(
      position ? parseInt(position) : undefined,
      queryRunner
    );

    // Generate unique slug from title
    logger.info('Generating unique slug from title...');
    const slug = await generateUniqueSlug(title);

    // Create new game with thumbnail file ID already set (since we processed it synchronously)
    logger.info('Creating game record with thumbnail file ID...');
    const game = gameRepository.create({
      title,
      slug,
      description,
      thumbnailFileId: thumbnailFileRecord.id, // ✅ Set immediately since we already processed it
      gameFileId: undefined, // Will be set by background worker
      categoryId: finalCategoryId,
      status: GameStatus.DISABLED, // Always start as disabled until processing completes
      config,
      position: assignedPosition,
      processingStatus: GameProcessingStatus.PENDING,
      createdById: req.user?.userId,
      metadata: metadata || undefined,
    });

    await queryRunner.manager.save(game);

    // Create initial position history record
    logger.info('Creating initial position history record...');
    await createOrUpdatePositionHistoryRecord(
      game.id,
      assignedPosition,
      queryRunner
    );

    // ❌ REMOVED: Thumbnail processing job (thumbnail already processed synchronously above)
    // The thumbnail was already moved and file record created, no need for background job

    // Queue image processing job for variant generation
    logger.info(`🖼️  Queuing image processing job for thumbnail`);
    await queueService.addImageProcessingJob({
      fileId: thumbnailFileRecord.id,
      s3Key: permanentThumbnailKey,
    });

    // ============================================================================
    // ZIP PROCESSING - Feature Flag (Cloudflare Worker vs Local BullMQ)
    // ============================================================================
    const useCloudflareWorker = process.env.ZIP_PROCESSING_MODE === 'cloudflare';

    if (useCloudflareWorker) {
      // ============================================================================
      // [NEW] Cloudflare Worker handles ZIP processing automatically
      // R2 event notification triggers worker when ZIP is uploaded to temp-games/
      // Worker will send webhook to /api/internal/game-processed when complete
      // ============================================================================
      
      // Store the temp file path in metadata so webhook can find it
      game.metadata = {
        ...game.metadata,
        _tempGameFileKey: gameFileKey,
        _uploadedAt: new Date().toISOString(),
      } as any; // Casting to any since metadata is JSONB and can store arbitrary fields
      await queryRunner.manager.save(game);
      
      logger.info('[CLOUDFLARE WORKER] ZIP will be processed by edge worker', {
        gameId: game.id,
        gameFileKey,
      });
      console.log('☁️  [CLOUDFLARE WORKER] Queued for edge processing:', {
        gameId: game.id,
        gameFileKey,
      });
      
      // No job ID needed - worker processes automatically
      // Game will be activated via webhook when processing completes
    } else {
      // ============================================================================
      // [LEGACY] Local BullMQ Worker - Original system (kept for rollback)
      // Can be re-enabled by setting ZIP_PROCESSING_MODE=local in .env
      // ============================================================================
      logger.info('[LOCAL WORKER] Queuing background job for ZIP processing...');
      console.log('🚀 [CREATE GAME] Queuing job for game:', {
        gameId: game.id,
        title,
        gameFileKey,
      });

      const job = await queueService.addGameZipProcessingJob({
        gameId: game.id,
        gameFileKey,
        userId: req.user?.userId,
      });

      // Update game with job ID
      game.jobId = job.id as string;
      await queryRunner.manager.save(game);

      console.log('✅ [CREATE GAME] Job queued successfully:', {
        gameId: game.id,
        jobId: job.id,
      });
    }

    // Note: Cleanup of temporary files will be handled by background workers

    // Commit transaction
    await queryRunner.commitTransaction();

    // Fetch the game with relations to return
    const savedGame = await gameRepository.findOne({
      where: { id: game.id },
      relations: ['category', 'thumbnailFile', 'gameFile', 'createdBy'],
    });

    if (!savedGame) {
      return next(ApiError.notFound(`Game with id ${game.id} not found`));
    }

    // Transform game file and thumbnail URLs to direct storage URLs
    if (savedGame.gameFile) {
      const s3Key = savedGame.gameFile.s3Key;
      savedGame.gameFile.s3Key = storageService.getPublicUrl(s3Key);
    }
    if (savedGame.thumbnailFile) {
      const s3Key = savedGame.thumbnailFile.s3Key;
      savedGame.thumbnailFile.s3Key = storageService.getPublicUrl(s3Key);
    }

    // Invalidate caches after game creation
    await cacheInvalidationService.invalidateGameCreation(
      savedGame.id,
      savedGame.categoryId
    );

    const apiResponseTime = Date.now() - requestStartTime;
    logger.info(
      `[PERF] Game creation API completed in ${apiResponseTime}ms - Game ID: ${game.id}, Title: "${title}"`
    );

    res.status(201).json({
      success: true,
      data: savedGame,
      _performance: {
        apiResponseTime: `${apiResponseTime}ms`,
        note: 'Background processing (thumbnail + ZIP) continues asynchronously',
      },
    });
  } catch (error) {
    // Rollback transaction on error
    await queryRunner.rollbackTransaction();
    next(error);
  } finally {
    // Release query runner
    await queryRunner.release();
  }
};

/**
 * @swagger
 * /games/{id}:
 *   put:
 *     summary: Update a game
 *     description: Update a game by its ID, including file uploads. Accessible by admins.
 *     tags: [Games]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID of the game to update
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               thumbnailFile:
 *                 type: string
 *                 format: binary
 *                 description: New thumbnail image file (optional)
 *               gameFile:
 *                 type: string
 *                 format: binary
 *                 description: New game file (HTML, ZIP, etc.) (optional)
 *               categoryId:
 *                 type: string
 *                 format: uuid
 *               status:
 *                 type: string
 *                 enum: [active, disabled]
 *               config:
 *                 type: integer
 *               position:
 *                 type: integer
 *                 minimum: 1
 *                 description: Position for the game (optional, will swap with existing game if position is occupied)
 *     responses:
 *       200:
 *         description: Game updated successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Game not found
 *       500:
 *         description: Internal server error
 */
export const updateGame = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  // Start a transaction
  const queryRunner = AppDataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const { id } = req.params;
    const {
      title,
      description,
      categoryId,
      status,
      config,
      position,
      thumbnailFileKey: rawThumbnailFileKey,
      gameFileKey: rawGameFileKey,
      metadata, // Add metadata to destructured fields
    } = req.body;

    // Check if user is trying to update status and has permission
    if (status !== undefined) {
      const userRole = req.user?.role;
      if (
        userRole !== RoleType.ADMIN &&
        userRole !== RoleType.SUPERADMIN
      ) {
        return next(
          ApiError.forbidden('Editors cannot change game status. Please contact an Admin.')
        );
      }
    }

    // Decode HTML entities in file keys if provided
    const thumbnailFileKey = rawThumbnailFileKey?.replace(/&#x2F;/g, '/');
    const gameFileKey = rawGameFileKey?.replace(/&#x2F;/g, '/');

    const game = await queryRunner.manager.findOne(Game, {
      where: { id },
    });

    if (!game) {
      return next(ApiError.notFound(`Game with id ${id} not found`));
    }

    // Validate position early if provided (before any expensive operations)
    if (position !== undefined && position !== game.position) {
      const newPosition = parseInt(position);

      if (newPosition < 1) {
        return next(ApiError.badRequest('Position must be a positive integer'));
      }

      // Validate that position doesn't exceed total number of games
      const totalGames = await queryRunner.manager.count(Game);
      if (newPosition > totalGames) {
        return next(
          ApiError.badRequest(
            `Position cannot be greater than ${totalGames} (total number of games)`
          )
        );
      }
    }

    // Handle file uploads if provided (support both old multer and new presigned URL approach)
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };

    // Handle thumbnail file upload - New presigned URL approach
    if (thumbnailFileKey) {
      logger.info(
        `Updating thumbnail from temporary storage: ${thumbnailFileKey}`
      );

      // Move thumbnail to permanent storage using utility function
      const permanentThumbnailKey = await moveFileToPermanentStorage(
        thumbnailFileKey,
        'thumbnails'
      );

      // Create file record
      logger.info('Creating new thumbnail file record...');
      const thumbnailFileRecord = fileRepository.create({
        s3Key: permanentThumbnailKey,
        type: 'thumbnail',
      });

      await queryRunner.manager.save(thumbnailFileRecord);

      // Update game with new file ID
      game.thumbnailFileId = thumbnailFileRecord.id;

      // Trigger background job to generate image variants
      logger.info(
        `🖼️  Queuing image processing job for thumbnail ${thumbnailFileRecord.id}`
      );
      await queueService.addImageProcessingJob({
        fileId: thumbnailFileRecord.id,
        s3Key: permanentThumbnailKey,
      });
    }
    // Handle thumbnail file upload - Old multer approach (for backward compatibility)
    else if (files?.thumbnailFile && files.thumbnailFile[0]) {
      const thumbnailFile = files.thumbnailFile[0];

      // Upload to storage
      logger.info('Uploading new thumbnail file to storage...');
      const thumbnailUploadResult = await storageService.uploadFile(
        thumbnailFile.buffer,
        thumbnailFile.originalname,
        thumbnailFile.mimetype,
        'thumbnails'
      );

      // Create file record
      logger.info('Creating new thumbnail file record...');
      const thumbnailFileRecord = fileRepository.create({
        s3Key: thumbnailUploadResult.key,
        type: 'thumbnail',
      });

      await queryRunner.manager.save(thumbnailFileRecord);

      // Update game with new file ID
      game.thumbnailFileId = thumbnailFileRecord.id;

      // Trigger background job to generate image variants
      logger.info(
        `🖼️  Queuing image processing job for thumbnail ${thumbnailFileRecord.id}`
      );
      await queueService.addImageProcessingJob({
        fileId: thumbnailFileRecord.id,
        s3Key: thumbnailUploadResult.key,
      });
    }

    // [EDITOR FLOW] Intercept and create proposal instead of updating Game
    if (req.user?.role === RoleType.EDITOR) {
       logger.info('Editor user detected, creating Update Proposal...');

       // Handle Game File Persistence if provided
       let permanentGameFileKey = undefined;
       if (gameFileKey) {
          permanentGameFileKey = await moveFileToPermanentStorage(
            gameFileKey,
            'proposals/game-files'
          );
       } else if (files?.gameFile && files.gameFile[0]) {
          // If using multer upload for game file (old way), we're in a bit of a bind since we don't have a key to move.
          // We'd need to upload it. But let's assume Editors use the new flow (Chunk/Presigned) primarily?
          // Or just handle it:
          const gameFile = files.gameFile[0];
          const uploadResult = await storageService.uploadFile(
             gameFile.buffer,
             gameFile.originalname,
             gameFile.mimetype,
             'proposals/game-files'
          );
          permanentGameFileKey = uploadResult.key;
       }

       const proposedData: any = {};
       if (title) proposedData.title = title;
       if (description) proposedData.description = description;
       if (categoryId) proposedData.categoryId = categoryId;
       // Status change blocked for editors earlier, but if it wasn't, we'd capture it.
       if (config) proposedData.config = config;
       if (position !== undefined) proposedData.position = parseInt(position);
       if (metadata) proposedData.metadata = metadata;

       // Capture File Changes
       // Note: game.thumbnailFileId was updated above if a new file was processed.
       // We should include the NEW thumbnailFileId if it changed.
       // How do we know? We can check if `thumbnailFileKey` or `files.thumbnailFile` was present.
       if (thumbnailFileKey || (files?.thumbnailFile && files.thumbnailFile[0])) {
           proposedData.thumbnailFileId = game.thumbnailFileId;
       }

       if (permanentGameFileKey) {
           proposedData.gameFileKey = permanentGameFileKey;
       }

       const proposal = gameProposalRepository.create({
         type: GameProposalType.UPDATE,
         gameId: game.id,
         editorId: req.user.userId,
         status: GameProposalStatus.PENDING,
         proposedData
       });

       await queryRunner.manager.save(proposal);
       await queryRunner.commitTransaction();

       res.status(200).json({
         success: true,
         message: 'Game update submitted for review',
         data: proposal
       });
       return;
    }

    // Handle game file upload - New presigned URL approach
    if (gameFileKey) {
      logger.info(`Updating game file from temporary storage: ${gameFileKey}`);

      // Set game to processing status and disabled until processing completes
      game.processingStatus = GameProcessingStatus.PENDING;
      game.status = GameStatus.DISABLED; // Disable until processing completes
      // processingError will be cleared by worker on successful completion

      // ============================================================================
      // ZIP PROCESSING - Feature Flag (Cloudflare Worker vs Local BullMQ)
      // ============================================================================
      const useCloudflareWorker = process.env.ZIP_PROCESSING_MODE === 'cloudflare';

      if (useCloudflareWorker) {
        // ============================================================================
        // [NEW] Cloudflare Worker handles ZIP processing automatically
        // R2 event notification triggers worker when ZIP is uploaded to temp-games/
        // Worker will send webhook to /api/internal/game-processed when complete
        // ============================================================================
        logger.info('[CLOUDFLARE WORKER] ZIP will be processed by edge worker', {
          gameId: game.id,
          gameFileKey,
        });
        console.log('☁️  [CLOUDFLARE WORKER] Queued for edge processing:', {
          gameId: game.id,
          gameFileKey,
        });
        
        // No job ID needed - worker processes automatically
      } else {
        // ============================================================================
        // [LEGACY] Local BullMQ Worker - Original system (kept for rollback)
        // Can be re-enabled by setting ZIP_PROCESSING_MODE=local in .env
        // ============================================================================
        console.log('🚀 [UPDATE GAME] Queuing job for game:', {
          gameId: game.id,
          gameFileKey,
        });

        const job = await queueService.addGameZipProcessingJob({
          gameId: game.id,
          gameFileKey,
          userId: req.user?.userId,
        });

        // Update game with job ID
        game.jobId = job.id as string;

        console.log('✅ [UPDATE GAME] Job queued successfully:', {
          gameId: game.id,
          jobId: job.id,
        });
      }
    }
    // Handle game file upload - Old multer approach (for backward compatibility)
    else if (files?.gameFile && files.gameFile[0]) {
      const gameFile = files.gameFile[0];

      // Process game zip file first to validate it
      logger.info('Processing game zip file...');
      const processedZip = await zipService.processGameZip(gameFile.buffer);

      if (processedZip.error) {
        throw new ApiError(400, processedZip.error);
      }

      // Generate unique game folder name
      const gameFolderId = uuidv4();

      // Upload game folder to storage
      logger.info('Uploading game folder to storage...');
      const gamePath = `games/${gameFolderId}`;
      await storageService.uploadDirectory(
        processedZip.extractedPath,
        gamePath
      );

      // Create file record for the index.html
      logger.info('Creating new game file record...');
      if (!processedZip.indexPath) {
        throw new ApiError(400, 'No index.html found in the zip file');
      }

      const indexPath = processedZip.indexPath.replace(/\\/g, '/');
      const gameFileRecord = fileRepository.create({
        s3Key: `${gamePath}/${indexPath}`,
        type: 'game_file',
      });

      await queryRunner.manager.save(gameFileRecord);

      // Update game with new file ID
      game.gameFileId = gameFileRecord.id;
    }

    // Handle category update
    if (categoryId !== undefined) {
      if (categoryId && categoryId !== game.categoryId) {
        // User provided a specific category
        const category = await categoryRepository.findOne({
          where: { id: categoryId },
        });

        if (!category) {
          return next(
            ApiError.badRequest(`Category with id ${categoryId} not found`)
          );
        }

        game.categoryId = categoryId;
      } else if (!categoryId && game.categoryId) {
        // User explicitly cleared the category, auto-assign "General"
        const defaultCategoryId = await getDefaultCategoryId(queryRunner);
        game.categoryId = defaultCategoryId;
      }
      // If categoryId is same as current, no change needed
    }
    // If categoryId is undefined (not provided in request), keep existing category

    // Handle position update if provided
    if (position !== undefined && position !== game.position) {
      const newPosition = parseInt(position);
      const currentPosition = game.position;

      // Check if target position is occupied
      const gameAtTargetPosition = await queryRunner.manager.findOne(Game, {
        where: { position: newPosition },
      });

      if (gameAtTargetPosition) {
        // Swap positions: Move the game at target position to the current position
        logger.info(
          `Swapping position for game ${gameAtTargetPosition.id} from ${newPosition} to ${currentPosition}`
        );
        gameAtTargetPosition.position = currentPosition;
        await queryRunner.manager.save(gameAtTargetPosition);

        // Update position history for the swapped game
        await createOrUpdatePositionHistoryRecord(
          gameAtTargetPosition.id,
          currentPosition,
          queryRunner
        );
      }

      // Update the position of the current game
      game.position = newPosition;

      // Update position history for updated game
      await createOrUpdatePositionHistoryRecord(
        game.id,
        newPosition,
        queryRunner
      );
    }

    // Update basic game properties
    if (title && title !== game.title) {
      game.title = title;
      // Regenerate slug if title changed
      game.slug = await generateUniqueSlug(title, game.id);
    }
    if (description !== undefined) game.description = description;
    if (status) game.status = status as GameStatus;
    if (config !== undefined) game.config = config;

    // Update metadata if provided
    if (metadata !== undefined) {
      // Parse metadata if it's a string (common with multipart/form-data)
      const parsedMetadata = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;

      // Ensure tags is always an array (not an object)
      if (parsedMetadata.tags) {
        if (Array.isArray(parsedMetadata.tags)) {
          // Already an array, ensure it's a proper array (not object with numeric keys)
          parsedMetadata.tags = [...parsedMetadata.tags];
        } else if (typeof parsedMetadata.tags === 'object' && parsedMetadata.tags !== null) {
          // Convert object with numeric keys back to array
          parsedMetadata.tags = Object.values(parsedMetadata.tags).filter((v): v is string => typeof v === 'string');
        } else {
          // Invalid format, set to empty array
          parsedMetadata.tags = [];
        }
      }

      // Merge with existing metadata to preserve other fields
      // This will correctly merge faqOverride from the new metadata
      game.metadata = {
        ...game.metadata,
        ...parsedMetadata,
      };
    }

    await queryRunner.manager.save(game);

    // Commit transaction
    await queryRunner.commitTransaction();

    // Fetch the updated game with relations to return
    const updatedGame = await gameRepository.findOne({
      where: { id },
      relations: ['category', 'thumbnailFile', 'gameFile', 'createdBy'],
    });

    if (!updatedGame) {
      return next(ApiError.notFound(`Game with id ${id} not found`));
    }

    // Transform game file and thumbnail URLs to direct storage URLs
    if (updatedGame.gameFile) {
      const s3Key = updatedGame.gameFile.s3Key;
      updatedGame.gameFile.s3Key = storageService.getPublicUrl(s3Key);
    }
    if (updatedGame.thumbnailFile) {
      const s3Key = updatedGame.thumbnailFile.s3Key;
      updatedGame.thumbnailFile.s3Key = storageService.getPublicUrl(s3Key);
    }

    // Invalidate caches after game update
    await cacheInvalidationService.invalidateGameUpdate(
      updatedGame.id,
      updatedGame.categoryId
    );

    res.status(200).json({
      success: true,
      data: updatedGame,
    });
  } catch (error) {
    // Rollback transaction on error
    await queryRunner.rollbackTransaction();
    next(error);
  } finally {
    // Release query runner
    await queryRunner.release();
  }
};

/**
 * @swagger
 * /games/{id}:
 *   delete:
 *     summary: Delete a game
 *     description: Delete a game by its ID. Accessible by admins.
 *     tags: [Games]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID of the game to delete
 *     responses:
 *       200:
 *         description: Game deleted successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Game not found
 *       500:
 *         description: Internal server error
 */
export const deleteGame = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;

    const game = await gameRepository.findOne({
      where: { id },
    });

    if (!game) {
      return next(ApiError.notFound(`Game with id ${id} not found`));
    }

    // Check if user has permission to delete
    // Only super admins can delete games created by other admins
    if (
      req.user?.role === RoleType.ADMIN &&
      game.createdById !== req.user.userId
    ) {
      const createdByAdmin = await gameRepository
        .createQueryBuilder('game')
        .leftJoinAndSelect('game.createdBy', 'user')
        .leftJoinAndSelect('user.role', 'role')
        .where('game.id = :id', { id })
        .andWhere('role.name IN (:...roles)', {
          roles: [RoleType.ADMIN, RoleType.SUPERADMIN],
        })
        .getOne();

      if (createdByAdmin) {
        return next(
          ApiError.forbidden('You do not have permission to delete this game')
        );
      }
    }

    // Delete the game
    await gameRepository.remove(game);

    // Invalidate caches after game deletion
    await cacheInvalidationService.invalidateGameDeletion(id, game.categoryId);

    res.status(200).json({
      success: true,
      message: 'Game deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @swagger
 * /games/position/{position}:
 *   get:
 *     summary: Get game by position
 *     description: Retrieve a game by its position number.
 *     tags: [Games]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: position
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Position number of the game to retrieve
 *     responses:
 *       200:
 *         description: Game found at the specified position
 *       404:
 *         description: No game found at the specified position
 *       400:
 *         description: Invalid position parameter
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
export const getGameByPosition = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { position } = req.params;

    const positionNumber = parseInt(position);

    if (isNaN(positionNumber) || positionNumber < 1) {
      return next(ApiError.badRequest('Position must be a positive integer'));
    }

    // Get the game at the specified position
    const game = await gameRepository.findOne({
      where: { position: positionNumber },
      relations: ['category', 'thumbnailFile', 'gameFile', 'createdBy'],
    });

    if (!game) {
      return next(
        ApiError.notFound(`No game found at position ${positionNumber}`)
      );
    }

    // Transform game file and thumbnail URLs to direct storage URLs
    if (game.gameFile) {
      const s3Key = game.gameFile.s3Key;
      game.gameFile.s3Key = storageService.getPublicUrl(s3Key);
    }
    if (game.thumbnailFile) {
      const s3Key = game.thumbnailFile.s3Key;
      game.thumbnailFile.s3Key = storageService.getPublicUrl(s3Key);
    }

    res.status(200).json({
      success: true,
      data: game,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @swagger
 * /games/presigned-url:
 *   post:
 *     summary: Generate presigned URL for direct file upload
 *     description: Generate a presigned URL for uploading files directly to R2 storage. Accessible by admins.
 *     tags: [Games]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - filename
 *               - fileType
 *             properties:
 *               filename:
 *                 type: string
 *                 description: Name of the file to upload
 *               contentType:
 *                 type: string
 *                 description: MIME type of the file
 *               fileType:
 *                 type: string
 *                 enum: [thumbnail, game]
 *                 description: Type of file being uploaded
 *     responses:
 *       200:
 *         description: Presigned URL generated successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Internal server error
 */
export const generatePresignedUrl = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { filename, contentType, fileType } = req.body;

    if (!filename || !fileType) {
      return next(ApiError.badRequest('Filename and fileType are required'));
    }

    // Validate fileType
    if (!['thumbnail', 'game'].includes(fileType)) {
      return next(
        ApiError.badRequest('FileType must be either "thumbnail" or "game"')
      );
    }

    // Generate unique path
    const timestamp = Date.now();
    const gameId = uuidv4();
    const folder = fileType === 'thumbnail' ? 'temp-thumbnails' : 'temp-games';
    const key = `${folder}/${gameId}-${timestamp}/${filename}`;

    logger.info(`Generating presigned URL for: ${key}`);

    // Generate presigned URL using storage service
    const presignedUrl = await storageService.generatePresignedUrl(
      key,
      contentType
    );
    const publicUrl = storageService.getPublicUrl(key);

    res.status(200).json({
      success: true,
      data: {
        uploadUrl: presignedUrl,
        publicUrl,
        key,
      },
    });
  } catch (error) {
    logger.error('Error generating presigned URL:', error);
    next(error);
  }
};

/**
 * @swagger
 * /games/{id}/processing-status:
 *   get:
 *     summary: Get game processing status
 *     description: Get the current processing status of a game. Accessible by admins.
 *     tags: [Games]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID of the game to check processing status
 *     responses:
 *       200:
 *         description: Processing status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     processingStatus:
 *                       type: string
 *                       enum: [pending, processing, completed, failed]
 *                     processingError:
 *                       type: string
 *                       nullable: true
 *                     jobId:
 *                       type: string
 *                       nullable: true
 *                     jobStatus:
 *                       type: object
 *                       nullable: true
 *                       properties:
 *                         status:
 *                           type: string
 *                         progress:
 *                           type: number
 *                         error:
 *                           type: string
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Game not found
 *       500:
 *         description: Internal server error
 */
export const getGameProcessingStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;

    const game = await gameRepository.findOne({
      where: { id },
      select: ['id', 'processingStatus', 'processingError', 'jobId'],
    });

    if (!game) {
      return next(ApiError.notFound(`Game with id ${id} not found`));
    }

    let jobStatus = null;
    if (game.jobId) {
      try {
        jobStatus = await queueService.getJobStatus(
          game.jobId,
          'game-zip-processing'
        );
      } catch (error) {
        logger.warn(`Failed to get job status for job ${game.jobId}:`, error);
      }
    }

    res.status(200).json({
      success: true,
      data: {
        processingStatus: game.processingStatus,
        processingError: game.processingError,
        jobId: game.jobId,
        jobStatus,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @swagger
 * /games/{id}/retry-processing:
 *   post:
 *     summary: Retry failed game processing
 *     description: Retry processing for a failed game. Accessible by admins.
 *     tags: [Games]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID of the game to retry processing
 *     responses:
 *       200:
 *         description: Processing retry queued successfully
 *       400:
 *         description: Game cannot be retried (not in failed state)
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Game not found
 *       500:
 *         description: Internal server error
 */
export const retryGameProcessing = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;

    const game = await gameRepository.findOne({
      where: { id },
    });

    if (!game) {
      return next(ApiError.notFound(`Game with id ${id} not found`));
    }

    if (game.processingStatus !== GameProcessingStatus.FAILED) {
      return next(
        ApiError.badRequest('Can only retry processing for failed games')
      );
    }

    // For retry, we need the original game file key stored somewhere
    // Since we don't store the original temp key, this would require a new file upload
    // For now, return an error indicating they need to re-upload
    return next(
      ApiError.badRequest(
        'Cannot retry processing. Please re-upload the game file.'
      )
    );

    // If we had stored the original temp key, this would be the implementation:
    /*
    // Reset processing status to pending
    game.processingStatus = GameProcessingStatus.PENDING;
    game.processingError = null;

    // Queue new job
    const job = await queueService.addGameZipProcessingJob({
      gameId: game.id,
      gameFileKey: game.originalGameFileKey, // Would need to be stored
      userId: req.user?.userId
    });

    game.jobId = job.id as string;
    await gameRepository.save(game);

    res.status(200).json({
      success: true,
      message: 'Processing retry queued successfully',
      data: { jobId: job.id }
    });
    */
  } catch (error) {
    next(error);
  }
};

/**
 * @swagger
 * /games/bulk-update-free-time:
 *   post:
 *     summary: Bulk update free time for all games
 *     description: Update the free game time (config field) for all games at once. Accessible by admins.
 *     tags: [Games]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - freeTime
 *             properties:
 *               freeTime:
 *                 type: number
 *                 minimum: 0
 *                 description: Free game time in minutes to apply to all games
 *     responses:
 *       200:
 *         description: Successfully updated all games
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Internal server error
 */
export const bulkUpdateFreeTime = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { freeTime } = req.body;

    if (freeTime === undefined || freeTime === null) {
      return next(ApiError.badRequest('freeTime is required'));
    }

    const freeTimeNumber = parseInt(freeTime);

    if (isNaN(freeTimeNumber) || freeTimeNumber < 0) {
      return next(
        ApiError.badRequest('freeTime must be a non-negative number')
      );
    }

    // Update all games' config field (free time) using query builder
    const result = await gameRepository
      .createQueryBuilder()
      .update(Game)
      .set({ config: freeTimeNumber })
      .execute();

    logger.info(
      `Bulk updated free time to ${freeTimeNumber} minutes for all games. Affected: ${
        result.affected || 0
      } games`
    );

    res.status(200).json({
      success: true,
      message: `Successfully updated free time to ${freeTimeNumber} minutes for all games`,
      data: {
        freeTime: freeTimeNumber,
        gamesUpdated: result.affected || 0,
      },
    });
  } catch (error) {
    logger.error('Error in bulkUpdateFreeTime:', error);
    next(error);
  }
};

/**
 * Like a game (async with Redis)
 */
export const likeGame = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      return next(
        ApiError.unauthorized('You must be logged in to like a game')
      );
    }

    // Check if identifier is UUID or slug
    const isUUID =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id
      );

    // Get game
    const game = await gameRepository.findOne({
      where: isUUID ? { id } : { slug: id },
    });

    if (!game) {
      return next(
        ApiError.notFound(`Game with ${isUUID ? 'id' : 'slug'} ${id} not found`)
      );
    }

    // Update Redis immediately (fast response)
    await redisService.setGameLike(userId, game.id);

    // Queue DB sync job (async)
    await queueService.addLikeProcessingJob({
      userId,
      gameId: game.id,
      action: 'like',
    });

    // Get like count from Redis
    const likeCount = await redisService.getGameLikeCount(game.id);

    res.status(200).json({
      success: true,
      message: 'Game liked successfully',
      data: {
        likeCount,
        hasLiked: true,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Unlike a game (async with Redis)
 */
export const unlikeGame = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      return next(
        ApiError.unauthorized('You must be logged in to unlike a game')
      );
    }

    // Check if identifier is UUID or slug
    const isUUID =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id
      );

    // Get game
    const game = await gameRepository.findOne({
      where: isUUID ? { id } : { slug: id },
    });

    if (!game) {
      return next(
        ApiError.notFound(`Game with ${isUUID ? 'id' : 'slug'} ${id} not found`)
      );
    }

    // Update Redis immediately (fast response)
    await redisService.removeGameLike(userId, game.id);

    // Queue DB sync job (async)
    await queueService.addLikeProcessingJob({
      userId,
      gameId: game.id,
      action: 'unlike',
    });

    // Get like count from Redis
    const likeCount = await redisService.getGameLikeCount(game.id);

    res.status(200).json({
      success: true,
      message: 'Game unliked successfully',
      data: {
        likeCount,
        hasLiked: false,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create a multipart upload
 */
export const createMultipartUpload = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { filename, contentType, fileType } = req.body;

    if (!filename || !fileType) {
      return next(ApiError.badRequest('Filename and fileType are required'));
    }

    // Validate fileType
    if (!['thumbnail', 'game'].includes(fileType)) {
      return next(
        ApiError.badRequest('FileType must be either "thumbnail" or "game"')
      );
    }

    // Generate unique path
    const timestamp = Date.now();
    const gameId = uuidv4();
    const folder = fileType === 'thumbnail' ? 'temp-thumbnails' : 'temp-games';
    const key = `${folder}/${gameId}-${timestamp}/${filename}`;

    logger.info(`Creating multipart upload for: ${key}`);

    const result = await multipartUploadHelpers.createMultipartUpload(
      key,
      contentType || 'application/octet-stream'
    );

    res.status(200).json({
      success: true,
      data: {
        uploadId: result.uploadId,
        key: result.key,
      },
    });
  } catch (error) {
    logger.error('Error creating multipart upload:', error);
    next(error);
  }
};

/**
 * Get presigned URL for uploading a part
 */
export const getMultipartUploadPartUrl = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { key, uploadId, partNumber } = req.body;

    if (!key || !uploadId || !partNumber) {
      return next(
        ApiError.badRequest('Key, uploadId, and partNumber are required')
      );
    }

    const url = await multipartUploadHelpers.getPresignedUrlForPart(
      key,
      uploadId,
      parseInt(partNumber)
    );

    res.status(200).json({
      success: true,
      data: {
        url,
      },
    });
  } catch (error) {
    logger.error('Error getting multipart upload part URL:', error);
    next(error);
  }
};

/**
 * Complete a multipart upload
 */
export const completeMultipartUpload = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { key, uploadId, parts } = req.body;

    if (!key || !uploadId || !parts || !Array.isArray(parts)) {
      return next(
        ApiError.badRequest('Key, uploadId, and parts array are required')
      );
    }

    logger.info(`Completing multipart upload for: ${key}`);

    const result = await multipartUploadHelpers.completeMultipartUpload(
      key,
      uploadId,
      parts
    );

    const publicUrl = storageService.getPublicUrl(key);

    res.status(200).json({
      success: true,
      data: {
        location: result.location,
        key: result.key,
        publicUrl,
      },
    });
  } catch (error) {
    logger.error('Error completing multipart upload:', error);
    next(error);
  }
};

/**
 * Abort a multipart upload
 */
export const abortMultipartUpload = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { key, uploadId } = req.body;

    if (!key || !uploadId) {
      return next(ApiError.badRequest('Key and uploadId are required'));
    }

    logger.info(`Aborting multipart upload for: ${key}`);

    await multipartUploadHelpers.abortMultipartUpload(key, uploadId);

    res.status(200).json({
      success: true,
      message: 'Multipart upload aborted successfully',
    });
  } catch (error) {
    logger.error('Error aborting multipart upload:', error);
    next(error);
  }
};
