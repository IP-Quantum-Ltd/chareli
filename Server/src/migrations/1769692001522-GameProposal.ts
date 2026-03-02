import { MigrationInterface, QueryRunner } from "typeorm";

export class GameProposal1769692001522 implements MigrationInterface {
    name = 'GameProposal1769692001522'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "game_proposals" CASCADE`);
        await queryRunner.query(`DROP TYPE IF EXISTS "public"."game_proposals_type_enum" CASCADE`);
        await queryRunner.query(`DROP TYPE IF EXISTS "public"."game_proposals_status_enum" CASCADE`);

        await queryRunner.query(`CREATE TYPE "public"."game_proposals_type_enum" AS ENUM('create', 'update')`);
        await queryRunner.query(`CREATE TYPE "public"."game_proposals_status_enum" AS ENUM('pending', 'approved', 'declined')`);
        await queryRunner.query(`CREATE TABLE "game_proposals" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "type" "public"."game_proposals_type_enum" NOT NULL DEFAULT 'update', "gameId" uuid, "editorId" uuid NOT NULL, "status" "public"."game_proposals_status_enum" NOT NULL DEFAULT 'pending', "proposedData" jsonb NOT NULL, "adminFeedback" text, "reviewedBy" uuid, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_7123b52178d8995e564ac4f9ee8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_83285bbe493dc7e4fe2cd59812" ON "game_proposals" ("editorId") `);
        await queryRunner.query(`CREATE INDEX "IDX_e3b7f6eff8de5ffd84260f9273" ON "game_proposals" ("status") `);
        await queryRunner.query(`ALTER TABLE "game_proposals" ADD CONSTRAINT "FK_081b4f7e8a231a9a199662f2cc0" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "game_proposals" ADD CONSTRAINT "FK_83285bbe493dc7e4fe2cd598120" FOREIGN KEY ("editorId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "game_proposals" ADD CONSTRAINT "FK_d045bcc80f0c01dfb9d2ec756c0" FOREIGN KEY ("reviewedBy") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "game_proposals" DROP CONSTRAINT "FK_d045bcc80f0c01dfb9d2ec756c0"`);
        await queryRunner.query(`ALTER TABLE "game_proposals" DROP CONSTRAINT "FK_83285bbe493dc7e4fe2cd598120"`);
        await queryRunner.query(`ALTER TABLE "game_proposals" DROP CONSTRAINT "FK_081b4f7e8a231a9a199662f2cc0"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e3b7f6eff8de5ffd84260f9273"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_83285bbe493dc7e4fe2cd59812"`);
        await queryRunner.query(`DROP TABLE "game_proposals"`);
        await queryRunner.query(`DROP TYPE "public"."game_proposals_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."game_proposals_type_enum"`);
    }

}
