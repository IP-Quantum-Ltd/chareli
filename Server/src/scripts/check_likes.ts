import 'dotenv/config';
import { AppDataSource } from '../config/database';
import { Game } from '../entities/Games';

const checkLikes = async () => {
  try {
    await AppDataSource.initialize();

    // Fetch 5 active games
    const games = await AppDataSource.getRepository(Game).find({
      take: 5,
      order: { createdAt: 'DESC' },
      select: ['id', 'title', 'baseLikeCount', 'lastLikeIncrement', 'createdAt', 'config']
    });

    console.log('--- Checking Game Likes Data ---');
    console.log(`Current Time: ${new Date().toISOString()}`);

// Replicate the logic from gameController.ts
const calculateLikeCount = (game: any, userLikesCount: number = 0): number => {
  const now = new Date();
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

  console.log(`Debug: Days=${daysElapsed}, AutoInc=${autoIncrement}`);
  return game.baseLikeCount + autoIncrement + userLikesCount;
};

    games.forEach(game => {
      console.log(`\nGame: ${game.title} (${game.id})`);
      console.log(`Base Likes: ${game.baseLikeCount}`);
      console.log(`Last Increment: ${game.lastLikeIncrement}`);
      console.log(`Created At: ${game.createdAt}`);

      const calculatedTimestamp = calculateLikeCount(game);
      console.log(`Calculated Likes (User=0): ${calculatedTimestamp}`);
    });

    await AppDataSource.destroy();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

checkLikes();
