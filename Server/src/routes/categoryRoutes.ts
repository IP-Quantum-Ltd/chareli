import { Router } from 'express';
import {
  getAllCategories,
  getCategoryById,
  getCategoryBySlug,
  createCategory,
  updateCategory,
  deleteCategory
} from '../controllers/categoryController';
import { authenticate, isAdmin } from '../middlewares/authMiddleware';
import { validateBody, validateParams, validateQuery } from '../middlewares/validationMiddleware';
import { apiLimiter } from '../middlewares/rateLimitMiddleware';
import {
  createCategorySchema,
  updateCategorySchema,
  categoryIdParamSchema,
  categorySlugParamSchema,
  categoryQuerySchema
} from '../validation';

const router = Router();

// Public endpoints
router.get('/', validateQuery(categoryQuerySchema), getAllCategories);
router.get(
  '/slug/:slug',
  validateParams(categorySlugParamSchema),
  getCategoryBySlug
);

// Authenticated admin endpoints (analytics-heavy detail + mutations)
router.use(authenticate);
router.use(isAdmin);
router.use(apiLimiter);

router.get('/:id', validateParams(categoryIdParamSchema), getCategoryById);
router.post('/', validateBody(createCategorySchema), createCategory);
router.put('/:id', validateParams(categoryIdParamSchema), validateBody(updateCategorySchema), updateCategory);
router.delete('/:id', validateParams(categoryIdParamSchema), deleteCategory);

export default router;
