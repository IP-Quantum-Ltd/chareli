import { MigrationInterface, QueryRunner } from "typeorm";

export class RevisionWorkflow1770400000000 implements MigrationInterface {
    name = 'RevisionWorkflow1770400000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Add 'superseded' to enum
        // Note: ALTER TYPE ADD VALUE cannot be rolled back
        await queryRunner.query(`ALTER TYPE "public"."game_proposals_status_enum" ADD VALUE IF NOT EXISTS 'superseded'`);

        // Add previousProposalId column and FK
        await queryRunner.query(`ALTER TABLE "game_proposals" ADD "previousProposalId" uuid`);
        await queryRunner.query(`ALTER TABLE "game_proposals" ADD CONSTRAINT "FK_previous_proposal" FOREIGN KEY ("previousProposalId") REFERENCES "game_proposals"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "game_proposals" DROP CONSTRAINT "FK_previous_proposal"`);
        await queryRunner.query(`ALTER TABLE "game_proposals" DROP COLUMN "previousProposalId"`);
        // Cannot remove enum value easily
    }
}
