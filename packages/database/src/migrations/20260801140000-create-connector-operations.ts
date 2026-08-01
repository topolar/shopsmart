import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateConnectorOperations20260801140000 implements MigrationInterface {
  name = "CreateConnectorOperations20260801140000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "connector_jobs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "source_scope_key" varchar(240) NOT NULL UNIQUE,
        "required_coverage_keys" jsonb NOT NULL,
        "status" varchar(24) NOT NULL DEFAULT 'idle',
        "due_at" timestamptz NOT NULL,
        "lease_owner" varchar(160) NULL,
        "lease_expires_at" timestamptz NULL,
        "attempts" integer NOT NULL DEFAULT 0,
        "max_attempts" integer NOT NULL DEFAULT 3,
        "rate_limit_until" timestamptz NULL,
        "expected_parser_version" varchar(120) NOT NULL,
        "parser_version" varchar(120) NULL,
        "last_content_hash" char(64) NULL,
        "last_success_at" timestamptz NULL,
        "last_error_code" varchar(120) NULL,
        "last_coverage_complete" boolean NOT NULL DEFAULT false,
        "quarantine_count" integer NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "ck_connector_jobs_status" CHECK (
          "status" IN ('idle','leased','retry','rate-limited','quarantined','dead-letter')
        ),
        CONSTRAINT "ck_connector_jobs_attempts" CHECK (
          "attempts" >= 0 AND "max_attempts" > 0
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_connector_jobs_due"
      ON "connector_jobs" ("status", "due_at", "rate_limit_until")
    `);
    await queryRunner.query(`
      CREATE TABLE "connector_runs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "job_id" uuid NOT NULL,
        "worker_id" varchar(160) NOT NULL,
        "status" varchar(24) NOT NULL,
        "coverage_manifest" jsonb NOT NULL,
        "content_hash" char(64) NULL,
        "parser_version" varchar(120) NULL,
        "completed_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "fk_connector_runs_job" FOREIGN KEY ("job_id")
          REFERENCES "connector_jobs"("id") ON DELETE CASCADE,
        CONSTRAINT "ck_connector_runs_status" CHECK (
          "status" IN ('success','quarantined','failed')
        )
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "static_context_cache" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "source_scope_key" varchar(240) NOT NULL,
        "context_key" varchar(160) NOT NULL,
        "payload" jsonb NOT NULL,
        "source_url" varchar(2048) NOT NULL,
        "verified_at" timestamptz NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "uq_static_context_scope_key"
          UNIQUE ("source_scope_key", "context_key")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "connector_refresh_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "job_id" uuid NOT NULL,
        "trigger" varchar(40) NOT NULL,
        "requested_at" timestamptz NOT NULL,
        CONSTRAINT "fk_connector_refresh_events_job" FOREIGN KEY ("job_id")
          REFERENCES "connector_jobs"("id") ON DELETE CASCADE,
        CONSTRAINT "ck_connector_refresh_events_trigger" CHECK (
          "trigger" IN ('broken-url','contradiction','official-change',
            'unknown-retailer','explicit-request')
        )
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "connector_refresh_events"`);
    await queryRunner.query(`DROP TABLE "static_context_cache"`);
    await queryRunner.query(`DROP TABLE "connector_runs"`);
    await queryRunner.query(`DROP TABLE "connector_jobs"`);
  }
}
