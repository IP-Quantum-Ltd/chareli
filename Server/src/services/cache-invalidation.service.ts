import { cacheService } from './cache.service';
import { jsonCdnService } from './jsonCdn.service';
import { cachePatterns } from '../config/cache.config';
import logger from '../utils/logger';

/**
 * Cache Invalidation Service
 * Centralized logic for cache invalidation with cascade support
 */
class CacheInvalidationService {
  /**
   * Invalidate all caches related to a game update
   * Cascades to: game detail, games lists, category games, search
   */
  async invalidateGameUpdate(
    gameId: string,
    categoryId?: string
  ): Promise<void> {
    logger.info(`Invalidating caches for game ${gameId}`);

    try {
      // Invalidate specific game
      await cacheService.invalidateGame(gameId);

      // Invalidate all games lists
      await cacheService.invalidateGamesList();

      // Invalidate category games if category is provided
      if (categoryId) {
        await cacheService.invalidateGamesInCategory(categoryId);
      }

      // Invalidate all search results (games may appear in search)
      await cacheService.invalidateAllSearches();

      // ✨ INCREMENTAL CDN UPDATE - Queue for batch processing
      await jsonCdnService.queueGameUpdate(gameId);

      logger.info(`Successfully invalidated caches for game ${gameId}`);
    } catch (error) {
      logger.error(`Error invalidating caches for game ${gameId}:`, error);
    }
  }

  /**
   * Invalidate all caches related to a category update
   * Cascades to: category detail, categories list, category games
   */
  async invalidateCategoryUpdate(categoryId: string): Promise<void> {
    logger.info(`Invalidating caches for category ${categoryId}`);

    try {
      // Invalidate all categories
      await cacheService.invalidateCategories();

      // Invalidate games in this category
      await cacheService.invalidateGamesInCategory(categoryId);

      // Regenerate CDN JSON files for categories
      await jsonCdnService.invalidateCache(['categories']);

      logger.info(`Successfully invalidated caches for category ${categoryId}`);
    } catch (error) {
      logger.error(
        `Error invalidating caches for category ${categoryId}:`,
        error
      );
    }
  }

  /**
   * Invalidate caches when a game is created
   */
  async invalidateGameCreation(
    gameId: string,
    categoryId?: string
  ): Promise<void> {
    logger.info(`Invalidating caches for new game ${gameId}`);

    try {
      // Invalidate games lists (new game should appear)
      await cacheService.invalidateGamesList();

      // Invalidate category games if category is provided
      if (categoryId) {
        await cacheService.invalidateGamesInCategory(categoryId);
      }

      // Invalidate search (new game should be searchable)
      await cacheService.invalidateAllSearches();

      // ✨ INCREMENTAL CDN UPDATE - Queue for batch processing
      await jsonCdnService.queueGameUpdate(gameId);

      logger.info(`Successfully invalidated caches for new game ${gameId}`);
    } catch (error) {
      logger.error(`Error invalidating caches for new game ${gameId}:`, error);
    }
  }

  /**
   * Invalidate caches when a game is deleted
   */
  async invalidateGameDeletion(
    gameId: string,
    categoryId?: string
  ): Promise<void> {
    logger.info(`Invalidating caches for deleted game ${gameId}`);

    try {
      // Invalidate specific game
      await cacheService.invalidateGame(gameId);

      // Invalidate games lists
      await cacheService.invalidateGamesList();

      // Invalidate category games if category is provided
      if (categoryId) {
        await cacheService.invalidateGamesInCategory(categoryId);
      }

      // Invalidate search
      await cacheService.invalidateAllSearches();

      // ✨ INCREMENTAL CDN UPDATE - Queue for batch processing
      // The incremental update will handle removing the game from lists
      await jsonCdnService.queueGameUpdate(gameId);

      logger.info(`Successfully invalidated caches for deleted game ${gameId}`);
    } catch (error) {
      logger.error(
        `Error invalidating caches for deleted game ${gameId}:`,
        error
      );
    }
  }

  /**
   * Invalidate caches when game position changes
   */
  async invalidateGamePosition(
    gameId: string,
    categoryId?: string
  ): Promise<void> {
    logger.info(`Invalidating caches for game position change ${gameId}`);

    try {
      // Position changes affect lists
      await cacheService.invalidateGamesList();

      if (categoryId) {
        await cacheService.invalidateGamesInCategory(categoryId);
      }

      logger.info(
        `Successfully invalidated caches for game position ${gameId}`
      );
    } catch (error) {
      logger.error(`Error invalidating caches for game position:`, error);
    }
  }

  /**
   * Batch invalidation for multiple games
   * Useful for bulk operations
   */
  async invalidateMultipleGames(
    gameIds: string[],
    categoryIds?: string[]
  ): Promise<void> {
    logger.info(`Batch invalidating caches for ${gameIds.length} games`);

    try {
      // Invalidate all games lists once (more efficient than per-game)
      await cacheService.invalidateGamesList();

      // Invalidate search once
      await cacheService.invalidateAllSearches();

      // Invalidate specific games
      for (const gameId of gameIds) {
        await cacheService.invalidateGame(gameId);
      }

      // Invalidate affected categories
      if (categoryIds && categoryIds.length > 0) {
        for (const categoryId of categoryIds) {
          await cacheService.invalidateGamesInCategory(categoryId);
        }
      }

      logger.info(
        `Successfully batch invalidated caches for ${gameIds.length} games`
      );
    } catch (error) {
      logger.error(`Error batch invalidating game caches:`, error);
    }
  }

  /**
   * Clear all application caches
   * Use with extreme caution - only for maintenance or emergencies
   */
  async clearAllCaches(): Promise<void> {
    logger.warn('Clearing ALL application caches');

    try {
      await cacheService.clearAll();
      logger.warn('Successfully cleared all caches');
    } catch (error) {
      logger.error('Error clearing all caches:', error);
    }
  }
}

export const cacheInvalidationService = new CacheInvalidationService();
