import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSeoMetaToGames1778000000000 implements MigrationInterface {
    name = 'AddSeoMetaToGames1778000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "games" ADD "seoMeta" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "games" DROP COLUMN "seoMeta"`);
    }

}
