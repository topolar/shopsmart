import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddOperatorRole20260801171000 implements MigrationInterface {
  name = "AddOperatorRole20260801171000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user"
      ADD COLUMN "role" varchar(16) NOT NULL DEFAULT 'user',
      ADD CONSTRAINT "ck_auth_user_role" CHECK ("role" IN ('user', 'operator'))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" DROP CONSTRAINT "ck_auth_user_role"`,
    );
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "role"`);
  }
}
