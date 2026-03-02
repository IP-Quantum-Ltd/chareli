import * as yup from 'yup';
import { GameStatus } from '../entities/Games';

/**
 * Create game schema validation
 */
export const createGameSchema = yup.object({
  title: yup.string().trim().required('Game title is required'),
  description: yup.string().trim().nullable(),
  thumbnailFileId: yup.string().uuid('Invalid thumbnail file ID'),
  gameFileId: yup.string().uuid('Invalid game file ID'),
  // Support for new presigned URL approach
  thumbnailFileKey: yup.string(),
  gameFileKey: yup.string(),
  categoryId: yup.string().uuid('Invalid category ID'),
  status: yup.string().oneOf(Object.values(GameStatus), 'Invalid game status'),
  config: yup.number().integer('Config must be an integer').default(0),
  position: yup
    .number()
    .integer('Position must be an integer')
    .min(1, 'Position must be at least 1'),
  metadata: yup.object({
    developer: yup.string().trim().nullable(),
    howToPlay: yup.string().nullable(), // Remove .trim() to preserve HTML
    features: yup.array().of(yup.string().trim()).nullable(),
    tags: yup.array().of(yup.string().trim()).nullable(),
    seoKeywords: yup.string().trim().nullable(),
    schemaVersion: yup.string().trim().nullable(),
    faqOverride: yup.string().nullable(), // Allow HTML content
    platform: yup.array().of(yup.string().trim()).nullable(), // Support multi-platform
    releaseDate: yup.string().nullable(),
  }).nullable(),
});

/**
 * Update game schema validation
 */
export const updateGameSchema = yup
  .object({
    title: yup.string().trim(),
    description: yup.string().trim().nullable(),
    thumbnailFileId: yup.string().uuid('Invalid thumbnail file ID'),
    gameFileId: yup.string().uuid('Invalid game file ID'),
    // Support for new presigned URL approach
    thumbnailFileKey: yup.string(),
    gameFileKey: yup.string(),
    categoryId: yup.string().uuid('Invalid category ID'),
    status: yup
      .string()
      .oneOf(Object.values(GameStatus), 'Invalid game status'),
    config: yup.number().integer('Config must be an integer'),
    position: yup
      .number()
      .integer('Position must be an integer')
      .min(1, 'Position must be at least 1'),
    metadata: yup.object({
      developer: yup.string().trim().nullable(),
      howToPlay: yup.string().nullable(), // Remove .trim() to preserve HTML
      features: yup.array().of(yup.string().trim()).nullable(),
      tags: yup.array().of(yup.string().trim()).nullable(),
      seoKeywords: yup.string().trim().nullable(),
      schemaVersion: yup.string().trim().nullable(),
      faqOverride: yup.string().nullable(), // Allow HTML content
      platform: yup.array().of(yup.string().trim()).nullable(), // Support multi-platform
      releaseDate: yup.string().nullable(),
    }).nullable(),
  })
  .test(
    'at-least-one-field',
    'At least one field must be provided',
    (value) => {
      return Object.keys(value).length > 0;
    }
  );

/**
 * Game ID param schema validation
 * Accepts both UUID (for backward compatibility) and slug (for SEO-friendly URLs)
 */
export const gameIdParamSchema = yup.object({
  id: yup
    .string()
    .required('Game ID or slug is required')
    .test('is-uuid-or-slug', 'Invalid game ID or slug format', (value) => {
      if (!value) return false;
      // Check if it's a valid UUID
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      // Check if it's a valid slug (lowercase letters, numbers, and hyphens)
      const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
      return uuidRegex.test(value) || slugRegex.test(value);
    }),
});

/**
 * Query params schema validation
 */
export const gameQuerySchema = yup.object({
  page: yup.number().integer().min(1).optional(),
  limit: yup.number().integer().min(1).optional(), // Removed max validation - pagination middleware handles capping
  categoryId: yup.string().uuid().optional(),
  status: yup.string().oneOf(['active', 'disabled']).optional(),
  search: yup.string().optional(),
  createdById: yup.string().uuid().optional(),
  filter: yup
    .string()
    .oneOf(['popular', 'recently_added', 'recommended'])
    .optional(),
});
