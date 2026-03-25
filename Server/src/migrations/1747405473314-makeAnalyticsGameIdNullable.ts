import { MigrationInterface, QueryRunner } from "typeorm";

export class MakeAnalyticsGameIdNullable1747405473314 implements MigrationInterface {
    name = 'MakeAnalyticsGameIdNullable1747405473314'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE internal.analytics DROP CONSTRAINT "FK_4f7871dcb8adbefbf70aec5193b"`);
        await queryRunner.query(`ALTER TABLE internal.analytics ALTER COLUMN "game_id" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE internal.analytics ADD CONSTRAINT "FK_4f7871dcb8adbefbf70aec5193b" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE internal.analytics DROP CONSTRAINT "FK_4f7871dcb8adbefbf70aec5193b"`);
        await queryRunner.query(`ALTER TABLE internal.analytics ALTER COLUMN "game_id" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE internal.analytics ADD CONSTRAINT "FK_4f7871dcb8adbefbf70aec5193b" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

}
