import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateSourceIngestion20260801150000 implements MigrationInterface {
  name = "CreateSourceIngestion20260801150000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "source_snapshots" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "source_scope_key" varchar(240) NOT NULL,
        "source_url" varchar(2048) NOT NULL,
        "retrieved_at" timestamptz NOT NULL,
        "http_status" integer NOT NULL,
        "content_hash" char(64) NOT NULL,
        "parser_version" varchar(120) NOT NULL,
        "parse_status" varchar(24) NOT NULL,
        "etag" varchar(500) NULL,
        "last_modified" varchar(160) NULL,
        "raw_storage_key" varchar(500) NULL,
        "raw_delete_at" timestamptz NOT NULL,
        "raw_deleted_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "ck_source_snapshots_status"
          CHECK ("parse_status" IN ('parsed', 'unchanged', 'quarantined')),
        CONSTRAINT "ck_source_snapshots_hash"
          CHECK ("content_hash" ~ '^[a-f0-9]{64}$')
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_source_snapshots_scope_retrieved"
      ON "source_snapshots" ("source_scope_key", "retrieved_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_source_snapshots_raw_retention"
      ON "source_snapshots" ("raw_delete_at")
      WHERE "raw_storage_key" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE TABLE "quarantined_source_candidates" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "snapshot_id" uuid NOT NULL,
        "source_scope_key" varchar(240) NOT NULL,
        "external_id" varchar(240) NULL,
        "exact_name" varchar(500) NULL,
        "reason_code" varchar(120) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "fk_quarantined_source_candidate_snapshot"
          FOREIGN KEY ("snapshot_id") REFERENCES "source_snapshots"("id")
          ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_quarantined_source_candidates_scope_reason"
      ON "quarantined_source_candidates" ("source_scope_key", "reason_code")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "quarantined_source_candidates"`);
    await queryRunner.query(`DROP TABLE "source_snapshots"`);
  }
}
