import { MigrationInterface, QueryRunner } from "typeorm";

export class MakeAnalyticsStartTimeToNull1747407887484 implements MigrationInterface {
    name = 'MakeAnalyticsStartTimeToNull1747407887484'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE internal.analytics ALTER COLUMN "startTime" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE internal.analytics ALTER COLUMN "sessionCount" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE internal.analytics ALTER COLUMN "sessionCount" DROP DEFAULT`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE internal.analytics ALTER COLUMN "sessionCount" SET DEFAULT '1'`);
        await queryRunner.query(`ALTER TABLE internal.analytics ALTER COLUMN "sessionCount" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE internal.analytics ALTER COLUMN "startTime" SET NOT NULL`);
    }

}
