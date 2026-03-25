import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddImageVariantsToFiles1766655486098
  implements MigrationInterface
{
  name = 'AddImageVariantsToFiles1766655486098';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // On fresh databases, signup_analytics and otps may still be in public schema
    // (MoveTablesInternalSchema ran as no-op before these tables existed)
    const signupAnalyticsInPublic = await queryRunner.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'signup_analytics'
      );
    `);
    if (signupAnalyticsInPublic[0].exists) {
      await queryRunner.query(`ALTER TABLE public.signup_analytics SET SCHEMA internal`);
    }

    const otpsInPublic = await queryRunner.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'otps'
      );
    `);
    if (otpsInPublic[0].exists) {
      await queryRunner.query(`ALTER TABLE public.otps SET SCHEMA internal`);
    }

    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "internal"."game_like_cache" DROP CONSTRAINT "FK_game_like_cache_game";
      EXCEPTION WHEN undefined_object THEN NULL; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "game_likes" DROP CONSTRAINT "FK_game_likes_game";
      EXCEPTION WHEN undefined_object THEN NULL; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "game_likes" DROP CONSTRAINT "FK_game_likes_user";
      EXCEPTION WHEN undefined_object THEN NULL; END $$;
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."idx_users_roleId"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "internal"."idx_signup_analytics_session_id"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_signup_analytics_session_id"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "internal"."idx_signup_analytics_created_at_type"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_signup_analytics_created_at_type"`
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "internal"."idx_otps_userId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."idx_games_status_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_games_processingStatus"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."idx_games_position"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_games_slug"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."idx_games_createdById"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "internal"."IDX_game_like_cache_gameId"`
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_game_likes_userId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_game_likes_gameId"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_game_likes_userId_gameId"`
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."idx_game_likes_userId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."idx_game_likes_gameId"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "internal"."idx_analytics_user_activity_time"`
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "internal"."idx_analytics_created_at"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "internal"."idx_analytics_user_id_created_at"`
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "internal"."idx_analytics_session_id"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "internal"."idx_analytics_session_activity_time"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "internal"."idx_analytics_game_id_created_at"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "internal"."idx_analytics_activity_type"`
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "internal"."idx_analytics_duration"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "internal"."idx_analytics_start_time"`);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "game_likes" DROP CONSTRAINT "UQ_game_likes_user_game";
      EXCEPTION WHEN undefined_object THEN NULL; END $$;
    `);
    await queryRunner.query(`ALTER TABLE "files" ADD "variants" jsonb`);
    await queryRunner.query(`ALTER TABLE "files" ADD "dimensions" jsonb`);
    await queryRunner.query(
      `ALTER TABLE "files" ADD "isProcessed" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(`ALTER TABLE "files" ADD "processingError" text`);
    await queryRunner.query(`ALTER TABLE "internal"."otps" DROP COLUMN "type"`);
    await queryRunner.query(
      `CREATE TYPE "internal"."otps_type_enum" AS ENUM('EMAIL', 'SMS', 'NONE')`
    );
    await queryRunner.query(
      `ALTER TABLE "internal"."otps" ADD "type" "internal"."otps_type_enum" NOT NULL DEFAULT 'SMS'`
    );
    await queryRunner.query(
      `ALTER TABLE "games" ADD CONSTRAINT "UQ_095bbaa4f028fa5a03e37f631d6" UNIQUE ("slug")`
    );
    await queryRunner.query(
      `ALTER TABLE "games" ALTER COLUMN "baseLikeCount" SET NOT NULL`
    );
    await queryRunner.query(
      `ALTER TABLE "games" ALTER COLUMN "lastLikeIncrement" SET NOT NULL`
    );
    await queryRunner.query(
      `ALTER TABLE "games" ALTER COLUMN "lastLikeIncrement" SET DEFAULT now()`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_11e3dc2ba757a8748f1ea1eaaf" ON "files" ("isProcessed") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_095bbaa4f028fa5a03e37f631d" ON "games" ("slug") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_24805e7cc210f3568aa8d99ceb" ON "games" ("processingStatus") `
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_9acb847e58c6eb35eac791c210" ON "internal"."game_like_cache" ("gameId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1302de71387453c6e6b60a432b" ON "game_likes" ("userId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d034f3cd3faa3c74b7dfee9531" ON "game_likes" ("gameId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_82a98efd505cbfac70c27abd0c" ON "game_likes" ("userId", "gameId") `
    );
    // Ensure session_id column exists on internal.analytics (may be missing on fresh DBs
    // where AddAnonymousAnalytics ran as a no-op before the table was created)
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'internal' AND table_name = 'analytics' AND column_name = 'session_id'
        ) THEN
          ALTER TABLE internal.analytics ALTER COLUMN "user_id" DROP NOT NULL;
          ALTER TABLE internal.analytics ADD COLUMN "session_id" VARCHAR(255);
        END IF;
      END $$;
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_c4ad2977cdc3f1771887daa07a" ON "internal"."analytics" ("session_id") `
    );
    await queryRunner.query(
      `ALTER TABLE "game_likes" ADD CONSTRAINT "UQ_82a98efd505cbfac70c27abd0c9" UNIQUE ("userId", "gameId")`
    );
    await queryRunner.query(
      `ALTER TABLE "game_likes" ADD CONSTRAINT "FK_1302de71387453c6e6b60a432b9" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "game_likes" ADD CONSTRAINT "FK_d034f3cd3faa3c74b7dfee95319" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "game_likes" DROP CONSTRAINT "FK_d034f3cd3faa3c74b7dfee95319"`
    );
    await queryRunner.query(
      `ALTER TABLE "game_likes" DROP CONSTRAINT "FK_1302de71387453c6e6b60a432b9"`
    );
    await queryRunner.query(
      `ALTER TABLE "game_likes" DROP CONSTRAINT "UQ_82a98efd505cbfac70c27abd0c9"`
    );
    await queryRunner.query(
      `DROP INDEX "internal"."IDX_c4ad2977cdc3f1771887daa07a"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d034f3cd3faa3c74b7dfee9531"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_82a98efd505cbfac70c27abd0c"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d034f3cd3faa3c74b7dfee9531"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1302de71387453c6e6b60a432b"`
    );
    await queryRunner.query(
      `DROP INDEX "internal"."IDX_9acb847e58c6eb35eac791c210"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_24805e7cc210f3568aa8d99ceb"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_095bbaa4f028fa5a03e37f631d"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_11e3dc2ba757a8748f1ea1eaaf"`
    );
    await queryRunner.query(
      `ALTER TABLE "games" ALTER COLUMN "lastLikeIncrement" SET DEFAULT CURRENT_TIMESTAMP`
    );
    await queryRunner.query(
      `ALTER TABLE "games" ALTER COLUMN "lastLikeIncrement" DROP NOT NULL`
    );
    await queryRunner.query(
      `ALTER TABLE "games" ALTER COLUMN "baseLikeCount" DROP NOT NULL`
    );
    await queryRunner.query(
      `ALTER TABLE "games" DROP CONSTRAINT "UQ_095bbaa4f028fa5a03e37f631d6"`
    );
    await queryRunner.query(`ALTER TABLE "internal"."otps" DROP COLUMN "type"`);
    await queryRunner.query(`DROP TYPE "internal"."otps_type_enum"`);
    await queryRunner.query(
      `ALTER TABLE "internal"."otps" ADD "type" otps_type_enum NOT NULL DEFAULT 'SMS'`
    );
    await queryRunner.query(
      `ALTER TABLE "files" DROP COLUMN "processingError"`
    );
    await queryRunner.query(`ALTER TABLE "files" DROP COLUMN "isProcessed"`);
    await queryRunner.query(`ALTER TABLE "files" DROP COLUMN "dimensions"`);
    await queryRunner.query(`ALTER TABLE "files" DROP COLUMN "variants"`);
    await queryRunner.query(
      `ALTER TABLE "game_likes" ADD CONSTRAINT "UQ_game_likes_user_game" UNIQUE ("userId", "gameId")`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_analytics_start_time" ON "internal"."analytics" ("startTime") WHERE ("startTime" IS NOT NULL)`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_analytics_duration" ON "internal"."analytics" ("duration") WHERE ((duration IS NOT NULL) AND (duration >= 30))`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_analytics_activity_type" ON "internal"."analytics" ("activityType") WHERE ("activityType" IS NOT NULL)`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_analytics_game_id_created_at" ON "internal"."analytics" ("createdAt", "game_id") WHERE (game_id IS NOT NULL)`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_analytics_session_activity_time" ON "internal"."analytics" ("activityType", "session_id", "startTime") `
    );
    await queryRunner.query(
      `CREATE INDEX "idx_analytics_session_id" ON "internal"."analytics" ("session_id") `
    );
    await queryRunner.query(
      `CREATE INDEX "idx_analytics_user_id_created_at" ON "internal"."analytics" ("createdAt", "user_id") `
    );
    await queryRunner.query(
      `CREATE INDEX "idx_analytics_created_at" ON "internal"."analytics" ("createdAt") `
    );
    await queryRunner.query(
      `CREATE INDEX "idx_analytics_user_activity_time" ON "internal"."analytics" ("activityType", "startTime", "user_id") `
    );
    await queryRunner.query(
      `CREATE INDEX "idx_game_likes_gameId" ON "game_likes" ("gameId") `
    );
    await queryRunner.query(
      `CREATE INDEX "idx_game_likes_userId" ON "game_likes" ("userId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_game_likes_userId_gameId" ON "game_likes" ("gameId", "userId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_game_likes_gameId" ON "game_likes" ("gameId") `
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_game_likes_userId" ON "game_likes" ("userId") `
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_game_like_cache_gameId" ON "internal"."game_like_cache" ("gameId") `
    );
    await queryRunner.query(
      `CREATE INDEX "idx_games_createdById" ON "games" ("createdById") `
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_games_slug" ON "games" ("slug") `
    );
    await queryRunner.query(
      `CREATE INDEX "idx_games_position" ON "games" ("position") WHERE ((status = 'active'::games_status_enum) AND ("position" IS NOT NULL))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_games_processingStatus" ON "games" ("processingStatus") `
    );
    await queryRunner.query(
      `CREATE INDEX "idx_games_status_created" ON "games" ("createdAt", "status") WHERE (status = 'active'::games_status_enum)`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_otps_userId" ON "internal"."otps" ("userId") `
    );
    await queryRunner.query(
      `CREATE INDEX "idx_signup_analytics_created_at_type" ON "internal"."signup_analytics" ("createdAt", "type") `
    );
    await queryRunner.query(
      `CREATE INDEX "idx_signup_analytics_session_id" ON "internal"."signup_analytics" ("sessionId") WHERE ("sessionId" IS NOT NULL)`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_users_roleId" ON "users" ("roleId") `
    );
    await queryRunner.query(
      `ALTER TABLE "game_likes" ADD CONSTRAINT "FK_game_likes_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "game_likes" ADD CONSTRAINT "FK_game_likes_game" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "internal"."game_like_cache" ADD CONSTRAINT "FK_game_like_cache_game" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
  }
}
