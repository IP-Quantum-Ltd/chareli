import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMetadataToGames1768923434758 implements MigrationInterface {
    name = 'AddMetadataToGames1768923434758'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "games" ADD "metadata" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "games" DROP COLUMN "metadata"`);
    }

}
