import { MigrationInterface, QueryRunner } from "typeorm";

export class BackfillAnalyticsDuration1773680632252 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Part 2: Backfill duration for existing records with NULL duration
        // This fixes the 5 existing records that have startTime and endTime but duration = NULL
        await queryRunner.query(`
            UPDATE internal.analytics
            SET duration = EXTRACT(EPOCH FROM ("endTime" - "startTime"))::INTEGER
            WHERE "startTime" IS NOT NULL 
                AND "endTime" IS NOT NULL 
                AND duration IS NULL;
        `);
        
        console.log('✅ Backfilled duration for records with NULL duration');
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // We cannot reliably reverse this migration since we don't know which records
        // originally had NULL duration vs. which were calculated. 
        // This is a data fix migration, so down migration is a no-op.
        console.log('⚠️  Cannot reverse duration backfill migration - this is a data fix');
    }

}
