import type { MigrationInterface, QueryRunner } from "typeorm";

export class StrengthenAiAssistCacheKey20260801172000 implements MigrationInterface {
  name = "StrengthenAiAssistCacheKey20260801172000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "ai_assist_cache"`);
    await queryRunner.query(`
      ALTER TABLE "ai_assist_cache"
      RENAME COLUMN "task_key" TO "cache_key"
    `);
    await queryRunner.query(`
      ALTER TABLE "ai_assist_cache"
      ALTER COLUMN "cache_key" TYPE varchar(80)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "ai_assist_cache"`);
    await queryRunner.query(`
      ALTER TABLE "ai_assist_cache"
      ALTER COLUMN "cache_key" TYPE varchar(240)
    `);
    await queryRunner.query(`
      ALTER TABLE "ai_assist_cache"
      RENAME COLUMN "cache_key" TO "task_key"
    `);
  }
}
