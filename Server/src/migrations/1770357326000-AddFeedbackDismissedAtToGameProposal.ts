import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFeedbackDismissedAtToGameProposal1770357326000 implements MigrationInterface {
  name = 'AddFeedbackDismissedAtToGameProposal1770357326000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "game_proposals"
      ADD COLUMN "feedbackDismissedAt" TIMESTAMP NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "game_proposals"
      DROP COLUMN "feedbackDismissedAt"
    `);
  }
}
