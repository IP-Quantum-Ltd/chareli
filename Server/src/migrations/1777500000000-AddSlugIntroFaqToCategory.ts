import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSlugIntroFaqToCategory1777500000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "categories"
      ADD COLUMN "slug" varchar,
      ADD COLUMN "introText" text,
      ADD COLUMN "faqAnswers" jsonb
    `);

    await queryRunner.query(`
      UPDATE "categories"
      SET "slug" = TRIM(BOTH '-' FROM LOWER(
          REGEXP_REPLACE(
              REGEXP_REPLACE(
                  REGEXP_REPLACE(name, '[^a-zA-Z0-9\\\\s-]', '', 'g'),
                  '\\\\s+', '-', 'g'
              ),
              '-+', '-', 'g'
          )
      ))
    `);

    await queryRunner.query(`
      WITH numbered AS (
          SELECT
              id,
              slug,
              ROW_NUMBER() OVER (PARTITION BY slug ORDER BY "createdAt") as rn
          FROM categories
      )
      UPDATE categories
      SET slug = numbered.slug || '-' || numbered.rn
      FROM numbered
      WHERE categories.id = numbered.id
      AND numbered.rn > 1
    `);

    await queryRunner.query(`
      ALTER TABLE "categories"
      ALTER COLUMN "slug" SET NOT NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_categories_slug" ON "categories" ("slug")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_categories_slug"`);
    await queryRunner.query(`
      ALTER TABLE "categories"
      DROP COLUMN "slug",
      DROP COLUMN "introText",
      DROP COLUMN "faqAnswers"
    `);
  }
}
