import { AppDataSource } from '../config/database';
import { Game, GameStatus } from '../entities/Games';
import { Category } from '../entities/Category';
import { GameLike } from '../entities/GameLike';
import { SystemConfig } from '../entities/SystemConfig';
import { Analytics } from '../entities/Analytics';
import { R2StorageAdapter } from './r2.storage.adapter';
import { cloudflareCacheService } from './cloudflare-cache.service';
import { redisService } from './redis.service';
import logger from '../utils/logger';
import config from '../config/config';
import { In } from 'typeorm';
import { calculateLikeCount } from '../utils/gameUtils';

interface JsonCdnConfig {
  enabled: boolean;
  refreshIntervalMinutes: number;
  baseUrl: string;
}

interface JsonMetadata {
  generatedAt: string;
  count: number;
  version: string;
}

/**
 * Service to generate static JSON files for CDN caching
 * Reduces database load by serving pre-generated JSON from R2/CDN
 */
class JsonCdnService {
  private config: JsonCdnConfig;
  private isGenerating = false;
  private r2Adapter: R2StorageAdapter;
  private lastVersion: number = Date.now(); // Version timestamp for cache-busting
  private metrics = {
    generationCount: 0,
    lastGenerationDuration: 0,
    failureCount: 0,
  };
  
  // Incremental update batching
  private pendingUpdates = new Set<string>();
  private updateTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.config = {
      enabled: config.jsonCdn.enabled,
      refreshIntervalMinutes: config.jsonCdn.refreshIntervalMinutes,
      baseUrl: config.jsonCdn.baseUrl,
    };
    this.r2Adapter = new R2StorageAdapter();
  }

  /**
   * Generate all static JSON files
   */
  async generateAllJsonFiles(): Promise<void> {
    if (this.isGenerating) {
      logger.warn('JSON generation already in progress, skipping');
      return;
    }

    this.isGenerating = true;
    const startTime = Date.now();

    try {
      logger.info('Starting JSON CDN generation...');

      // Generate in parallel for speed
      await Promise.all([
        this.generateCategoriesJson(),
        this.generateActiveGamesJson(),
        this.generateAllGamesJson(),
        this.generateAllGameDetailsJson(),
        this.generatePopularGamesJson(),
        this.generateSitemap(),
        this.generateRobotsTxt(),
      ]);

      const duration = Date.now() - startTime;
      this.metrics.generationCount++;
      this.metrics.lastGenerationDuration = duration;

      logger.info(`JSON CDN generation completed in ${duration}ms`);
    } catch (error) {
      this.metrics.failureCount++;
      logger.error('Error generating JSON files:', error);
      throw error;
    } finally {
      this.isGenerating = false;
    }
  }



  /**
   * Get user likes count for multiple games in a single query (batch optimization)
   */
  private async getBatchUserLikesCount(
    gameIds: string[]
  ): Promise<Map<string, number>> {
    if (gameIds.length === 0) {
      return new Map();
    }

    const gameLikeRepository = AppDataSource.getRepository(GameLike);

    // Single query to get all like counts
    const likeCounts = await gameLikeRepository
      .createQueryBuilder('gameLike')
      .select('gameLike.gameId', 'gameId')
      .addSelect('COUNT(*)', 'count')
      .where('gameLike.gameId IN (:...gameIds)', { gameIds })
      .groupBy('gameLike.gameId')
      .getRawMany();

    // Convert to Map for O(1) lookup
    const likeCountMap = new Map<string, number>();
    for (const row of likeCounts) {
      likeCountMap.set(row.gameId, parseInt(row.count, 10));
    }

    return likeCountMap;
  }

  /**
   * Get user likes count for a single game (used for individual game updates)
   */
  private async getUserLikesCount(gameId: string): Promise<number> {
    const gameLikeRepository = AppDataSource.getRepository(GameLike);
    return await gameLikeRepository.count({ where: { gameId } });
  }

  /**
   * Generate categories.json
   */
  private async generateCategoriesJson(): Promise<void> {
    try {
      const categoryRepository = AppDataSource.getRepository(Category);

      const categories = await categoryRepository.find({
        order: { name: 'ASC' },
        select: ['id', 'name', 'description', 'isDefault', 'createdAt'],
      });

      const json = {
        categories,
        metadata: this.createMetadata(categories.length),
      };

      await this.uploadJson('categories.json', json);
      logger.info(
        `Generated categories.json (${categories.length} categories)`
      );
    } catch (error) {
      logger.error('Error generating categories JSON:', error);
      throw error;
    }
  }

  /**
   * Generate games_active.json (all active games)
   */
  private async generateActiveGamesJson(): Promise<void> {
    try {
      const gameRepository = AppDataSource.getRepository(Game);

      const games = await gameRepository.find({
        where: { status: GameStatus.ACTIVE },
        relations: ['category', 'createdBy', 'thumbnailFile', 'gameFile'],
        order: { createdAt: 'DESC' },
        select: {
          id: true,
          title: true,
          slug: true,
          description: true,
          status: true,
          config: true,
          baseLikeCount: true,
          lastLikeIncrement: true,
          position: true,
          processingStatus: true,
          createdAt: true,
          updatedAt: true,
          category: {
            id: true,
            name: true,
            description: true,
          },
          createdBy: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
          thumbnailFile: {
            id: true,
            s3Key: true,
            type: true,
            variants: true,
            dimensions: true,
            isProcessed: true,
          },
          gameFile: {
            id: true,
            s3Key: true,
            type: true,
          },
        },
      });

      // Get all user likes in a single batch query
      const gameIds = games.map((g) => g.id);
      const userLikesMap = await this.getBatchUserLikesCount(gameIds);

      // Transform file s3Key to public URLs and add likeCount
      const gamesWithUrls = games.map((game) => {
        const userLikesCount = userLikesMap.get(game.id) || 0;
        return {
          ...game,
          likeCount: calculateLikeCount(game, userLikesCount),
          thumbnailFile: game.thumbnailFile
            ? {
                ...game.thumbnailFile,
                s3Key: this.r2Adapter.getPublicUrl(game.thumbnailFile.s3Key),
              }
            : null,
          gameFile: game.gameFile
            ? {
                ...game.gameFile,
                s3Key: this.r2Adapter.getPublicUrl(game.gameFile.s3Key),
              }
            : null,
        };
      });

      const json = {
        games: gamesWithUrls,
        metadata: this.createMetadata(games.length),
      };

      await this.uploadJson('games_active.json', json);
      logger.info(`Generated games_active.json (${games.length} games)`);
    } catch (error) {
      logger.error('Error generating active games JSON:', error);
      throw error;
    }
  }

  /**
   * Generate games_popular.json (manual mode popular games)
   */
  private async generatePopularGamesJson(): Promise<void> {
    try {
      const systemConfigRepository = AppDataSource.getRepository(SystemConfig);
      const gameRepository = AppDataSource.getRepository(Game);

      // Get popular games config
      const popularConfig = await systemConfigRepository.findOne({
        where: { key: 'popular_games_settings' },
      });

      if (!popularConfig || popularConfig.value?.mode !== 'manual') {
        logger.info(
          'Popular games in AUTO mode, generating based on play counts'
        );

        // Auto Mode: Get top played games from analytics (Last 30 days)
        const analyticsRepository = AppDataSource.getRepository(Analytics);
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const topGamesResult = await analyticsRepository
          .createQueryBuilder('analytics')
          .select('analytics.gameId', 'gameId')
          .addSelect('COUNT(*)', 'count')
          .leftJoin('analytics.user', 'user')
          .leftJoin('user.role', 'role')
          .where('analytics.gameId IS NOT NULL')
          .andWhere('analytics.createdAt >= :startDate', { startDate: thirtyDaysAgo })
          // Exclude admin activity
          .andWhere("(role.name = 'player' OR analytics.userId IS NULL)")
          .groupBy('analytics.gameId')
          .orderBy('count', 'DESC')
          .limit(20)
          .getRawMany();

        const gameIds = topGamesResult.map(result => result.gameId);

        if (gameIds.length === 0) {
           logger.info('No popular games found in analytics, generating empty JSON');
           await this.uploadJson('games_popular.json', {
             games: [],
             metadata: this.createMetadata(0),
           });
           return;
        }

        // Fetch full game details for the top games
        const gameRepository = AppDataSource.getRepository(Game);
        const games = await gameRepository.find({
          where: {
            id: In(gameIds),
            status: GameStatus.ACTIVE,
          },
          relations: ['category', 'createdBy', 'thumbnailFile', 'gameFile'],
          select: {
            id: true,
            title: true,
            slug: true,
            description: true,
            status: true,
            config: true,
            baseLikeCount: true,
            lastLikeIncrement: true,
            position: true,
            processingStatus: true,
            createdAt: true,
            updatedAt: true,
            category: {
              id: true,
              name: true,
              description: true,
            },
            createdBy: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
            thumbnailFile: {
              id: true,
              s3Key: true,
              type: true,
              variants: true,
              dimensions: true,
              isProcessed: true,
            },
            gameFile: {
              id: true,
              s3Key: true,
              type: true,
              variants: true,
              dimensions: true,
              isProcessed: true,
            },
          },
        });

        // Order games by popularity (matching the analytics order)
        const orderedGames = gameIds
          .map((id) => games.find((game) => game.id === id))
          .filter((game): game is Game => game !== undefined);

        // Get all user likes
        const userLikesMap = await this.getBatchUserLikesCount(
          orderedGames.map((g) => g.id)
        );

        // Transform and upload
        const gamesWithUrls = orderedGames.map((game) => {
          const userLikesCount = userLikesMap.get(game.id) || 0;
          return {
            ...game,
            likeCount: calculateLikeCount(game, userLikesCount),
            thumbnailFile: game.thumbnailFile
              ? {
                  ...game.thumbnailFile,
                  s3Key: this.r2Adapter.getPublicUrl(game.thumbnailFile.s3Key),
                }
              : null,
            gameFile: game.gameFile
              ? {
                  ...game.gameFile,
                  s3Key: this.r2Adapter.getPublicUrl(game.gameFile.s3Key),
                }
              : null,
          };
        });

        const json = {
          games: gamesWithUrls,
          metadata: this.createMetadata(gamesWithUrls.length),
        };

        await this.uploadJson('games_popular.json', json);
        logger.info(
          `Generated games_popular.json (AUTO mode, ${gamesWithUrls.length} games)`
        );
        return;
      }

      // Get game IDs from config
      let gameIds: string[] = [];
      if (popularConfig.value.selectedGameIds) {
        if (Array.isArray(popularConfig.value.selectedGameIds)) {
          gameIds = popularConfig.value.selectedGameIds;
        } else if (typeof popularConfig.value.selectedGameIds === 'object') {
          gameIds = Object.values(popularConfig.value.selectedGameIds);
        }
      }

      if (gameIds.length === 0) {
        logger.info('No popular games selected, generating empty JSON');
        await this.uploadJson('games_popular.json', {
          games: [],
          metadata: this.createMetadata(0),
        });
        return;
      }

      // Fetch games with all relations
      const games = await gameRepository.find({
        where: {
          id: In(gameIds),
          status: GameStatus.ACTIVE,
        },
        relations: ['category', 'createdBy', 'thumbnailFile', 'gameFile'],
        select: {
          id: true,
          title: true,
          slug: true,
          description: true,
          status: true,
          config: true,
          baseLikeCount: true,
          lastLikeIncrement: true,
          position: true,
          processingStatus: true,
          createdAt: true,
          updatedAt: true,
          category: {
            id: true,
            name: true,
            description: true,
          },
          createdBy: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
          thumbnailFile: {
            id: true,
            s3Key: true,
            type: true,
            variants: true,
            dimensions: true,
            isProcessed: true,
          },
          gameFile: {
            id: true,
            s3Key: true,
            type: true,
          },
        },
      });

      // Order by selectedGameIds order (preserve admin's chosen order)
      const orderedGames = gameIds
        .map((id: string) => games.find((game) => game.id === id))
        .filter((game): game is Game => game !== undefined);

      // Get all user likes in a single batch query
      const userLikesMap = await this.getBatchUserLikesCount(
        orderedGames.map((g) => g.id)
      );

      // Transform file s3Key to public URLs and add likeCount
      const gamesWithUrls = orderedGames.map((game) => {
        const userLikesCount = userLikesMap.get(game.id) || 0;
        return {
          ...game,
          likeCount: calculateLikeCount(game, userLikesCount),
          thumbnailFile: game.thumbnailFile
            ? {
                ...game.thumbnailFile,
                s3Key: this.r2Adapter.getPublicUrl(game.thumbnailFile.s3Key),
              }
            : null,
          gameFile: game.gameFile
            ? {
                ...game.gameFile,
                s3Key: this.r2Adapter.getPublicUrl(game.gameFile.s3Key),
              }
            : null,
        };
      });

      const json = {
        games: gamesWithUrls,
        metadata: this.createMetadata(gamesWithUrls.length),
      };

      await this.uploadJson('games_popular.json', json);
      logger.info(
        `Generated games_popular.json (${gamesWithUrls.length} games)`
      );
    } catch (error) {
      logger.error('Error generating popular games JSON:', error);
      throw error;
    }
  }

  /**
   * Generate sitemap.xml with all games, categories, and static pages
   */
  private async generateSitemap(): Promise<void> {
    try {
      const gameRepository = AppDataSource.getRepository(Game);
      const categoryRepository = AppDataSource.getRepository(Category);

      // Fetch all active games
      const games = await gameRepository.find({
        where: { status: GameStatus.ACTIVE },
        select: ['slug', 'updatedAt'],
        order: { updatedAt: 'DESC' },
      });

      // Fetch all categories
      const categories = await categoryRepository.find({
        select: ['name', 'id'],
        order: { name: 'ASC' },
      });

      const baseUrl = 'https://www.arcadesbox.com';
      const today = new Date().toISOString().split('T')[0];

      // Build sitemap XML
      let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <!-- Homepage -->
  <url>
    <loc>${baseUrl}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>

  <!-- Static Pages -->
  <url>
    <loc>${baseUrl}/about</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>${baseUrl}/categories</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>${baseUrl}/terms</loc>
    <lastmod>${today}</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.4</priority>
  </url>
  <url>
    <loc>${baseUrl}/privacy</loc>
    <lastmod>${today}</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.4</priority>
  </url>

  <!-- Individual Games -->
`;

      for (const game of games) {
        const lastmod = game.updatedAt.toISOString().split('T')[0];
        xml += `  <url>
    <loc>${baseUrl}/games/${game.slug}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>
`;
      }

      // Individual Categories
      xml += `
  <!-- Category Pages -->
`;
      for (const category of categories) {
        const categorySlug = category.name.toLowerCase().replace(/\s+/g, '-');
        xml += `  <url>
    <loc>${baseUrl}/categories/${categorySlug}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
`;
      }

      xml += `</urlset>`;

      // Upload to R2 as XML file
      const buffer = Buffer.from(xml, 'utf-8');
      const fullKey = 'cdn/sitemap.xml';

      await this.r2Adapter.uploadWithExactKey(fullKey, buffer, 'application/xml', {
        generatedAt: new Date().toISOString(),
        size: buffer.length.toString(),
        gamesCount: games.length.toString(),
        categoriesCount: categories.length.toString(),
      });

      logger.info(
        `Generated sitemap.xml (${games.length} games, ${categories.length} categories)`
      );
    } catch (error) {
      logger.error('Error generating sitemap:', error);
      throw error;
    }
  }

  /**
   * Generate robots.txt to disallow all crawlers
   */
  private async generateRobotsTxt(): Promise<void> {
    try {
      const robotsTxt = `User-agent: *
Disallow: /
`;

      const buffer = Buffer.from(robotsTxt, 'utf-8');
      const fullKey = 'robots.txt'; // At bucket root, not in cdn/ folder


      await this.r2Adapter.uploadWithExactKey(fullKey, buffer, 'text/plain', {
        generatedAt: new Date().toISOString(),
        size: buffer.length.toString(),
      });

      logger.info('Generated robots.txt for CDN subdomain');
    } catch (error) {
      logger.error('Error generating robots.txt:', error);
      throw error;
    }
  }

  /**
   * Generate games_all.json (all games regardless of status)
   */
  private async generateAllGamesJson(): Promise<void> {
    try {
      const gameRepository = AppDataSource.getRepository(Game);

      const games = await gameRepository.find({
        relations: ['category', 'createdBy', 'thumbnailFile', 'gameFile'],
        order: { createdAt: 'DESC' },
        select: {
          id: true,
          title: true,
          slug: true,
          description: true,
          status: true,
          config: true,
          baseLikeCount: true,
          lastLikeIncrement: true,
          position: true,
          processingStatus: true,
          createdAt: true,
          updatedAt: true,
          category: {
            id: true,
            name: true,
            description: true,
          },
          createdBy: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
          thumbnailFile: {
            id: true,
            s3Key: true,
            type: true,
            variants: true,
            dimensions: true,
            isProcessed: true,
          },
          gameFile: {
            id: true,
            s3Key: true,
            type: true,
          },
        },
      });

      // Get all user likes in a single batch query
      const gameIds = games.map((g) => g.id);
      const userLikesMap = await this.getBatchUserLikesCount(gameIds);

      // Transform file s3Key to public URLs and add likeCount
      const gamesWithUrls = games.map((game) => {
        const userLikesCount = userLikesMap.get(game.id) || 0;
        return {
          ...game,
          likeCount: calculateLikeCount(game, userLikesCount),
          thumbnailFile: game.thumbnailFile
            ? {
                ...game.thumbnailFile,
                s3Key: this.r2Adapter.getPublicUrl(game.thumbnailFile.s3Key),
              }
            : null,
          gameFile: game.gameFile
            ? {
                ...game.gameFile,
                s3Key: this.r2Adapter.getPublicUrl(game.gameFile.s3Key),
              }
            : null,
        };
      });

      const json = {
        games: gamesWithUrls,
        metadata: this.createMetadata(games.length),
      };

      await this.uploadJson('games_all.json', json);
      logger.info(`Generated games_all.json (${games.length} games)`);
    } catch (error) {
      logger.error('Error generating all games JSON:', error);
      throw error;
    }
  }

  /**
   * Generate individual game detail JSON files
   */
  private async generateAllGameDetailsJson(): Promise<void> {
    try {
      const gameRepository = AppDataSource.getRepository(Game);

      const games = await gameRepository.find({
        where: { status: GameStatus.ACTIVE },
        select: {
          id: true,
          slug: true,
        },
      });

      // Generate files in batches to avoid overwhelming the database
      const batchSize = 10;
      for (let i = 0; i < games.length; i += batchSize) {
        const batch = games.slice(i, i + batchSize);
        await Promise.all(
          batch.map((game) => this.generateGameDetailJson(game.id, game.slug))
        );
      }

      logger.info(`Generated ${games.length} individual game JSON files`);
    } catch (error) {
      logger.error('Error generating game details JSON:', error);
      throw error;
    }
  }

  /**
   * Generate single game detail JSON
   */
  async generateGameDetailJson(gameId: string, slug: string): Promise<void> {
    try {
      const gameRepository = AppDataSource.getRepository(Game);

      const game = await gameRepository.findOne({
        where: { id: gameId },
        relations: ['category', 'createdBy', 'thumbnailFile', 'gameFile'],
      });

      if (!game) {
        logger.warn(`Game ${gameId} not found, skipping JSON generation`);
        return;
      }

      // Get user likes count for this specific game
      const userLikesCount = await this.getUserLikesCount(gameId);

      // Transform file s3Key to public URLs and add likeCount
      const gameWithUrls = {
        ...game,
        likeCount: calculateLikeCount(game, userLikesCount),
        thumbnailFile: game.thumbnailFile
          ? {
              ...game.thumbnailFile,
              s3Key: this.r2Adapter.getPublicUrl(game.thumbnailFile.s3Key),
            }
          : null,
        gameFile: game.gameFile
          ? {
              ...game.gameFile,
              s3Key: this.r2Adapter.getPublicUrl(game.gameFile.s3Key),
            }
          : null,
      };

      const json = {
        game: gameWithUrls,
        metadata: this.createMetadata(1),
      };

      // Use slug for better SEO/readability
      await this.uploadJson(`games/${slug}.json`, json);
    } catch (error) {
      logger.error(`Error generating game detail JSON for ${gameId}:`, error);
      // Don't throw - allow other games to continue processing
    }
  }

  /**
   * Upload JSON to R2 with CDN cache headers and ETag support
   * Uses conditional upload to skip unnecessary uploads when content hasn't changed
   * This dramatically reduces R2 write operations and bandwidth costs
   */
  private async uploadJson(key: string, data: any): Promise<void> {
    try {
      const jsonString = JSON.stringify(data);
      const buffer = Buffer.from(jsonString, 'utf-8');

      // Use exact key path for CDN files (e.g., cdn/categories.json)
      const fullKey = `cdn/${key}`;

      // Conditionally upload only if content has changed
      const result = await this.r2Adapter.uploadIfChanged(
        fullKey,
        buffer,
        'application/json',
        {
          generatedAt: new Date().toISOString(),
          size: buffer.length.toString(),
        },
        'public, max-age=300, must-revalidate' // 5 minutes, allows conditional requests
      );

      // Store ETag in Redis for 1 hour (regardless of whether uploaded or skipped)
      await redisService.setCdnETag(key, result.etag, 3600);

      // Log with optimization status
      if (result.skipped) {
        logger.info(
          `[COST OPTIMIZATION] Skipped R2 upload (content unchanged): ${fullKey} (${buffer.length} bytes), ETag: ${result.etag}`
        );
      } else {
        logger.info(
          `[COST OPTIMIZATION] Uploaded to R2 (content changed): ${fullKey} (${buffer.length} bytes), ETag: ${result.etag}`
        );
      }
    } catch (error) {
      logger.error(`Error uploading JSON ${key}:`, error);
      throw error;
    }
  }


  /**
   * Invalidate specific cache entries by regenerating them
   * Also purges Cloudflare cache for the regenerated files
   */
  async invalidateCache(paths: string[]): Promise<void> {
    if (!this.config.enabled) {
      logger.debug('JSON CDN is disabled, skipping cache invalidation');
      return;
    }

    logger.info(`Invalidating CDN cache for: ${paths.join(', ')}`);

    const regeneratedPaths: string[] = [];

    try {
      for (const path of paths) {
        if (path.includes('categories')) {
          await this.generateCategoriesJson();
          regeneratedPaths.push('categories.json');
        } else if (
          path.includes('games_active') ||
          path.includes('games_all')
        ) {
          // Regenerate both active and all games lists
          await this.generateActiveGamesJson();
          await this.generateAllGamesJson();
          regeneratedPaths.push('games_active.json', 'games_all.json');
        } else if (path.includes('games_popular') || path.includes('popular')) {
          // Regenerate popular games JSON
          await this.generatePopularGamesJson();
          regeneratedPaths.push('games_popular.json');
        } else if (path.includes('games/')) {
          const slug = path.replace('games/', '').replace('.json', '');
          const gameRepository = AppDataSource.getRepository(Game);
          const game = await gameRepository.findOne({
            where: { slug },
            select: ['id', 'slug'],
          });
          if (game) {
            await this.generateGameDetailJson(game.id, slug);
            regeneratedPaths.push(`games/${slug}.json`);
          }
        }
      }

      // Update version timestamp for cache-busting
      this.lastVersion = Date.now();

      // Purge Cloudflare cache for regenerated files
      if (regeneratedPaths.length > 0) {
        logger.info(`Purging Cloudflare cache for: ${regeneratedPaths.join(', ')}`);
        await cloudflareCacheService.purgeCdnJsonFiles(regeneratedPaths);
      }

      logger.info('Cache invalidation completed');
    } catch (error) {
      logger.error('Error during cache invalidation:', error);
      // Don't throw - invalidation failure shouldn't block the main operation
    }
  }

  /**
   * Get CDN URL for a JSON file
   */
  getCdnUrl(path: string): string {
    if (!this.config.enabled || !this.config.baseUrl) {
      return '';
    }
    return `${this.config.baseUrl}/cdn/${path}`;
  }

  /**
   * Check if CDN is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get latest CDN version timestamp for cache-busting
   * Frontend uses this to append ?v=<version> to CDN URLs
   */
  getVersion(): number {
    return this.lastVersion;
  }

  /**
   * Get service metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      isGenerating: this.isGenerating,
      lastVersion: this.lastVersion,
      config: {
        enabled: this.config.enabled,
        refreshIntervalMinutes: this.config.refreshIntervalMinutes,
      },
    };
  }

  /**
   * Create metadata object for JSON files
   */
  private createMetadata(count: number): JsonMetadata {
    return {
      generatedAt: new Date().toISOString(),
      count,
      version: '1.0',
    };
  }

  // ============================================================================
  // INCREMENTAL CDN UPDATE METHODS
  // ============================================================================

  /**
   * Queue a game for incremental CDN update (debounced batching)
   * Collects multiple game updates within 10 seconds, then processes in batch
   */
  async queueGameUpdate(gameId: string): Promise<void> {
    if (!this.config.enabled) {
      logger.debug('JSON CDN is disabled, skipping queue');
      return;
    }

    this.pendingUpdates.add(gameId);
    logger.info(`[INCREMENTAL] Queued game ${gameId} for CDN update (${this.pendingUpdates.size} pending)`);

    // Clear existing timer
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
    }

    // Set new timer - process batch after 10 seconds of inactivity
    this.updateTimer = setTimeout(async () => {
      await this.processPendingUpdates();
    }, 10000);
  }

  /**
   * Process all pending game updates in batch
   */
  private async processPendingUpdates(): Promise<void> {
    if (this.pendingUpdates.size === 0) return;

    const gameIds = Array.from(this.pendingUpdates);
    this.pendingUpdates.clear();

    logger.info(`[BATCH UPDATE] Processing ${gameIds.length} games`);

    try {
      // Process all updates in parallel
      await Promise.all(
        gameIds.map(gameId => this.updateSingleGameInLists(gameId))
      );

      logger.info(`✅ [BATCH UPDATE] Completed ${gameIds.length} games`);
    } catch (error) {
      logger.error('[BATCH UPDATE] Error processing updates:', error);
      // Don't re-queue on error to avoid infinite loops
    }
  }

  /**
   * Update a single game in the CDN JSON files (incremental update)
   * Instead of regenerating entire arrays, we patch the specific game
   */
  async updateSingleGameInLists(gameId: string): Promise<void> {
    const startTime = Date.now();
    
    try {
      logger.info(`[INCREMENTAL] Starting update for game ${gameId}`);

      // Fetch the single updated game
      const gameRepository = AppDataSource.getRepository(Game);
      const game = await gameRepository.findOne({
        where: { id: gameId },
        relations: ['category', 'createdBy', 'thumbnailFile', 'gameFile'],
      });

      if (!game) {
        logger.warn(`[INCREMENTAL] Game ${gameId} not found`);
        return;
      }

      // Transform to CDN format
      const userLikesCount = await this.getUserLikesCount(gameId);
      const gameData = {
        ...game,
        likeCount: calculateLikeCount(game, userLikesCount),
        thumbnailFile: game.thumbnailFile ? {
          ...game.thumbnailFile,
          s3Key: this.r2Adapter.getPublicUrl(game.thumbnailFile.s3Key),
        } : null,
        gameFile: game.gameFile ? {
          ...game.gameFile,
          s3Key: this.r2Adapter.getPublicUrl(game.gameFile.s3Key),
        } : null,
      };

      // Update games_active.json (only if game is active)
      if (game.status === GameStatus.ACTIVE) {
        await this.patchGameInJson('games_active.json', gameData);
      } else {
        // If game is no longer active, remove it from games_active.json
        await this.removeGameFromJson('games_active.json', gameId);
      }

      // Update games_all.json
      await this.patchGameInJson('games_all.json', gameData);

      // Update individual game detail file
      await this.generateGameDetailJson(gameId, game.slug);

      const duration = Date.now() - startTime;
      logger.info(`✅ [INCREMENTAL] Updated game ${gameId} in ${duration}ms`);
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`[INCREMENTAL] Error updating game ${gameId} after ${duration}ms:`, error);
      
      // Fallback: trigger full regeneration
      logger.warn('[INCREMENTAL] Falling back to full regeneration');
      await this.generateAllJsonFiles();
    }
  }

  /**
   * Patch a single game in a JSON file (incremental update)
   * Downloads existing JSON, updates the specific game, uploads
   */
  private async patchGameInJson(filename: string, gameData: any): Promise<void> {
    const key = `cdn/${filename}`;

    try {
      // Download existing JSON
      const existingBuffer = await this.r2Adapter.downloadFile(key);
      const existingJson = JSON.parse(existingBuffer.toString('utf-8'));

      // Find and replace the game in the array
      const games = existingJson.games || [];
      const index = games.findIndex((g: any) => g.id === gameData.id);

      if (index >= 0) {
        // Update existing game
        games[index] = gameData;
        logger.info(`[INCREMENTAL] Updated game at index ${index} in ${filename}`);
      } else {
        // Add new game (insert at beginning for "newest first" order)
        games.unshift(gameData);
        logger.info(`[INCREMENTAL] Added new game to ${filename} (now ${games.length} games)`);
      }

      // Update metadata
      existingJson.metadata = this.createMetadata(games.length);

      // Upload patched JSON (will skip if content unchanged via uploadIfChanged)
      await this.uploadJson(filename, existingJson);
    } catch (error: any) {
      if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
        // File doesn't exist yet - do full generation as fallback
        logger.warn(`[INCREMENTAL] ${filename} doesn't exist, cannot patch`);
        throw error; // Let caller handle fallback
      }
      throw error;
    }
  }

  /**
   * Remove a game from a JSON file (for when game is deactivated)
   */
  private async removeGameFromJson(filename: string, gameId: string): Promise<void> {
    const key = `cdn/${filename}`;

    try {
      // Download existing JSON
      const existingBuffer = await this.r2Adapter.downloadFile(key);
      const existingJson = JSON.parse(existingBuffer.toString('utf-8'));

      // Filter out the game
      const games = existingJson.games || [];
      const filteredGames = games.filter((g: any) => g.id !== gameId);

      if (filteredGames.length < games.length) {
        logger.info(`[INCREMENTAL] Removed game ${gameId} from ${filename}`);
        
        // Update JSON
        existingJson.games = filteredGames;
        existingJson.metadata = this.createMetadata(filteredGames.length);

        // Upload updated JSON
        await this.uploadJson(filename, existingJson);
      } else {
        logger.debug(`[INCREMENTAL] Game ${gameId} not found in ${filename}, nothing to remove`);
      }
    } catch (error: any) {
      if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
        // File doesn't exist - nothing to remove
        logger.debug(`[INCREMENTAL] ${filename} doesn't exist, nothing to remove`);
        return;
      }
      throw error;
    }
  }
}

export const jsonCdnService = new JsonCdnService();
