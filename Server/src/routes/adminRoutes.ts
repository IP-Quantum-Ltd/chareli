import { Router } from 'express';
import { cacheService } from '../services/cache.service';
import {
  authenticate,
  isAdmin,
  isSuperAdmin,
} from '../middlewares/authMiddleware';
import { adminLimiter } from '../middlewares/rateLimitMiddleware';
import {
  getDashboardAnalytics,
  getGamesWithAnalytics,
  getUsersWithAnalytics,
  getGameAnalyticsById,
  getUserAnalyticsById,
  getGamesPopularityMetrics,
  runInactiveUsersCheck,
  getUserActivityLog,
} from '../controllers/adminDashboardController';
import {
  getReprocessingStatus,
  startReprocessing,
  pauseReprocessing,
  resumeReprocessing,
  resetReprocessing,
} from '../controllers/imageReprocessingController';

const router = Router();
// Import missing middleware
import { isEditor } from '../middlewares/authMiddleware';

// All admin routes require authentication
router.use(authenticate);
// Apply admin rate limiting - applies to all authenticated dashboard routes
router.use(adminLimiter);

/**
 * @swagger
 * /admin/dashboard:
 *   get:
 *     summary: Get admin dashboard analytics
 *     tags: [Admin - Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard analytics retrieved successfully
 */
router.get('/dashboard', isAdmin, getDashboardAnalytics);

/**
 * @swagger
 * /admin/games-popularity:
 *   get:
 *     summary: Get popularity metrics for all games
 *     tags: [Admin - Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Games popularity metrics retrieved successfully
 */
router.get('/games-popularity', isAdmin, getGamesPopularityMetrics);

/**
 * @swagger
 * /admin/games-analytics:
 *   get:
 *     summary: Get all games with their analytics
 *     tags: [Admin - Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Games with analytics retrieved successfully
 */
// Allow Editors to access game list/analytics
router.get('/games-analytics', isEditor, getGamesWithAnalytics);

/**
 * @swagger
 * /admin/users-analytics:
 *   get:
 *     summary: Get all users with their analytics
 *     tags: [Admin - Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *         description: Field to sort by (e.g., createdAt, lastLoggedIn)
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *         description: Sort order
 *     responses:
 *       200:
 *         description: Users with analytics retrieved successfully
 */
router.get('/users-analytics', isAdmin, getUsersWithAnalytics);

/**
 * @swagger
 * /admin/games/{id}/analytics:
 *   get:
 *     summary: Get analytics for a specific game
 *     tags: [Admin - Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Game ID
 *     responses:
 *       200:
 *         description: Game analytics retrieved successfully
 */
// Allow Editors to access game analytics
router.get('/games/:id/analytics', isEditor, getGameAnalyticsById);

/**
 * @swagger
 * /admin/users/{id}/analytics:
 *   get:
 *     summary: Get analytics for a specific user
 *     tags: [Admin - Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *     responses:
 *       200:
 *         description: User analytics retrieved successfully
 */
router.get('/users/:id/analytics', isAdmin, getUserAnalyticsById);

/**
 * @swagger
 * /admin/user-activity-log:
 *   get:
 *     summary: Get user activity log
 *     tags: [Admin - Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User activity log retrieved successfully
 */
router.get('/user-activity-log', isAdmin, getUserActivityLog);

/**
 * @swagger
 * /admin/check-inactive-users:
 *   post:
 *     summary: Manually trigger the check for inactive users
 *     tags: [Admin - System]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Inactive users check completed successfully
 */
router.post('/check-inactive-users', isAdmin, runInactiveUsersCheck);

// Cache Routes
/**
 * @swagger
 * /admin/cache/stats:
 *   get:
 *     summary: Get cache statistics
 *     description: Retrieve Redis cache statistics including hit rate, memory usage, and key count
 *     tags: [Admin - Cache]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Cache statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     enabled:
 *                       type: boolean
 *                     hits:
 *                       type: number
 *                     misses:
 *                       type: number
 *                     hitRate:
 *                       type: number
 *                     keys:
 *                       type: number
 *                     memoryUsed:
 *                       type: string
 *                     evictions:
 *                       type: number
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Admin access required
 */
router.get('/cache/stats', isAdmin, async (req, res, next) => {
  try {
    const stats = await cacheService.getStats();

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /admin/cache/clear:
 *   post:
 *     summary: Clear all cache
 *     description: Clear all cached data from Redis. Use with caution!
 *     tags: [Admin - Cache]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Cache cleared successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Admin access required
 */
router.post('/cache/clear', isAdmin, async (req, res, next) => {
  try {
    await cacheService.clearAll();

    res.status(200).json({
      success: true,
      message: 'All cache cleared successfully',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /admin/cache/clear/games:
 *   post:
 *     summary: Clear games cache
 *     description: Clear all game-related cached data
 *     tags: [Admin - Cache]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Games cache cleared successfully
 */
router.post('/cache/clear/games', isAdmin, async (req, res, next) => {
  try {
    await cacheService.invalidateAllGames();

    res.status(200).json({
      success: true,
      message: 'Games cache cleared successfully',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /admin/cache/clear/categories:
 *   post:
 *     summary: Clear categories cache
 *     description: Clear all category-related cached data
 *     tags: [Admin - Cache]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Categories cache cleared successfully
 */
router.post('/cache/clear/categories', isAdmin, async (req, res, next) => {
  try {
    await cacheService.invalidateCategories();

    res.status(200).json({
      success: true,
      message: 'Categories cache cleared successfully',
    });
  } catch (error) {}
});

/**
 * @swagger
 * /admin/cdn/regenerate:
 *   post:
 *     summary: Regenerate JSON CDN files
 *     description: Regenerate all static JSON files for CDN. Use this when data is stale.
 *     tags: [Admin - Cache]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: CDN files regenerated successfully
 */
router.post('/cdn/regenerate', isAdmin, async (req, res, next) => {
  try {
    const { jsonCdnService } = await import('../services/jsonCdn.service');

    // Run generation in background to avoid timeout
    jsonCdnService.generateAllJsonFiles().catch((error) => {
      console.error('Error generating JSON CDN files:', error);
    });

    res.status(200).json({
      success: true,
      message: 'JSON CDN regeneration started in background',
    });
  } catch (error) {
    next(error);
  }
});

// Image Reprocessing Routes
/**
 * @swagger
 * /admin/image-reprocessing/status:
 *   get:
 *     summary: Get image reprocessing status
 *     description: Get current status of image reprocessing including progress and errors
 *     tags: [Admin - Image Reprocessing]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Status retrieved successfully
 */
router.get('/image-reprocessing/status', isAdmin, getReprocessingStatus);

/**
 * @swagger
 * /admin/image-reprocessing/start:
 *   post:
 *     summary: Start image reprocessing
 *     description: Start reprocessing unprocessed images to generate Sharp variants
 *     tags: [Admin - Image Reprocessing]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               batchSize:
 *                 type: number
 *                 default: 10
 *     responses:
 *       200:
 *         description: Reprocessing started successfully
 */
router.post('/image-reprocessing/start', isAdmin, startReprocessing);

/**
 * @swagger
 * /admin/image-reprocessing/pause:
 *   post:
 *     summary: Pause image reprocessing
 *     tags: [Admin - Image Reprocessing]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Reprocessing paused successfully
 */
router.post('/image-reprocessing/pause', isAdmin, pauseReprocessing);

/**
 * @swagger
 * /admin/image-reprocessing/resume:
 *   post:
 *     summary: Resume image reprocessing
 *     tags: [Admin - Image Reprocessing]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Reprocessing resumed successfully
 */
router.post('/image-reprocessing/resume', isAdmin, resumeReprocessing);

/**
 * @swagger
 * /admin/image-reprocessing/reset:
 *   delete:
 *     summary: Reset reprocessing status
 *     tags: [Admin - Image Reprocessing]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Status reset successfully
 */
router.delete('/image-reprocessing/reset', isAdmin, resetReprocessing);

export default router;
