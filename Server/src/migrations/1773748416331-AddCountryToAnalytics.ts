import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCountryToAnalytics1773748416331 implements MigrationInterface {
    name = 'AddCountryToAnalytics1773748416331'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "game_proposals" DROP CONSTRAINT "FK_previous_proposal"`);
        await queryRunner.query(`DROP INDEX "public"."idx_games_title_trgm"`);
        await queryRunner.query(`DROP INDEX "public"."idx_games_description_trgm"`);
        await queryRunner.query(`DROP INDEX "public"."idx_games_metadata_gin"`);
        await queryRunner.query(`ALTER TABLE "internal"."analytics" ADD "country" character varying(100)`);
        await queryRunner.query(`CREATE INDEX "IDX_d280c0f05b380bf047a7feb1e0" ON "internal"."analytics" ("country") `);
        await queryRunner.query(`ALTER TABLE "game_proposals" ADD CONSTRAINT "FK_839c047609e2489314c4923cc63" FOREIGN KEY ("previousProposalId") REFERENCES "game_proposals"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "game_proposals" DROP CONSTRAINT "FK_839c047609e2489314c4923cc63"`);
        await queryRunner.query(`DROP INDEX "internal"."IDX_d280c0f05b380bf047a7feb1e0"`);
        await queryRunner.query(`ALTER TABLE "internal"."analytics" DROP COLUMN "country"`);
        await queryRunner.query(`CREATE INDEX "idx_games_metadata_gin" ON "games" ("metadata") `);
        await queryRunner.query(`CREATE INDEX "idx_games_description_trgm" ON "games" ("description") `);
        await queryRunner.query(`CREATE INDEX "idx_games_title_trgm" ON "games" ("title") `);
        await queryRunner.query(`ALTER TABLE "game_proposals" ADD CONSTRAINT "FK_previous_proposal" FOREIGN KEY ("previousProposalId") REFERENCES "game_proposals"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

}
