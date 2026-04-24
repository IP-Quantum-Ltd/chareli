import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIsDiscardedToAnalytics1777000000000 implements MigrationInterface {
  name = 'AddIsDiscardedToAnalytics1777000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "internal"."analytics" ADD "is_discarded" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_analytics_is_discarded" ON "internal"."analytics" ("is_discarded")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "internal"."IDX_analytics_is_discarded"`);
    await queryRunner.query(`ALTER TABLE "internal"."analytics" DROP COLUMN "is_discarded"`);
  }
}
