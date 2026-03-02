import { AppDataSource } from '../config/database';
import { redisService } from '../services/redis.service';
import { cacheService } from '../services/cache.service';
import { Game, GameStatus } from '../entities/Games';
import { GameLike } from '../entities/GameLike';
import { calculateLikeCount } from '../utils/gameUtils';
import logger from '../utils/logger';

const gameRepository = AppDataSource.getRepository(Game);
const gameLikeRepository = AppDataSource.getRepository(GameLike);

/**
 * Cache warming script
 * Pre-populates Redis cache with frequently accessed data
 * Run this after deployment to eliminate cold start delays
 */
async function warmCache() {
  try {
    logger.info('[Cache Warming] Starting cache warm-up...');

    // Initialize connections
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
      logger.info('[Cache Warming] Database connected');
    }

    if (
      !redisService.getClient().status ||
      redisService.getClient().status !== 'ready'
    ) {
      await redisService.connect();
      logger.info('[Cache Warming] Redis connected');
    }

    // 1. Warm recently added games
    logger.info('[Cache Warming] Loading recently added games...');
    const recentGames = await gameRepository.find({
      where: { status: GameStatus.ACTIVE },
      relations: ['category', 'thumbnailFile', 'gameFile'],
      order: { createdAt: 'DESC' },
      take: 20,
    });
    logger.info(`[Cache Warming] Loaded ${recentGames.length} recent games`);

    // 2. Warm popular games
    logger.info('[Cache Warming] Loading popular games...');
    const popularGames = await gameRepository.find({
      where: { status: GameStatus.ACTIVE },
      relations: ['category', 'thumbnailFile', 'gameFile'],
      order: { position: 'ASC' },
      take: 20,
    });
    logger.info(`[Cache Warming] Loaded ${popularGames.length} popular games`);

    // 3. Cache individual top games
    logger.info('[Cache Warming] Caching individual game details...');
    for (const game of popularGames.slice(0, 10)) {
      // Calculate like count safely
      let userLikesCount = 0;
      try {
        userLikesCount = await gameLikeRepository.count({
          where: { gameId: game.id },
        });
      } catch (err) {
        logger.warn(
          `[Cache Warming] Failed to fetch user likes for game ${game.id}, assuming 0`
        );
      }

      const likeCount = calculateLikeCount(game, userLikesCount);

      const gameWithLikes = {
        ...game,
        likeCount,
        hasLiked: false, // Default for public cache
        similarGames: [], // Note: similarGames are not populated in warmCache currently
      };

      await cacheService.setGameById(game.id, gameWithLikes);
      await cacheService.setGameById(game.slug, gameWithLikes); // Cache by slug too
    }
    logger.info('[Cache Warming] Cached 10 top game details');

    // 4. Pre-warm like counts from Redis (Verification)
    logger.info('[Cache Warming] Checking like counts...');
    let likesWarmed = 0;
    for (const game of popularGames.slice(0, 10)) {
      // We also want to ensure the specific GameLikeCache count is warmed if used elsewhere,
      // but the main issue was the Game object cache.
      const likeCount = await redisService.getGameLikeCount(game.id);
      if (likeCount > 0) {
        likesWarmed++;
      }
    }
    logger.info(`[Cache Warming] Verified ${likesWarmed} like counts`);

    logger.info('[Cache Warming] ✓ Cache warm-up completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('[Cache Warming] Failed:', error);
    process.exit(1);
  }
}

// Run cache warming
warmCache();
