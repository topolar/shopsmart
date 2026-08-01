import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateAuthOnboarding20260801120000 implements MigrationInterface {
  name = "CreateAuthOnboarding20260801120000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "user" (
        "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "name" text NOT NULL,
        "email" text NOT NULL,
        "emailVerified" boolean NOT NULL DEFAULT false,
        "image" text NULL,
        "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "tenantId" uuid NOT NULL,
        CONSTRAINT "uq_auth_user_email" UNIQUE ("email"),
        CONSTRAINT "fk_auth_user_tenant" FOREIGN KEY ("tenantId")
          REFERENCES "tenants"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "session" (
        "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "expiresAt" timestamptz NOT NULL,
        "token" text NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "ipAddress" text NULL,
        "userAgent" text NULL,
        "userId" text NOT NULL,
        CONSTRAINT "uq_auth_session_token" UNIQUE ("token"),
        CONSTRAINT "fk_auth_session_user" FOREIGN KEY ("userId")
          REFERENCES "user"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_auth_session_user" ON "session" ("userId")`,
    );
    await queryRunner.query(`
      CREATE TABLE "account" (
        "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "accountId" text NOT NULL,
        "providerId" text NOT NULL,
        "userId" text NOT NULL,
        "accessToken" text NULL,
        "refreshToken" text NULL,
        "idToken" text NULL,
        "accessTokenExpiresAt" timestamptz NULL,
        "refreshTokenExpiresAt" timestamptz NULL,
        "scope" text NULL,
        "password" text NULL,
        "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "fk_auth_account_user" FOREIGN KEY ("userId")
          REFERENCES "user"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_auth_account_user" ON "account" ("userId")`,
    );
    await queryRunner.query(`
      CREATE TABLE "verification" (
        "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "identifier" text NOT NULL,
        "value" text NOT NULL,
        "expiresAt" timestamptz NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "stores" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "retailer_id" uuid NOT NULL,
        "official_name" varchar(240) NOT NULL,
        "city" varchar(120) NOT NULL,
        "source_url" varchar(1000) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "user_profiles" (
        "tenant_id" uuid PRIMARY KEY,
        "user_id" text NOT NULL,
        "locale" varchar(12) NOT NULL,
        "locality" jsonb NOT NULL,
        "online_channel_keys" varchar[] NOT NULL DEFAULT '{}',
        "completed_at" timestamptz NOT NULL,
        "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "uq_user_profiles_user" UNIQUE ("user_id"),
        CONSTRAINT "fk_user_profiles_tenant" FOREIGN KEY ("tenant_id")
          REFERENCES "tenants"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_user_profiles_user" FOREIGN KEY ("user_id")
          REFERENCES "user"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "user_store_access" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "store_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "uq_user_store_access_tenant_store"
          UNIQUE ("tenant_id", "store_id"),
        CONSTRAINT "fk_user_store_access_tenant" FOREIGN KEY ("tenant_id")
          REFERENCES "tenants"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_user_store_access_store" FOREIGN KEY ("store_id")
          REFERENCES "stores"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "loyalty_memberships" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "program_key" varchar(120) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "uq_loyalty_memberships_tenant_program"
          UNIQUE ("tenant_id", "program_key"),
        CONSTRAINT "fk_loyalty_memberships_tenant" FOREIGN KEY ("tenant_id")
          REFERENCES "tenants"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "notification_preferences" (
        "tenant_id" uuid PRIMARY KEY,
        "email_digest_enabled" boolean NOT NULL,
        "locale" varchar(12) NOT NULL,
        "timezone" varchar(80) NOT NULL,
        "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "fk_notification_preferences_tenant"
          FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "notification_preferences"`);
    await queryRunner.query(`DROP TABLE "loyalty_memberships"`);
    await queryRunner.query(`DROP TABLE "user_store_access"`);
    await queryRunner.query(`DROP TABLE "user_profiles"`);
    await queryRunner.query(`DROP TABLE "stores"`);
    await queryRunner.query(`DROP TABLE "verification"`);
    await queryRunner.query(`DROP TABLE "account"`);
    await queryRunner.query(`DROP TABLE "session"`);
    await queryRunner.query(`DROP TABLE "user"`);
  }
}
