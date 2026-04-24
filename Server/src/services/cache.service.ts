import { redisService } from './redis.service';
import { cacheConfig, cacheKeys, cachePatterns } from '../config/cache.config';
import logger from '../utils/logger';
import { Game } from '../entities/Games';
import { Category } from '../entities/Category';

/**
 * Cache Service
 * High-level cache abstraction layer for domain-specific caching operations
 */
class CacheService {
  private enabled: boolean;

  constructor() {
    this.enabled = cacheConfig.features.cacheEnabled;
  }

  /**
   * Check if caching is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  // ============= GAME CACHING =============

  /**
   * Get a game from cache by ID
   */
  async getGameById(id: string): Promise<Game | null> {
    if (!this.enabled) return null;

    try {
      const key = cacheKeys.game(id);
      const cached = await redisService.get<Game>(key);

      if (cached) {
        logger.debug(`Cache hit: game ${id}`);
      }

      return cached;
    } catch (error) {
      logger.error(`Error getting game ${id} from cache:`, error);
      return null;
    }
  }

  /**
   * Set a game in cache by ID
   */
  async setGameById(id: string, game: Game, ttl?: number): Promise<void> {
    if (!this.enabled) return;

    try {
      const key = cacheKeys.game(id);
      const cacheTtl = ttl || cacheConfig.ttl.game_detail;
      await redisService.set(key, game, cacheTtl);
      logger.debug(`Cached game ${id} with TTL ${cacheTtl}s`);
    } catch (error) {
      logger.error(`Error caching game ${id}:`, error);
    }
  }

  /**
   * Get games list from cache
   */
  async getGamesList(
    page: number,
    limit: number,
    filters?: string
  ): Promise<any | null> {
    if (!this.enabled) return null;

    try {
      const key = cacheKeys.gamesList(page, limit, filters);
      const cached = await redisService.get<any>(key);

      if (cached) {
        logger.debug(`Cache hit: games list page ${page}`);
      }

      return cached;
    } catch (error) {
      logger.error(`Error getting games list from cache:`, error);
      return null;
    }
  }

  /**
   * Set games list in cache
   */
  async setGamesList(
    page: number,
    limit: number,
    data: any,
    filters?: string,
    ttl?: number
  ): Promise<void> {
    if (!this.enabled) return;

    try {
      const key = cacheKeys.gamesList(page, limit, filters);
      const cacheTtl = ttl || cacheConfig.ttl.games_list;
      await redisService.set(key, data, cacheTtl);
      logger.debug(`Cached games list page ${page} with TTL ${cacheTtl}s`);
    } catch (error) {
      logger.error(`Error caching games list:`, error);
    }
  }

  /**
   * Invalidate a specific game cache
   */
  async invalidateGame(id: string): Promise<void> {
    if (!this.enabled) return;

    try {
      const key = cacheKeys.game(id);
      await redisService.del(key);
      logger.info(`Invalidated cache for game ${id}`);
    } catch (error) {
      logger.error(`Error invalidating game ${id} cache:`, error);
    }
  }

  /**
   * Invalidate all games list caches
   */
  async invalidateGamesList(): Promise<void> {
    if (!this.enabled) return;

    try {
      const pattern = cachePatterns.allGamesList();
      const deletedCount = await redisService.deletePattern(pattern);
      logger.info(`Invalidated ${deletedCount} games list cache entries`);
    } catch (error) {
      logger.error(`Error invalidating games list cache:`, error);
    }
  }

  /**
   * Invalidate all game-related caches (game + lists)
   */
  async invalidateAllGames(): Promise<void> {
    if (!this.enabled) return;

    try {
      const pattern = cachePatterns.allGames();
      const deletedCount = await redisService.deletePattern(pattern);
      logger.info(`Invalidated ${deletedCount} game cache entries`);
    } catch (error) {
      logger.error(`Error invalidating all games cache:`, error);
    }
  }

  // ============= CATEGORY CACHING =============

  /**
   * Get categories list from cache
   */
  async getCategoriesList(
    page?: number,
    limit?: number,
    search?: string
  ): Promise<any | null> {
    if (!this.enabled) return null;

    try {
      const key = cacheKeys.categoriesList(page, limit, search);
      const cached = await redisService.get<any>(key);

      if (cached) {
        logger.debug(`Cache hit: categories list`);
      }

      return cached;
    } catch (error) {
      logger.error(`Error getting categories from cache:`, error);
      return null;
    }
  }

  /**
   * Set categories list in cache
   */
  async setCategoriesList(
    data: any,
    page?: number,
    limit?: number,
    search?: string,
    ttl?: number
  ): Promise<void> {
    if (!this.enabled) return;

    try {
      const key = cacheKeys.categoriesList(page, limit, search);
      const cacheTtl = ttl || cacheConfig.ttl.categories;
      await redisService.set(key, data, cacheTtl);
      logger.debug(`Cached categories list with TTL ${cacheTtl}s`);
    } catch (error) {
      logger.error(`Error caching categories:`, error);
    }
  }

  /**
   * Get category by ID from cache
   */
  async getCategoryById(id: string): Promise<Category | null> {
    if (!this.enabled) return null;

    try {
      const key = cacheKeys.category(id);
      const cached = await redisService.get<Category>(key);

      if (cached) {
        logger.debug(`Cache hit: category ${id}`);
      }

      return cached;
    } catch (error) {
      logger.error(`Error getting category ${id} from cache:`, error);
      return null;
    }
  }

  /**
   * Set category in cache
   */
  async setCategoryById(
    id: string,
    category: Category,
    ttl?: number
  ): Promise<void> {
    if (!this.enabled) return;

    try {
      const key = cacheKeys.category(id);
      const cacheTtl = ttl || cacheConfig.ttl.categories;
      await redisService.set(key, category, cacheTtl);
      logger.debug(`Cached category ${id} with TTL ${cacheTtl}s`);
    } catch (error) {
      logger.error(`Error caching category ${id}:`, error);
    }
  }

  /**
   * Get games in a category from cache
   */
  async getCategoryGames(
    categoryId: string,
    page: number,
    limit: number
  ): Promise<any | null> {
    if (!this.enabled) return null;

    try {
      const key = cacheKeys.categoryGames(categoryId, page, limit);
      const cached = await redisService.get<any>(key);

      if (cached) {
        logger.debug(`Cache hit: category ${categoryId} games page ${page}`);
      }

      return cached;
    } catch (error) {
      logger.error(`Error getting category games from cache:`, error);
      return null;
    }
  }

  /**
   * Set games in a category in cache
   */
  async setCategoryGames(
    categoryId: string,
    page: number,
    limit: number,
    data: any,
    ttl?: number
  ): Promise<void> {
    if (!this.enabled) return;

    try {
      const key = cacheKeys.categoryGames(categoryId, page, limit);
      const cacheTtl = ttl || cacheConfig.ttl.games_list;
      await redisService.set(key, data, cacheTtl);
      logger.debug(
        `Cached category ${categoryId} games page ${page} with TTL ${cacheTtl}s`
      );
    } catch (error) {
      logger.error(`Error caching category games:`, error);
    }
  }

  /**
   * Invalidate all categories cache
   */
  async invalidateCategories(): Promise<void> {
    if (!this.enabled) return;

    try {
      const pattern = cachePatterns.allCategories();
      const deletedCount = await redisService.deletePattern(pattern);
      logger.info(`Invalidated ${deletedCount} category cache entries`);
    } catch (error) {
      logger.error(`Error invalidating categories cache:`, error);
    }
  }

  /**
   * Invalidate games in a specific category
   */
  async invalidateGamesInCategory(categoryId: string): Promise<void> {
    if (!this.enabled) return;

    try {
      const pattern = cachePatterns.categoryGames(categoryId);
      const deletedCount = await redisService.deletePattern(pattern);
      logger.info(
        `Invalidated ${deletedCount} cache entries for category ${categoryId} games`
      );
    } catch (error) {
      logger.error(`Error invalidating category games cache:`, error);
    }
  }

  // ============= SEARCH CACHING =============

  /**
   * Get search results from cache
   */
  async getSearchResults(
    query: string,
    filters?: string,
    page?: number
  ): Promise<any | null> {
    if (!this.enabled) return null;

    try {
      const key = cacheKeys.search(query, filters, page);
      const cached = await redisService.get<any>(key);

      if (cached) {
        logger.debug(`Cache hit: search "${query}"`);
      }

      return cached;
    } catch (error) {
      logger.error(`Error getting search results from cache:`, error);
      return null;
    }
  }

  /**
   * Set search results in cache
   */
  async setSearchResults(
    query: string,
    data: any,
    filters?: string,
    page?: number,
    ttl?: number
  ): Promise<void> {
    if (!this.enabled) return;

    try {
      const key = cacheKeys.search(query, filters, page);
      const cacheTtl = ttl || cacheConfig.ttl.search;
      await redisService.set(key, data, cacheTtl);
      logger.debug(`Cached search "${query}" with TTL ${cacheTtl}s`);
    } catch (error) {
      logger.error(`Error caching search results:`, error);
    }
  }

  /**
   * Invalidate all search caches
   */
  async invalidateAllSearches(): Promise<void> {
    if (!this.enabled) return;

    try {
      const pattern = cachePatterns.allSearch();
      const deletedCount = await redisService.deletePattern(pattern);
      logger.info(`Invalidated ${deletedCount} search cache entries`);
    } catch (error) {
      logger.error(`Error invalidating search cache:`, error);
    }
  }

  // ============= ANALYTICS CACHING =============

  /**
   * Get analytics from cache
   */
  async getAnalytics(
    type: string,
    period: string,
    date?: string
  ): Promise<any | null> {
    if (!this.enabled) return null;

    try {
      const key = cacheKeys.analytics(type, period, date);
      const cached = await redisService.get<any>(key);

      if (cached) {
        logger.debug(`Cache hit: analytics ${type}/${period}`);
      }

      return cached;
    } catch (error) {
      logger.error(`Error getting analytics from cache:`, error);
      return null;
    }
  }

  /**
   * Set analytics in cache
   */
  async setAnalytics(
    type: string,
    period: string,
    data: any,
    date?: string,
    ttl?: number
  ): Promise<void> {
    if (!this.enabled) return;

    try {
      const key = cacheKeys.analytics(type, period, date);
      const cacheTtl = ttl || cacheConfig.ttl.analytics;
      await redisService.set(key, data, cacheTtl);
      logger.debug(`Cached analytics ${type}/${period} with TTL ${cacheTtl}s`);
    } catch (error) {
      logger.error(`Error caching analytics:`, error);
    }
  }

  /**
   * Invalidate every cached admin-dashboard response. Call after any analytics
   * write that changes a number a dashboard card displays — session create /
   * end, signup, login. Skip on heartbeats (they only update lastSeenAt and
   * don't affect any dashboard aggregation, so invalidating on every tick
   * would defeat caching with no upside).
   */
  async invalidateDashboard(): Promise<void> {
    if (!this.enabled) return;

    try {
      const pattern = cachePatterns.analyticsDashboard();
      const deletedCount = await redisService.deletePattern(pattern);
      if (deletedCount > 0) {
        logger.debug(`Invalidated ${deletedCount} dashboard cache entries`);
      }
    } catch (error) {
      logger.error(`Error invalidating dashboard cache:`, error);
    }
  }

  // ============= LIKE COUNTS =============

  /**
   * Get like count for a game
   */
  async getGameLikes(gameId: string): Promise<number | null> {
    if (!this.enabled) return null;

    try {
      const key = cacheKeys.gameLikes(gameId);
      const count = await redisService.get<number>(key);
      return count;
    } catch (error) {
      logger.error(`Error getting game likes from cache:`, error);
      return null;
    }
  }

  /**
   * Increment like count for a game
   */
  async incrementGameLikes(gameId: string): Promise<number> {
    if (!this.enabled) return 0;

    try {
      const key = cacheKeys.gameLikes(gameId);
      const newCount = await redisService.incr(key);
      logger.debug(`Incremented likes for game ${gameId} to ${newCount}`);
      return newCount;
    } catch (error) {
      logger.error(`Error incrementing game likes:`, error);
      return 0;
    }
  }

  /**
   * Decrement like count for a game
   */
  async decrementGameLikes(gameId: string): Promise<number> {
    if (!this.enabled) return 0;

    try {
      const key = cacheKeys.gameLikes(gameId);
      const newCount = await redisService.decr(key);
      logger.debug(`Decremented likes for game ${gameId} to ${newCount}`);
      return newCount;
    } catch (error) {
      logger.error(`Error decrementing game likes:`, error);
      return 0;
    }
  }

  /**
   * Set like count for a game (for initialization)
   */
  async setGameLikes(gameId: string, count: number): Promise<void> {
    if (!this.enabled) return;

    try {
      const key = cacheKeys.gameLikes(gameId);
      await redisService.set(key, count); // No TTL - persistent counter
      logger.debug(`Set likes for game ${gameId} to ${count}`);
    } catch (error) {
      logger.error(`Error setting game likes:`, error);
    }
  }

  // ============= UTILITY METHODS =============

  /**
   * Clear all caches (use with caution!)
   */
  async clearAll(): Promise<void> {
    if (!this.enabled) return;

    try {
      const pattern = cachePatterns.everything();
      const deletedCount = await redisService.deletePattern(pattern);
      logger.warn(`Cleared all cache: ${deletedCount} entries deleted`);
    } catch (error) {
      logger.error(`Error clearing all cache:`, error);
    }
  }

  /**
   * Get cache statistics
   */
  async getStats() {
    if (!this.enabled) {
      return {
        enabled: false,
        message: 'Caching is disabled',
      };
    }

    try {
      const stats = await redisService.getStats();
      return {
        enabled: true,
        ...stats,
      };
    } catch (error) {
      logger.error(`Error getting cache stats:`, error);
      return {
        enabled: true,
        error: 'Failed to get stats',
      };
    }
  }
}

export const cacheService = new CacheService();
