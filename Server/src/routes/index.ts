import { Router } from 'express';
import userRoutes from './userRoutes';
import authRoutes from './authRoutes';
import categoryRoutes from './categoryRoutes';
import fileRoutes from './fileRoutes';
import gameRoutes from './gameRoutes';
import gamePositionHistoryRoutes from './gamePositionHistoryRoutes';
import systemConfigRoutes from './systemConfigRoutes';
import signupAnalyticsRoutes from './signupAnalyticsRoutes';
import analyticsRoutes from './analyticsRoutes';
import adminRoutes from './adminRoutes';
import cdnRoutes from './cdnRoutes';
import gameProposalRoutes from './gameProposalRoutes';
import webhookRoutes from './webhookRoutes';
import { ApiError } from '../middlewares/errorHandler';
import {
  debugConfig,
  debugUpload,
  debugUploadHealth,
} from '../controllers/debugController';
import { authenticate, isAdmin } from '../middlewares/authMiddleware';

const router = Router();

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check
 *     description: Check if the API is running
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: API is running
 */
router.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'API is running',
  });
});

/**
 * @swagger
 * /debug/config:
 *   get:
 *     summary: Debug config check
 *     description: Check environment variables and config (masked for security)
 *     tags: [Debug]
 *     responses:
 *       200:
 *         description: Config debug info
 */
router.get('/debug/config', debugConfig);

// Admin-only upload diagnostics. Returns aggregated game + file + BullMQ state
// for a single upload, plus a pipeline health probe (storage / redis / queues).
router.get('/debug/upload-health', authenticate, isAdmin, debugUploadHealth);
router.get('/debug/upload/:gameId', authenticate, isAdmin, debugUpload);

// API routes
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/categories', categoryRoutes);
router.use('/files', fileRoutes);
router.use('/games', gameRoutes);
router.use('/game-position-history', gamePositionHistoryRoutes);
router.use('/system-configs', systemConfigRoutes);
router.use('/signup-analytics', signupAnalyticsRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/admin', adminRoutes);
router.use('/cdn', cdnRoutes);
router.use('/game-proposals', gameProposalRoutes);
router.use('/internal', webhookRoutes); // Internal webhooks from Cloudflare Worker

// Handle 404 errors for routes that don't exist
router.all('/:path', (req, _res, next) => {
  next(ApiError.notFound(`Route ${req.originalUrl} not found`));
});

export default router;
