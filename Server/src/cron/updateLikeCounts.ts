import { AppDataSource } from '../config/database';
import { GameLikeCache } from '../entities/GameLikeCache';
import { Game } from '../entities/Games';
import { GameLike } from '../entities/GameLike';
import { calculateLikeCount } from '../utils/gameUtils';
import logger from '../utils/logger';

const gameLikeCacheRepository = AppDataSource.getRepository(GameLikeCache);
const gameRepository = AppDataSource.getRepository(Game);
const gameLikeRepository = AppDataSource.getRepository(GameLike);

/**
 * Daily cron job to update cached like counts
 * Eliminates CPU-intensive calculateLikeCount() calls
 */
export async function updateLikeCounts(): Promise<void> {
  try {
    logger.info('[Cron] Starting daily like count cache update...');

    // Get all games
    const games = await gameRepository.find({
      select: ['id', 'baseLikeCount', 'lastLikeIncrement'],
    });

    let updated = 0;
    let created = 0;

    for (const game of games) {

      // Fetch user likes
      const userLikesCount = await gameLikeRepository.count({
        where: { gameId: game.id },
      });

      const cachedLikeCount = calculateLikeCount(game, userLikesCount);

      // Upsert cache entry
      let cacheEntry = await gameLikeCacheRepository.findOne({
        where: { gameId: game.id },
      });

      if (cacheEntry) {
        cacheEntry.cachedLikeCount = cachedLikeCount;
        await gameLikeCacheRepository.save(cacheEntry);
        updated++;
      } else {
        cacheEntry = gameLikeCacheRepository.create({
          gameId: game.id,
          cachedLikeCount,
        });
        await gameLikeCacheRepository.save(cacheEntry);
        created++;
      }
    }

    logger.info(
      `[Cron] Like count cache update complete: ${created} created, ${updated} updated`
    );
  } catch (error) {
    logger.error('[Cron] Failed to update like count cache:', error);
    throw error;
  }
}
