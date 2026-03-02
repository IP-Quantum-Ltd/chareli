import { AppDataSource } from '../config/database';
import { Analytics } from '../entities/Analytics';
import { SignupAnalytics } from '../entities/SignupAnalytics';
import logger from '../utils/logger';

/**
 * Script to clear all analytics data from the database
 * This will delete all records from:
 * - internal.analytics
 * - internal.signup_analytics
 *
 * WARNING: This operation is irreversible!
 */

async function clearAnalyticsData() {
  try {
    // Initialize database connection
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
      logger.info('Database connection established');
    }

    const analyticsRepository = AppDataSource.getRepository(Analytics);
    const signupAnalyticsRepository = AppDataSource.getRepository(SignupAnalytics);

    // Get current counts before deletion
    const analyticsCountBefore = await analyticsRepository.count();
    const signupAnalyticsCountBefore = await signupAnalyticsRepository.count();

    logger.info('='.repeat(60));
    logger.info('BEFORE DELETION:');
    logger.info(`  Analytics records: ${analyticsCountBefore}`);
    logger.info(`  Signup Analytics records: ${signupAnalyticsCountBefore}`);
    logger.info('='.repeat(60));

    // Delete all analytics records
    logger.info('Deleting all analytics records...');
    await analyticsRepository
      .createQueryBuilder()
      .delete()
      .from(Analytics)
      .execute();

    // Delete all signup analytics records
    logger.info('Deleting all signup analytics records...');
    await signupAnalyticsRepository
      .createQueryBuilder()
      .delete()
      .from(SignupAnalytics)
      .execute();

    // Verify deletion
    const analyticsCountAfter = await analyticsRepository.count();
    const signupAnalyticsCountAfter = await signupAnalyticsRepository.count();

    logger.info('='.repeat(60));
    logger.info('AFTER DELETION:');
    logger.info(`  Analytics records: ${analyticsCountAfter}`);
    logger.info(`  Signup Analytics records: ${signupAnalyticsCountAfter}`);
    logger.info('='.repeat(60));

    if (analyticsCountAfter === 0 && signupAnalyticsCountAfter === 0) {
      logger.info('✅ Successfully cleared all analytics data!');
      logger.info(`   Deleted ${analyticsCountBefore} analytics records`);
      logger.info(`   Deleted ${signupAnalyticsCountBefore} signup analytics records`);
    } else {
      logger.warn('⚠️  Some records may not have been deleted');
    }

    // Close database connection
    await AppDataSource.destroy();
    logger.info('Database connection closed');

  } catch (error) {
    logger.error('Error clearing analytics data:', error);
    process.exit(1);
  }
}

// Run the script
clearAnalyticsData()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Fatal error:', error);
    process.exit(1);
  });
