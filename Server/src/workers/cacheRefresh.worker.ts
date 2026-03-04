import { Job } from 'bullmq';
import { CacheRefreshJobData } from '../services/queue.service';
import { AppDataSource } from '../config/database';
import { Game, GameStatus } from '../entities/Games';
import { Analytics } from '../entities/Analytics';
import { cacheService } from '../services/cache.service';
import { storageService } from '../services/storage.service';
import { In } from 'typeorm';
import logger from '../utils/logger';

/**
 * Process cache refresh job
 * Regenerates expensive queries and updates both fresh and stale caches
 */
export async function processCacheRefreshJob(
  job: Job<CacheRefreshJobData>
): Promise<void> {
  const { cacheKey, cacheType } = job.data;

  logger.info(`[CACHE-REFRESH-WORKER] Processing: ${cacheKey}`);
  const startTime = Date.now();

  try {
    if (cacheKey === 'filter:popular') {
      await refreshPopularGamesCache();
    } else {
      logger.warn(`[CACHE-REFRESH-WORKER] Unknown cache key: ${cacheKey}`);
    }

    const duration = Date.now() - startTime;
    logger.info(
      `[CACHE-REFRESH-WORKER] ✅ Successfully refreshed ${cacheKey} in ${duration}ms`
    );
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(
      `[CACHE-REFRESH-WORKER] ❌ Failed to refresh ${cacheKey} after ${duration}ms:`,
      error
    );
    throw error; // Re-throw to trigger BullMQ retry logic
  }
}

/**
 * Refresh popular games cache
 * Runs the expensive analytics query and updates both fresh and stale caches
 */
async function refreshPopularGamesCache(): Promise<void> {
  const gameRepository = AppDataSource.getRepository(Game);

  // Get popular games config to determine mode
  const { SystemConfig } = await import('../entities/SystemConfig');
  const systemConfigRepository = AppDataSource.getRepository(SystemConfig);
  
  const popularConfig = await systemConfigRepository.findOne({
    where: { key: 'popular_games_settings' },
  });

  // Manual mode
  if (popularConfig?.value?.mode === 'manual') {
    let gameIds: string[] = [];
    if (popularConfig.value.selectedGameIds) {
      if (Array.isArray(popularConfig.value.selectedGameIds)) {
        gameIds = popularConfig.value.selectedGameIds;
      } else if (typeof popularConfig.value.selectedGameIds === 'object') {
        gameIds = Object.values(popularConfig.value.selectedGameIds);
      }
    }

    if (gameIds.length > 0) {
      const games = await gameRepository.find({
        where: {
          id: In(gameIds),
          status: GameStatus.ACTIVE,
        },
        relations: ['category', 'thumbnailFile', 'gameFile', 'createdBy'],
        order: { position: 'ASC' },
      });

      const orderedGames = gameIds
        .map((id: string) => games.find((game) => game.id === id))
        .filter((game): game is Game => game !== undefined);

      // Transform URLs
      orderedGames.forEach((game: Game) => {
        if (game.gameFile) {
          game.gameFile.s3Key = storageService.getPublicUrl(game.gameFile.s3Key);
        }
        if (game.thumbnailFile) {
          game.thumbnailFile.s3Key = storageService.getPublicUrl(
            game.thumbnailFile.s3Key
          );
        }
      });

      const responseData = { data: orderedGames };

      // Update BOTH fresh and stale caches
      await cacheService.setGamesList(1, 20, responseData, 'filter:popular', 300); // Fresh: 5 min
      await cacheService.setGamesList(1, 20, responseData, 'filter:popular:stale', 1800); // Stale: 30 min

      logger.info(
        `[CACHE-REFRESH-WORKER] Refreshed manual popular games (${orderedGames.length} games)`
      );
    } else {
      // Empty manual selection
      const responseData = { data: [] };
      await cacheService.setGamesList(1, 20, responseData, 'filter:popular', 300);
      await cacheService.setGamesList(1, 20, responseData, 'filter:popular:stale', 1800);
      
      logger.info('[CACHE-REFRESH-WORKER] Refreshed manual popular games (0 games)');
    }
    return;
  }

  // Auto mode: Analytics-based popularity
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Step 1: Get game IDs and session counts
  const popularityQuery = gameRepository
    .createQueryBuilder('game')
    .select('game.id', 'id')
    .addSelect('COUNT(a.id)', 'session_count')
    .leftJoin(Analytics, 'a', 'a.gameId = game.id')
    .leftJoin('a.user', 'user')
    .leftJoin('user.role', 'role')
    .where('game.status = :status', { status: GameStatus.ACTIVE })
    .andWhere('(a.createdAt >= :startDate OR a.createdAt IS NULL)', {
      startDate: thirtyDaysAgo,
    })
    .andWhere("(role.name = 'player' OR a.userId IS NULL OR a.id IS NULL)")
    .groupBy('game.id')
    .orderBy('session_count', 'DESC')
    .limit(20);

  const rawResults = await popularityQuery.getRawMany();
  const gameIds = rawResults.map((r) => r.id);

  // Step 2: Fetch full game entities
  let games: Game[] = [];
  if (gameIds.length > 0) {
    games = await gameRepository.find({
      where: { id: In(gameIds) },
      relations: ['category', 'thumbnailFile', 'gameFile', 'createdBy'],
    });

    // Step 3: Sort games to match popularity order
    games.sort((a, b) => {
      const indexA = gameIds.indexOf(a.id);
      const indexB = gameIds.indexOf(b.id);
      return indexA - indexB;
    });
  }

  // Transform URLs
  games.forEach((game) => {
    if (game.gameFile) {
      game.gameFile.s3Key = storageService.getPublicUrl(game.gameFile.s3Key);
    }
    if (game.thumbnailFile) {
      game.thumbnailFile.s3Key = storageService.getPublicUrl(game.thumbnailFile.s3Key);
    }
  });

  const totalPages = games.length > 0 ? 1 : 0;
  const responseData = {
    data: games,
    pagination: {
      page: 1,
      limit: games.length,
      total: games.length,
      totalPages,
    },
  };

  // Update BOTH fresh and stale caches
  await cacheService.setGamesList(1, 20, responseData, 'filter:popular', 300); // Fresh: 5 min
  await cacheService.setGamesList(1, 20, responseData, 'filter:popular:stale', 1800); // Stale: 30 min

  logger.info(
    `[CACHE-REFRESH-WORKER] Refreshed auto popular games (${games.length} games)`
  );
}
