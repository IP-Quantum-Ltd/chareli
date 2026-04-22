import { Router } from 'express';
import {
  getAllFiles,
  getFileById,
  createFile,
  updateFile,
  deleteFile,
  uploadFile,
  uploadFileForUpdate
} from '../controllers/fileController';
import { validateBody, validateParams, validateQuery } from '../middlewares/validationMiddleware';
import { apiLimiter } from '../middlewares/rateLimitMiddleware';
import { multerErrorHandler } from '../middlewares/multerErrorHandler';
import {
  createFileSchema,
  updateFileSchema,
  fileIdParamSchema,
  fileQuerySchema
} from '../validation';

const router = Router();

// Apply API rate limiter to all file routes
router.use(apiLimiter);

// File routes - not protected by authentication
router.get('/', validateQuery(fileQuerySchema), getAllFiles);
router.get('/:id', validateParams(fileIdParamSchema), getFileById);
router.post('/', uploadFile, multerErrorHandler, createFile);
router.put('/:id', validateParams(fileIdParamSchema), uploadFileForUpdate, multerErrorHandler, updateFile);
router.delete('/:id', validateParams(fileIdParamSchema), deleteFile);

export default router;
