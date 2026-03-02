import { Game } from '../entities/Games';
import logger from './logger';

/**
 * Calculate current like count for a game based on days elapsed and deterministic random increments
 * Validates system time to prevent calculations during server startup race conditions (e.g. 1970 date)
 *
 * @param game - The game object with baseLikeCount and lastLikeIncrement
 * @param userLikesCount - Number of user likes for this game
 * @returns Current like count (auto-increment + user likes)
 */
export const calculateLikeCount = (game: Game, userLikesCount: number = 0): number => {
  const now = new Date();

  // Guard clause: Prevent calculation if system time is definitely invalid (e.g. 1970, pre-2025)
  // This prevents resetting counts to 100 during server startup race conditions
  if (now.getFullYear() < 2025) {
    logger.warn(`[GameUtils] System time invalid (${now.toISOString()}), skipping auto-increment calculation for game ${game.id}`);
    return game.baseLikeCount + userLikesCount;
  }

  const lastIncrement = new Date(game.lastLikeIncrement);

  // Calculate days elapsed since last increment
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysElapsed = Math.floor(
    (now.getTime() - lastIncrement.getTime()) / msPerDay
  );

  let autoIncrement = 0;
  if (daysElapsed > 0) {
    // Calculate total increment using deterministic random for each day
    for (let day = 1; day <= daysElapsed; day++) {
      // Create deterministic seed from gameId + date
      const incrementDate = new Date(lastIncrement);
      incrementDate.setDate(incrementDate.getDate() + day);
      const dateStr = incrementDate.toISOString().split('T')[0]; // YYYY-MM-DD
      const seed = game.id + dateStr;

      // Simple hash function for deterministic random (1, 2, or 3)
      let hash = 0;
      for (let i = 0; i < seed.length; i++) {
        hash = (hash << 5) - hash + seed.charCodeAt(i);
        hash = hash & hash; // Convert to 32bit integer
      }
      const increment = (Math.abs(hash) % 3) + 1; // 1, 2, or 3
      autoIncrement += increment;
    }
  }

  return game.baseLikeCount + autoIncrement + userLikesCount;
};
