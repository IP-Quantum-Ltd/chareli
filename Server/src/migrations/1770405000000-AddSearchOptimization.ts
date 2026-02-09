import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSearchOptimization1770405000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Enable pg_trgm extension (requires superuser or allowlist on some platforms)
    // Most managed Postgres services (Supabase, RDS) allow this.
    // IF NOT EXISTS ensures it doesn't fail if already enabled.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);

    // 2. Add GIN index for Title (Trigram based fuzzy search)
    // This allows ILIKE '%term%' queries to be indexed
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_games_title_trgm
      ON games
      USING gin (title gin_trgm_ops);
    `);

    // 3. Add GIN index for Description (Trigram based fuzzy search)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_games_description_trgm
      ON games
      USING gin (description gin_trgm_ops);
    `);

    // 4. Add GIN index for Metadata (JSONB)
    // Allows fast searching within the JSON structure
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_games_metadata_gin
      ON games
      USING gin (metadata);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 1. Drop indexes
    await queryRunner.query(`DROP INDEX IF EXISTS idx_games_metadata_gin;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_games_description_trgm;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_games_title_trgm;`);

    // 2. Drop extension (Optional: usually better to leave extensions enabled)
    // await queryRunner.query(\`DROP EXTENSION IF EXISTS pg_trgm;\`);
  }
}
