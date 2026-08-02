import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddFirebaseIdentity20260802120000 implements MigrationInterface {
  name = "AddFirebaseIdentity20260802120000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" ADD COLUMN "firebaseUid" text NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_auth_user_firebase_uid"
       ON "user" ("firebaseUid") WHERE "firebaseUid" IS NOT NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "uq_auth_user_firebase_uid"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "firebaseUid"`);
  }
}
