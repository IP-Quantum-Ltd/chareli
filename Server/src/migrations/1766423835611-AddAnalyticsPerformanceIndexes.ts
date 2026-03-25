import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAnalyticsPerformanceIndexes1766423835611
  implements MigrationInterface
{
  name = 'AddAnalyticsPerformanceIndexes1766423835611';

  // Disable transaction for this migration to allow CREATE INDEX CONCURRENTLY
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Release the transaction if we're in one
    if (queryRunner.isTransactionActive) {
      await queryRunner.commitTransaction();
    }

    // Add indexes to analytics table for performance optimization
    // Using CONCURRENTLY to avoid locking tables (safe for production)
    // Using quoted column names for camelCase (TypeORM default)

    // Index for date range queries (most common filter)
    await queryRunner.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_created_at
       ON internal.analytics("createdAt" DESC)`
    );

    // Composite index for user-specific queries with date ordering
    await queryRunner.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_user_id_created_at
       ON internal.analytics(user_id, "createdAt" DESC)`
    );

    // Composite index for game-specific queries with date ordering
    await queryRunner.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_game_id_created_at
       ON internal.analytics(game_id, "createdAt" DESC)
       WHERE game_id IS NOT NULL`
    );

    // Index for activity type filtering
    await queryRunner.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_activity_type
       ON internal.analytics("activityType")
       WHERE "activityType" IS NOT NULL`
    );

    // Index for duration filtering (30+ seconds games)
    await queryRunner.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_duration
       ON internal.analytics(duration)
       WHERE duration IS NOT NULL AND duration >= 30`
    );

    // Index for start_time queries (used in time played calculations)
    await queryRunner.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_start_time
       ON internal.analytics("startTime" DESC)
       WHERE "startTime" IS NOT NULL`
    );

    // Composite index for signup analytics
    await queryRunner.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_signup_analytics_created_at_type
       ON public.signup_analytics("createdAt" DESC, type)`
    );

    // Index for signup analytics session tracking
    await queryRunner.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_signup_analytics_session_id
       ON public.signup_analytics("sessionId")
       WHERE "sessionId" IS NOT NULL`
    );

    // Start a new transaction for subsequent migrations
    await queryRunner.startTransaction();
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Release the transaction if we're in one
    if (queryRunner.isTransactionActive) {
      await queryRunner.commitTransaction();
    }

    // Drop all indexes in reverse order
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS public.idx_signup_analytics_session_id`
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS public.idx_signup_analytics_created_at_type`
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS internal.idx_analytics_start_time`
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS internal.idx_analytics_duration`
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS internal.idx_analytics_activity_type`
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS internal.idx_analytics_game_id_created_at`
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS internal.idx_analytics_user_id_created_at`
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS internal.idx_analytics_created_at`
    );

    // Start a new transaction for subsequent migrations
    await queryRunner.startTransaction();
  }
}
