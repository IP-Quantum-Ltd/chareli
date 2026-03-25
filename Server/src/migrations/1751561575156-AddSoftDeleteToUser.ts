import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSoftDeleteToUser1751561575156 implements MigrationInterface {
    name = 'AddSoftDeleteToUser1751561575156'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE internal.analytics DROP CONSTRAINT "FK_478656673247334d8cea26a2c12"`);
        await queryRunner.query(`ALTER TABLE "users" ADD "isDeleted" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "users" ADD "deletedAt" TIMESTAMP`);
        await queryRunner.query(`CREATE INDEX "IDX_fb21a8f1ce1641e7328f36968b" ON "users" ("isDeleted") `);
        await queryRunner.query(`ALTER TABLE internal.analytics ADD CONSTRAINT "FK_478656673247334d8cea26a2c12" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE internal.analytics DROP CONSTRAINT "FK_478656673247334d8cea26a2c12"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fb21a8f1ce1641e7328f36968b"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "deletedAt"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "isDeleted"`);
        await queryRunner.query(`ALTER TABLE internal.analytics ADD CONSTRAINT "FK_478656673247334d8cea26a2c12" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

}
