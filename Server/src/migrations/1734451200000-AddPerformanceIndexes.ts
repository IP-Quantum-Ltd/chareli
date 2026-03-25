import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPerformanceIndexes1734451200000 implements MigrationInterface {
  name = 'AddPerformanceIndexes1734451200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Ensure internal schema exists
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS internal`);

    // Check if analytics table exists in internal schema
    const analyticsTableExists = await queryRunner.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'internal'
        AND table_name = 'analytics'
      );
    `);

    // Only create analytics index if the table exists in internal schema
    if (analyticsTableExists[0].exists) {
      // Analytics composite index for dashboard queries (userId, activityType, startTime)
      await queryRunner.query(`
        CREATE INDEX IF NOT EXISTS "idx_analytics_user_activity_time"
        ON "internal"."analytics" ("user_id", "activityType", "startTime" DESC)
      `);
    }

    // Only create games indexes if the table exists
    const gamesTableExists = await queryRunner.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'games'
      );
    `);

    if (gamesTableExists[0].exists) {
      // Games composite index for recently added filter (status, createdAt)
      await queryRunner.query(`
        CREATE INDEX IF NOT EXISTS "idx_games_status_created"
        ON "games" ("status", "createdAt" DESC)
        WHERE status = 'active'
      `);

      // Games position index for popular games ordering
      await queryRunner.query(`
        CREATE INDEX IF NOT EXISTS "idx_games_position"
        ON "games" ("position")
        WHERE status = 'active' AND position IS NOT NULL
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_analytics_user_activity_time"'
    );
    await queryRunner.query('DROP INDEX IF EXISTS "idx_games_status_created"');
    await queryRunner.query('DROP INDEX IF EXISTS "idx_games_position"');
  }
}
