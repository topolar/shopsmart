import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateAiAssist20260801170000 implements MigrationInterface {
  name = "CreateAiAssist20260801170000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "ai_assist_proposals" (
        "id" uuid PRIMARY KEY,
        "contract_version" varchar(8) NOT NULL,
        "task_key" varchar(240) NOT NULL,
        "source_snapshot_id" uuid NOT NULL,
        "prompt_version" varchar(240) NOT NULL,
        "model_provider" varchar(240) NOT NULL,
        "model_name" varchar(240) NOT NULL,
        "model_version" varchar(240) NOT NULL,
        "confidence" double precision NOT NULL,
        "evidence_spans" jsonb NOT NULL,
        "usage" jsonb NOT NULL,
        "payload" jsonb NOT NULL,
        "validation_status" varchar(24) NOT NULL,
        "reason_codes" varchar[] NOT NULL DEFAULT '{}',
        "review_status" varchar(24) NOT NULL,
        "created_at" timestamptz NOT NULL,
        "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "fk_ai_assist_proposal_snapshot"
          FOREIGN KEY ("source_snapshot_id") REFERENCES "source_snapshots"("id")
          ON DELETE RESTRICT,
        CONSTRAINT "ck_ai_assist_validation_status"
          CHECK ("validation_status" IN ('pending-review', 'quarantined')),
        CONSTRAINT "ck_ai_assist_review_status"
          CHECK ("review_status" IN ('pending', 'approved', 'rejected', 'quarantined'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_ai_assist_proposals_review_queue"
      ON "ai_assist_proposals" ("review_status", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_ai_assist_proposals_task"
      ON "ai_assist_proposals" ("task_key", "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE TABLE "ai_assist_reviews" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "proposal_id" uuid NOT NULL UNIQUE,
        "decision" varchar(16) NOT NULL,
        "reason" varchar(1000) NOT NULL,
        "reviewer_user_id" text NOT NULL,
        "reviewed_at" timestamptz NOT NULL,
        CONSTRAINT "fk_ai_assist_review_proposal"
          FOREIGN KEY ("proposal_id") REFERENCES "ai_assist_proposals"("id")
          ON DELETE CASCADE,
        CONSTRAINT "ck_ai_assist_review_decision"
          CHECK ("decision" IN ('approved', 'rejected'))
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "ai_assist_cache" (
        "task_key" varchar(240) PRIMARY KEY,
        "proposal_id" uuid NOT NULL UNIQUE,
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "fk_ai_assist_cache_proposal"
          FOREIGN KEY ("proposal_id") REFERENCES "ai_assist_proposals"("id")
          ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "ai_assist_failures" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "task_key" varchar(240) NOT NULL,
        "code" varchar(120) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_ai_assist_failures_task_created"
      ON "ai_assist_failures" ("task_key", "created_at" DESC)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "ai_assist_failures"`);
    await queryRunner.query(`DROP TABLE "ai_assist_cache"`);
    await queryRunner.query(`DROP TABLE "ai_assist_reviews"`);
    await queryRunner.query(`DROP TABLE "ai_assist_proposals"`);
  }
}
