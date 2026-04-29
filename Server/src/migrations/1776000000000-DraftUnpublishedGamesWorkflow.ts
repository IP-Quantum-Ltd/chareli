import { MigrationInterface, QueryRunner } from 'typeorm';

export class DraftUnpublishedGamesWorkflow1776000000000
  implements MigrationInterface
{
  name = 'DraftUnpublishedGamesWorkflow1776000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "games" ADD "publishedAt" TIMESTAMP`
    );

    // Backfill: every game that is currently ACTIVE has effectively been live
    // since creation. Seed publishedAt = createdAt so "recent games" ordering
    // and audit queries have a meaningful value from day one.
    await queryRunner.query(
      `UPDATE "games" SET "publishedAt" = "createdAt" WHERE "status" = 'active'`
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_games_publishedAt" ON "games" ("publishedAt")`
    );

    await queryRunner.query(
      `CREATE TYPE "internal"."game_publish_history_action_enum" AS ENUM('published', 'unpublished')`
    );

    await queryRunner.query(
      `CREATE TABLE "internal"."game_publish_history" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "gameId" uuid NOT NULL,
        "action" "internal"."game_publish_history_action_enum" NOT NULL,
        "actorId" uuid,
        "actorRole" character varying(32),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_game_publish_history" PRIMARY KEY ("id")
      )`
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_gph_gameId" ON "internal"."game_publish_history" ("gameId")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_gph_createdAt" ON "internal"."game_publish_history" ("createdAt")`
    );

    await queryRunner.query(
      `ALTER TABLE "internal"."game_publish_history"
       ADD CONSTRAINT "FK_gph_game"
       FOREIGN KEY ("gameId") REFERENCES "games"("id")
       ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "internal"."game_publish_history"
       ADD CONSTRAINT "FK_gph_actor"
       FOREIGN KEY ("actorId") REFERENCES "users"("id")
       ON DELETE SET NULL ON UPDATE NO ACTION`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "internal"."game_publish_history" DROP CONSTRAINT "FK_gph_actor"`
    );
    await queryRunner.query(
      `ALTER TABLE "internal"."game_publish_history" DROP CONSTRAINT "FK_gph_game"`
    );
    await queryRunner.query(`DROP INDEX "internal"."IDX_gph_createdAt"`);
    await queryRunner.query(`DROP INDEX "internal"."IDX_gph_gameId"`);
    await queryRunner.query(`DROP TABLE "internal"."game_publish_history"`);
    await queryRunner.query(
      `DROP TYPE "internal"."game_publish_history_action_enum"`
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_games_publishedAt"`);
    await queryRunner.query(`ALTER TABLE "games" DROP COLUMN "publishedAt"`);
  }
}
