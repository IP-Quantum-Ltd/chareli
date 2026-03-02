import { Router } from 'express';
import {
  createAnalytics,
  getAllAnalytics,
  getAnalyticsById,
  updateAnalytics,
  deleteAnalytics,
  updateAnalyticsEndTime,
  trackHomepageVisit,
  heartbeatAnalytics,
} from '../controllers/analyticsController';
import {
  authenticate,
  isAdmin,
  optionalAuthenticate,
} from '../middlewares/authMiddleware';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../middlewares/validationMiddleware';
import {
  createAnalyticsSchema,
  updateAnalyticsSchema,
  analyticsQuerySchema,
  analyticsIdParamSchema,
} from '../validation/analytics.schema';
import { paginationMiddleware } from '../middlewares/pagination.middleware';
import { analyticsLimiter } from '../middlewares/rateLimitMiddleware';

const router = Router();

// Create analytics entry - accessible by all (logged-in and anonymous)
router.post(
  '/',
  optionalAuthenticate,
  analyticsLimiter,
  validateBody(createAnalyticsSchema),
  createAnalytics
);

// Track homepage visit - accessible by all (logged-in and anonymous)
router.post(
  '/homepage-visit',
  optionalAuthenticate,
  analyticsLimiter,
  trackHomepageVisit
);

// Update analytics entry - accessible by all (to update endTime for guests)
router.put(
  '/:id',
  optionalAuthenticate,
  analyticsLimiter,
  validateParams(analyticsIdParamSchema),
  validateBody(updateAnalyticsSchema),
  updateAnalytics
);

// Heartbeat - accessible by all (to keep safe session alive)
router.post(
  '/:id/heartbeat',
  optionalAuthenticate,
  analyticsLimiter,
  validateParams(analyticsIdParamSchema),
  heartbeatAnalytics
);

// All other analytics routes require authentication
router.use(authenticate);

// Get all analytics entries - admin only
router.get(
  '/',
  isAdmin,
  paginationMiddleware({ defaultLimit: 50, maxLimit: 100 }),
  validateQuery(analyticsQuerySchema),
  getAllAnalytics
);

// Get analytics entry by ID - admin only
router.get(
  '/:id',
  isAdmin,
  validateParams(analyticsIdParamSchema),
  getAnalyticsById
);

// Delete analytics entry - admin only
// Update analytics end time - accessible by all authenticated users
router.post(
  '/:id/end',
  validateParams(analyticsIdParamSchema),
  updateAnalyticsEndTime
);

router.delete(
  '/:id',
  isAdmin,
  validateParams(analyticsIdParamSchema),
  deleteAnalytics
);

export default router;
