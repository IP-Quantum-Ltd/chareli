import { Router } from 'express';
import {
  getAllGames,
  getGameById,
  getGameByPosition,
  createGame,
  updateGame,
  deleteGame,
  uploadGameFiles,
  uploadGameFilesForUpdate,
  generatePresignedUrl,
  getGameProcessingStatus,
  retryGameProcessing,
  bulkUpdateFreeTime,
  createMultipartUpload,
  getMultipartUploadPartUrl,
  completeMultipartUpload,
  abortMultipartUpload,
  likeGame,
  unlikeGame,
} from '../controllers/gameController';
import {
  authenticate,
  isAdmin,
  isEditor,
  optionalAuthenticate,
} from '../middlewares/authMiddleware';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../middlewares/validationMiddleware';
import {
  createGameSchema,
  updateGameSchema,
  gameIdParamSchema,
  gameQuerySchema,
} from '../validation';
import { paginationMiddleware } from '../middlewares/pagination.middleware';
import { likeLimiter, uploadLimiter } from '../middlewares/rateLimitMiddleware';

const router = Router();

// Public routes with optional authentication (for personalized features like recommendations)
router.get(
  '/',
  optionalAuthenticate,
  paginationMiddleware({ defaultLimit: 20, maxLimit: 100 }),
  validateQuery(gameQuerySchema),
  getAllGames
);
router.get('/position/:position', optionalAuthenticate, getGameByPosition);
router.get(
  '/:id',
  optionalAuthenticate,
  validateParams(gameIdParamSchema),
  getGameById
);
// Like/unlike routes (authenticated users only)
router.post(
  '/:id/like',
  authenticate,
  likeLimiter,
  validateParams(gameIdParamSchema),
  likeGame
);
router.delete(
  '/:id/like',
  authenticate,
  likeLimiter,
  validateParams(gameIdParamSchema),
  unlikeGame
);

router.use(authenticate);
// Remove global isAdmin to allow Editor access to specific routes

// Presigned URL generation - Allow Editors (needed for creating/updating games with images)
router.post('/presigned-url', isEditor, uploadLimiter, generatePresignedUrl);

// Multipart upload routes - Allow Editors
router.post('/multipart/create', isEditor, uploadLimiter, createMultipartUpload);
router.post('/multipart/part-url', isEditor, uploadLimiter, getMultipartUploadPartUrl);
router.post('/multipart/complete', isEditor, uploadLimiter, completeMultipartUpload);
router.post('/multipart/abort', isEditor, uploadLimiter, abortMultipartUpload);

// Bulk update - Admin only (seems unrelated to single game management)
router.post('/bulk-update-free-time', isAdmin, bulkUpdateFreeTime);

// Create Game - Allow Editors
router.post('/', isEditor, uploadGameFiles, createGame);

// Update Game - Allow Editors
router.put(
  '/:id',
  isEditor,
  validateParams(gameIdParamSchema),
  uploadGameFilesForUpdate,
  updateGame
);

// Delete Game - Admin only (User explicitly requested NO delete permissions for Editors)
router.delete('/:id', isAdmin, validateParams(gameIdParamSchema), deleteGame);

// Game processing status routes - Allow Editors
router.get(
  '/:id/processing-status',
  isEditor,
  validateParams(gameIdParamSchema),
  getGameProcessingStatus
);
router.post(
  '/:id/retry-processing',
  isEditor,
  validateParams(gameIdParamSchema),
  retryGameProcessing
);

export default router;
