import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDatabaseIndexesOptimization1750938360582 implements MigrationInterface {
    name = 'AddDatabaseIndexesOptimization1750938360582'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE internal.game_position_history DROP CONSTRAINT "UQ_f8b8b8b8b8b8b8b8b8b8b8b8b8b8"`);
        await queryRunner.query(`CREATE INDEX "IDX_97672ac88f789774dd47f7c8be" ON "users" ("email") `);
        await queryRunner.query(`CREATE INDEX "IDX_1e3d0240b49c40521aaeb95329" ON "users" ("phoneNumber") `);
        await queryRunner.query(`CREATE INDEX "IDX_368e146b785b574f42ae9e53d5" ON "users" ("roleId") `);
        await queryRunner.query(`CREATE INDEX "IDX_409a0298fdd86a6495e23c25c6" ON "users" ("isActive") `);
        await queryRunner.query(`CREATE INDEX "IDX_8c0739137ac934474956898070" ON "users" ("isVerified") `);
        await queryRunner.query(`CREATE INDEX "IDX_9913fbe7e2289ad82de8e7051d" ON "users" ("lastSeen") `);
        await queryRunner.query(`CREATE INDEX "IDX_3261633dee926d1bd77d145829" ON "users" ("roleId", "isActive") `);
        await queryRunner.query(`CREATE INDEX "IDX_faefff31ab57b7abe3f0a30058" ON "users" ("isActive", "isVerified") `);
        await queryRunner.query(`CREATE INDEX "IDX_8b0be371d28245da6e4f4b6187" ON "categories" ("name") `);
        await queryRunner.query(`CREATE INDEX "IDX_43bf08375ae7bfae7d55bc3a0c" ON "categories" ("createdAt") `);
        await queryRunner.query(`CREATE INDEX "IDX_bbb0f2912c320f6b76e04091e3" ON "files" ("type") `);
        await queryRunner.query(`CREATE INDEX "IDX_2901752f1d771f97a8bb45cb4c" ON "files" ("createdAt") `);
        await queryRunner.query(`CREATE INDEX "IDX_05318b3cbff2443bd581093bcb" ON "games" ("status") `);
        await queryRunner.query(`CREATE INDEX "IDX_d32b1cc688490c835546ccf230" ON "games" ("categoryId") `);
        await queryRunner.query(`CREATE INDEX "IDX_1f493134f8ca4ab276efa0ab78" ON "games" ("createdById") `);
        await queryRunner.query(`CREATE INDEX "IDX_73ae40f6da39f9c3855274cf50" ON "games" ("createdAt") `);
        await queryRunner.query(`CREATE INDEX "IDX_5b313c81b0d8933c6eb305d51f" ON "games" ("createdById", "status") `);
        await queryRunner.query(`CREATE INDEX "IDX_12eade4cf935b07627e6279b25" ON "games" ("status", "createdAt") `);
        await queryRunner.query(`CREATE INDEX "IDX_76df000fa8a9a923e4057a06ae" ON "games" ("categoryId", "status") `);
        await queryRunner.query(`CREATE INDEX "IDX_0080d07e0a4751b0bbd73ab57a" ON "games" ("status", "position") `);
        await queryRunner.query(`CREATE INDEX "IDX_1e5775e6c81ecc65fc08ca9d8f" ON internal.game_position_history ("position") `);
        await queryRunner.query(`CREATE INDEX "IDX_c2ca6f2a73d4d64027b724e164" ON internal.game_position_history ("clickCount") `);
        await queryRunner.query(`CREATE INDEX "IDX_d1cc9917abac731106bf4b08be" ON internal.game_position_history ("createdAt") `);
        await queryRunner.query(`CREATE INDEX "IDX_03897db66bf54c24a4f398a2d9" ON internal.analytics ("endTime") `);
        await queryRunner.query(`CREATE INDEX "IDX_9e668bc1d010e44c3f5bb4d1ec" ON internal.analytics ("duration") `);
        await queryRunner.query(`CREATE INDEX "IDX_7439e9bec6e0828a17fb92b1e0" ON internal.analytics ("createdAt") `);
        await queryRunner.query(`CREATE INDEX "IDX_30e58d36a65c827349cef736b9" ON internal.analytics ("user_id", "game_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_9caf158d14efbad90cc8237b4d" ON internal.analytics ("activityType", "startTime") `);
        await queryRunner.query(`CREATE INDEX "IDX_1036877e2937d93f35e30a3156" ON internal.analytics ("user_id", "startTime") `);
        await queryRunner.query(`CREATE INDEX "IDX_4d1c71d7756b90593523f1197d" ON internal.analytics ("game_id", "startTime") `);
        await queryRunner.query(`CREATE INDEX "IDX_8360c0f760326c9009c94a106a" ON internal.analytics ("user_id", "activityType") `);
        await queryRunner.query(`ALTER TABLE internal.game_position_history ADD CONSTRAINT "UQ_8f08005686bdf9eb998174a9ad8" UNIQUE ("gameId", "position")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE internal.game_position_history DROP CONSTRAINT "UQ_8f08005686bdf9eb998174a9ad8"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8360c0f760326c9009c94a106a"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4d1c71d7756b90593523f1197d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1036877e2937d93f35e30a3156"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9caf158d14efbad90cc8237b4d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_30e58d36a65c827349cef736b9"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7439e9bec6e0828a17fb92b1e0"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9e668bc1d010e44c3f5bb4d1ec"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_03897db66bf54c24a4f398a2d9"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d1cc9917abac731106bf4b08be"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c2ca6f2a73d4d64027b724e164"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1e5775e6c81ecc65fc08ca9d8f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0080d07e0a4751b0bbd73ab57a"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_76df000fa8a9a923e4057a06ae"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_12eade4cf935b07627e6279b25"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5b313c81b0d8933c6eb305d51f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_73ae40f6da39f9c3855274cf50"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1f493134f8ca4ab276efa0ab78"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d32b1cc688490c835546ccf230"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_05318b3cbff2443bd581093bcb"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2901752f1d771f97a8bb45cb4c"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_bbb0f2912c320f6b76e04091e3"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_43bf08375ae7bfae7d55bc3a0c"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8b0be371d28245da6e4f4b6187"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_faefff31ab57b7abe3f0a30058"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3261633dee926d1bd77d145829"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9913fbe7e2289ad82de8e7051d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8c0739137ac934474956898070"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_409a0298fdd86a6495e23c25c6"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_368e146b785b574f42ae9e53d5"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1e3d0240b49c40521aaeb95329"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_97672ac88f789774dd47f7c8be"`);
        await queryRunner.query(`ALTER TABLE internal.game_position_history ADD CONSTRAINT "UQ_f8b8b8b8b8b8b8b8b8b8b8b8b8b8" UNIQUE ("gameId", "position")`);
    }

}
