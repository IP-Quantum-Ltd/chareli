import { Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../config/database';
import { Category } from '../entities/Category';
import { Game } from '../entities/Games';
import { ApiError } from '../middlewares/errorHandler';
import { File } from '../entities/Files';
import { storageService } from '../services/storage.service';
import { cacheService } from '../services/cache.service';
import { cacheInvalidationService } from '../services/cache-invalidation.service';
import { AdminExclusionService } from '../services/adminExclusion.service';
import logger from '../utils/logger';

// Extend File type to include url
type FileWithUrl = File & { url?: string };
type GameWithUrls = {
  id: string;
  title: string;
  description?: string;
  thumbnailFile?: FileWithUrl;
  gameFile?: FileWithUrl;
  [key: string]: any;
};

const categoryRepository = AppDataSource.getRepository(Category);

/**
 * @swagger
 * /categories:
 *   get:
 *     summary: Get all categories
 *     description: Retrieve a list of all categories. Accessible by admins.
 *     tags: [Categories]
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
 *         name: search
 *         schema:
 *           type: string
 *         description: Search term for category name
 *     responses:
 *       200:
 *         description: A list of categories
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Internal server error
 */
export const getAllCategories = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { page = 1, limit = 10, search } = req.query;

    const pageNumber = parseInt(page as string, 10);
    const limitNumber = parseInt(limit as string, 10);

    const { sortBy } = req.query;

    // Try cache first (categories change infrequently)
    // KPI: Skip cache if sorting is requested to ensure fresh ranking
    if (cacheService.isEnabled() && !sortBy) {
      const cached = await cacheService.getCategoriesList(
        pageNumber,
        limitNumber,
        search as string | undefined
      );

      if (cached) {
        logger.debug(`Cache hit: categories list page ${pageNumber}`);
        res.status(200).json(cached);
        return;
      }
    }

    const queryBuilder = categoryRepository.createQueryBuilder('category');

    // Apply search filter if provided
    if (search) {
      queryBuilder.where('category.name ILIKE :search', {
        search: `%${search}%`,
      });
    }

    if (sortBy === 'averageSessions') {
      // For average sessions sorting, we need to calculate metrics for ALL categories first
      const allCategories = await queryBuilder.getMany();

      // Get aggregated stats for all categories efficiently
      // Use AdminExclusionService to filter out non-tracked roles
      const nonTrackedRoles = AdminExclusionService.getNonTrackedRoles();

      const statsQuery = `
        SELECT
          g."categoryId",
          COUNT(DISTINCT g.id) as game_count,
          COUNT(DISTINCT a.id) as session_count
        FROM games g
        LEFT JOIN internal.analytics a ON g.id = a."game_id" AND a."endTime" IS NOT NULL AND a.duration >= 30
        LEFT JOIN users u ON a."user_id" = u.id
        LEFT JOIN roles r ON u."roleId" = r.id
        WHERE (r.name IS NULL OR NOT (r.name = ANY($1)) OR a."user_id" IS NULL)
        GROUP BY g."categoryId"
      `;

      const stats = await AppDataSource.query(statsQuery, [nonTrackedRoles]);

      const statsMap = new Map<string, { gameCount: number; sessionCount: number }>(
        stats.map((s: any) => [
          s.categoryId,
          {
            gameCount: parseInt(s.game_count) || 0,
            sessionCount: parseInt(s.session_count) || 0,
          },
        ])
      );

      // Attach metrics and sort
      const categoriesWithMetrics = allCategories.map((cat) => {
        const stat = statsMap.get(cat.id) || {
          gameCount: 0,
          sessionCount: 0,
        };
        const avgSessions =
          stat.gameCount > 0 ? stat.sessionCount / stat.gameCount : 0;
        return {
          ...cat,
          metrics: {
            ...stat,
            averageSessions: avgSessions,
          },
        };
      });

      // Sort by average sessions descending
      categoriesWithMetrics.sort((a, b) => {
        return b.metrics.averageSessions - a.metrics.averageSessions;
      });

      // Apply pagination manually
      const total = categoriesWithMetrics.length;
      const startIndex = (pageNumber - 1) * limitNumber;
      const pagedCategories = categoriesWithMetrics.slice(
        startIndex,
        startIndex + limitNumber
      );

      // Now populate the detailed "top games" for the current page only
      const finalData = await Promise.all(
        pagedCategories.map(async (catWithMetrics) => {
        const nonTrackedRoles = AdminExclusionService.getNonTrackedRoles();
          // Reuse existing logic to get top games, but we already have basic metrics
          const topGamesQuery = `
            SELECT
              g.id,
              g.title,
              f."s3Key" as "thumbnailKey",
              COUNT(DISTINCT a.id) as total_sessions
            FROM games g
            LEFT JOIN files f ON g."thumbnailFileId" = f.id
            LEFT JOIN internal.analytics a ON g.id = a."game_id" AND a."endTime" IS NOT NULL AND a.duration >= 30
            LEFT JOIN users u ON a."user_id" = u.id
            LEFT JOIN roles r ON u."roleId" = r.id
            WHERE g."categoryId" = $1
            AND (r.name IS NULL OR NOT (r.name = ANY($2)) OR a."user_id" IS NULL)
            GROUP BY g.id, g.title, f."s3Key"
            ORDER BY total_sessions DESC
            LIMIT 3
          `;

          const topGamesResult = await AppDataSource.query(topGamesQuery, [
            catWithMetrics.id,
            nonTrackedRoles
          ]);

          const topGames = topGamesResult.map((game: any) => ({
            id: game.id,
            title: game.title,
            thumbnailUrl: game.thumbnailKey
              ? storageService.getPublicUrl(game.thumbnailKey)
              : null,
            sessionCount: parseInt(game.total_sessions) || 0,
          }));

          return {
            ...catWithMetrics,
            gameCount: catWithMetrics.metrics.gameCount, // Ensure backward compatibility if used
            topGames,
            // metrics is already attached
          };
        })
      );

      res.status(200).json({
        success: true,
        count: finalData.length,
        total,
        page: pageNumber,
        limit: limitNumber,
        totalPages: Math.ceil(total / limitNumber),
        data: finalData,
      });
      return;
    }

    // Default behavior (Normal sorting)
    // Get total count for pagination
    const total = await queryBuilder.getCount();

    // Apply pagination
    queryBuilder
      .skip((pageNumber - 1) * limitNumber)
      .take(limitNumber)
      .orderBy('category.isDefault', 'DESC');

    const categories = await queryBuilder.getMany();

    // Get game count and top 3 games for each category
    const categoriesWithAnalytics = await Promise.all(
      categories.map(async (category) => {
        // Get game count
        const gameCount = await AppDataSource.getRepository(Game).count({
          where: { categoryId: category.id },
        });

        // Get top 3 games by sessions (filtered by valid analytics)
        const nonTrackedRoles = AdminExclusionService.getNonTrackedRoles();
        const topGamesQuery = `
          SELECT
            g.id,
            g.title,
            f."s3Key" as "thumbnailKey",
            COUNT(DISTINCT a.id) as total_sessions
          FROM games g
          LEFT JOIN files f ON g."thumbnailFileId" = f.id
          LEFT JOIN internal.analytics a ON g.id = a."game_id" AND a."endTime" IS NOT NULL AND a.duration >= 30
          LEFT JOIN users u ON a."user_id" = u.id
          LEFT JOIN roles r ON u."roleId" = r.id
          WHERE g."categoryId" = $1
          AND (r.name IS NULL OR NOT (r.name = ANY($2)) OR a."user_id" IS NULL)
          GROUP BY g.id, g.title, f."s3Key"
          ORDER BY total_sessions DESC
          LIMIT 3
        `;

        const topGamesResult = await AppDataSource.query(topGamesQuery, [
          category.id,
          nonTrackedRoles
        ]);

        const topGames = topGamesResult.map((game: any) => ({
          id: game.id,
          title: game.title,
          thumbnailUrl: game.thumbnailKey
            ? storageService.getPublicUrl(game.thumbnailKey)
            : null,
          sessionCount: parseInt(game.total_sessions) || 0,
        }));

        // Also calculate average sessions for default view for consistency if needed,
        // but to save perf we can skip or do a lighter version.
        // For now, let's just return what was there plus initialized metrics structure
        const statsQuery = `
           SELECT COUNT(DISTINCT a.id) as session_count
           FROM games g
           LEFT JOIN internal.analytics a ON g.id = a."game_id" AND a."endTime" IS NOT NULL AND a.duration >= 30
           WHERE g."categoryId" = $1
        `;
        // Optimization: This N+1 query might be slighly slow if many categories, but existing code already does N+1 for top games.
        // Let's just calculate it to be consistent with the type.
        const statsResult = await AppDataSource.query(statsQuery, [category.id]);
        const totalSessions = parseInt(statsResult[0]?.session_count) || 0;
        const averageSessions = gameCount > 0 ? totalSessions / gameCount : 0;

        return {
          ...category,
          gameCount,
          topGames,
          metrics: {
             gameCount,
             sessionCount: totalSessions,
             averageSessions
          }
        };
      })
    );

    const responseData = {
      success: true,
      count: categoriesWithAnalytics.length,
      total,
      page: pageNumber,
      limit: limitNumber,
      totalPages: Math.ceil(total / limitNumber),
      data: categoriesWithAnalytics,
    };

    // Cache the response (30 minutes TTL - categories rarely change)
    if (cacheService.isEnabled()) {
      await cacheService.setCategoriesList(
        responseData,
        pageNumber,
        limitNumber,
        search as string | undefined,
        1800 // 30 minutes
      );
      logger.debug(`Cached categories list page ${pageNumber}`);
    }

    res.status(200).json(responseData);  } catch (error) {
    next(error);
  }
};

/**
 * @swagger
 * /categories/{id}:
 *   get:
 *     summary: Get category by ID
 *     description: Retrieve a single category by its ID. Accessible by admins.
 *     tags: [Categories]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID of the category to retrieve
 *     responses:
 *       200:
 *         description: Category found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Category not found
 *       500:
 *         description: Internal server error
 */
export const getCategoryById = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 5 } = req.query;

    const pageNumber = parseInt(page as string, 10);
    const limitNumber = parseInt(limit as string, 10);

    const category = await categoryRepository.findOne({
      where: { id },
      relations: ['games', 'games.thumbnailFile', 'games.gameFile'],
    });

    if (!category) {
      return next(ApiError.notFound(`Category with id ${id} not found`));
    }

    // Get analytics data for all games in this category
    const nonTrackedRoles = AdminExclusionService.getNonTrackedRoles();
    const analyticsQuery = `
      SELECT
        g.id as game_id,
        g.title,
        COUNT(DISTINCT a.id) as total_sessions,
        COALESCE(SUM(EXTRACT(EPOCH FROM (a."endTime" - a."startTime"))), 0) as total_time_played,
        COUNT(DISTINCT a."user_id") as unique_players
      FROM games g
      LEFT JOIN internal.analytics a ON g.id = a."game_id" AND a."endTime" IS NOT NULL
      LEFT JOIN users u ON a."user_id" = u.id
      LEFT JOIN roles r ON u."roleId" = r.id
      WHERE g."categoryId" = $1
      AND (r.name IS NULL OR NOT (r.name = ANY($2)) OR a."user_id" IS NULL)
      GROUP BY g.id, g.title
      ORDER BY total_sessions DESC, total_time_played DESC
    `;

    const analyticsResults = await AppDataSource.query(analyticsQuery, [
      id,
      nonTrackedRoles,
    ]);

    // Create a map for quick lookup of analytics data
    const analyticsMap = new Map();
    analyticsResults.forEach((result: any, index: number) => {
      analyticsMap.set(result.game_id, {
        sessions: parseInt(result.total_sessions) || 0,
        totalTimePlayed: parseInt(result.total_time_played) || 0,
        uniquePlayers: parseInt(result.unique_players) || 0,
        position: index + 1,
      });
    });

    // Transform games with analytics and URLs
    const gamesWithAnalytics = await Promise.all(
      category.games.map(async (game) => {
        const transformedGame: any = { ...game };

        // Add file URLs
        if (game.thumbnailFile?.s3Key) {
          transformedGame.thumbnailFile = {
            ...game.thumbnailFile,
            url: storageService.getPublicUrl(game.thumbnailFile.s3Key),
          } as FileWithUrl;
        }
        if (game.gameFile?.s3Key) {
          transformedGame.gameFile = {
            ...game.gameFile,
            url: storageService.getPublicUrl(game.gameFile.s3Key),
          } as FileWithUrl;
        }

        // Add analytics data
        const analytics = analyticsMap.get(game.id) || {
          sessions: 0,
          totalTimePlayed: 0,
          uniquePlayers: 0,
          position: category.games.length,
        };

        transformedGame.analytics = analytics;

        return transformedGame;
      })
    );

    // Sort games by performance (sessions desc, then total time played desc)
    gamesWithAnalytics.sort((a, b) => {
      if (b.analytics.sessions !== a.analytics.sessions) {
        return b.analytics.sessions - a.analytics.sessions;
      }
      return b.analytics.totalTimePlayed - a.analytics.totalTimePlayed;
    });

    // Update positions after sorting
    gamesWithAnalytics.forEach((game, index) => {
      game.analytics.position = index + 1;
    });

    // Calculate category-level metrics
    const categoryMetrics = {
      totalPlays: gamesWithAnalytics.reduce(
        (sum, game) => sum + game.analytics.uniquePlayers,
        0
      ),
      totalSessions: gamesWithAnalytics.reduce(
        (sum, game) => sum + game.analytics.sessions,
        0
      ),
      totalTimePlayed: gamesWithAnalytics.reduce(
        (sum, game) => sum + game.analytics.totalTimePlayed,
        0
      ),
      totalGames: gamesWithAnalytics.length,
    };

    // Apply pagination to games
    const totalGames = gamesWithAnalytics.length;
    const totalPages = Math.ceil(totalGames / limitNumber);
    const startIndex = (pageNumber - 1) * limitNumber;
    const endIndex = startIndex + limitNumber;
    const paginatedGames = gamesWithAnalytics.slice(startIndex, endIndex);

    const transformedCategory = {
      ...category,
      games: paginatedGames,
      metrics: categoryMetrics,
      pagination: {
        currentPage: pageNumber,
        totalPages,
        totalItems: totalGames,
        itemsPerPage: limitNumber,
        hasNextPage: pageNumber < totalPages,
        hasPrevPage: pageNumber > 1,
      },
    };

    res.status(200).json({
      success: true,
      data: transformedCategory,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @swagger
 * /categories:
 *   post:
 *     summary: Create a new category
 *     description: Create a new category. Accessible by admins.
 *     tags: [Categories]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       201:
 *         description: Category created successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Internal server error
 */
export const createCategory = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { name, description } = req.body;

    // Check if category with the same name already exists
    const existingCategory = await categoryRepository.findOne({
      where: { name },
    });

    if (existingCategory) {
      return next(
        ApiError.badRequest(`Category with name "${name}" already exists`)
      );
    }

    // Create new category
    const category = categoryRepository.create({
      name,
      description,
    });

    await categoryRepository.save(category);

    // Invalidate categories cache
    await cacheInvalidationService.invalidateCategoryUpdate(category.id);

    res.status(201).json({
      success: true,
      data: category,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @swagger
 * /categories/{id}:
 *   put:
 *     summary: Update a category
 *     description: Update a category by its ID. Accessible by admins.
 *     tags: [Categories]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID of the category to update
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Category updated successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Category not found
 *       500:
 *         description: Internal server error
 */
export const updateCategory = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    const category = await categoryRepository.findOne({
      where: { id },
    });

    if (!category) {
      return next(ApiError.notFound(`Category with id ${id} not found`));
    }

    // Check if name is being updated and if it already exists
    if (name && name !== category.name) {
      const existingCategory = await categoryRepository.findOne({
        where: { name },
      });

      if (existingCategory && existingCategory.id !== id) {
        return next(
          ApiError.badRequest(`Category with name "${name}" already exists`)
        );
      }

      category.name = name;
    }

    // Update description if provided
    if (description !== undefined) {
      category.description = description;
    }

    await categoryRepository.save(category);

    // Invalidate categories cache
    await cacheInvalidationService.invalidateCategoryUpdate(id);

    res.status(200).json({
      success: true,
      data: category,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @swagger
 * /categories/{id}:
 *   delete:
 *     summary: Delete a category
 *     description: Delete a category by its ID. Accessible by admins.
 *     tags: [Categories]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID of the category to delete
 *     responses:
 *       200:
 *         description: Category deleted successfully
 *       400:
 *         description: Bad request - Cannot delete category with associated games
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Category not found
 *       500:
 *         description: Internal server error
 */
export const deleteCategory = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;

    const category = await categoryRepository.findOne({
      where: { id },
      relations: ['games'],
    });

    if (!category) {
      return next(ApiError.notFound(`Category with id ${id} not found`));
    }

    // Prevent deletion of default category
    if (category.isDefault) {
      return next(
        ApiError.badRequest('Cannot delete the default "General" category')
      );
    }

    // Check if category has associated games
    if (category.games && category.games.length > 0) {
      return next(
        ApiError.badRequest(
          `Cannot delete category with ${category.games.length} associated games`
        )
      );
    }

    await categoryRepository.remove(category);

    // Invalidate categories cache
    await cacheInvalidationService.invalidateCategoryUpdate(id);

    res.status(200).json({
      success: true,
      message: 'Category deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};
