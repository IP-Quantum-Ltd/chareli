import { MigrationInterface, QueryRunner } from "typeorm";

export class Phase2AnalyticsSchema1769488032602 implements MigrationInterface {
    name = 'Phase2AnalyticsSchema1769488032602'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "internal"."signup_analytics" ADD "user_id" uuid`);
        await queryRunner.query(`ALTER TABLE "internal"."analytics" ADD "exitReason" character varying(50)`);
        await queryRunner.query(`ALTER TABLE "internal"."analytics" ADD "loadTime" integer`);
        await queryRunner.query(`ALTER TABLE "internal"."analytics" ADD "milestone" character varying(50)`);
        await queryRunner.query(`ALTER TABLE "internal"."analytics" ADD "errorMessage" text`);
        await queryRunner.query(`ALTER TABLE "internal"."analytics" ADD "lastSeenAt" TIMESTAMP NOT NULL DEFAULT now()`);
        await queryRunner.query(`ALTER TABLE "internal"."analytics" ADD "endedAt" TIMESTAMP`);
        await queryRunner.query(`CREATE INDEX "IDX_1f6c793a43f4b6272ac913070b" ON "internal"."signup_analytics" ("user_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_2ee261ba81a47aaffab45673a3" ON "internal"."analytics" ("exitReason") `);
        await queryRunner.query(`CREATE INDEX "IDX_879f7b8ac30fc6ec568aaf8c9b" ON "internal"."analytics" ("lastSeenAt") `);
        await queryRunner.query(`CREATE INDEX "IDX_060f750c57825a3f5322eabda8" ON "internal"."analytics" ("endedAt") `);
        await queryRunner.query(`ALTER TABLE "internal"."signup_analytics" ADD CONSTRAINT "FK_1f6c793a43f4b6272ac913070ba" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "internal"."signup_analytics" DROP CONSTRAINT "FK_1f6c793a43f4b6272ac913070ba"`);
        await queryRunner.query(`DROP INDEX "internal"."IDX_060f750c57825a3f5322eabda8"`);
        await queryRunner.query(`DROP INDEX "internal"."IDX_879f7b8ac30fc6ec568aaf8c9b"`);
        await queryRunner.query(`DROP INDEX "internal"."IDX_2ee261ba81a47aaffab45673a3"`);
        await queryRunner.query(`DROP INDEX "internal"."IDX_1f6c793a43f4b6272ac913070b"`);
        await queryRunner.query(`ALTER TABLE "internal"."analytics" DROP COLUMN "endedAt"`);
        await queryRunner.query(`ALTER TABLE "internal"."analytics" DROP COLUMN "lastSeenAt"`);
        await queryRunner.query(`ALTER TABLE "internal"."analytics" DROP COLUMN "errorMessage"`);
        await queryRunner.query(`ALTER TABLE "internal"."analytics" DROP COLUMN "milestone"`);
        await queryRunner.query(`ALTER TABLE "internal"."analytics" DROP COLUMN "loadTime"`);
        await queryRunner.query(`ALTER TABLE "internal"."analytics" DROP COLUMN "exitReason"`);
        await queryRunner.query(`ALTER TABLE "internal"."signup_analytics" DROP COLUMN "user_id"`);
    }

}
