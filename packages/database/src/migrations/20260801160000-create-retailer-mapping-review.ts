import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateRetailerMappingReview20260801160000 implements MigrationInterface {
  name = "CreateRetailerMappingReview20260801160000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "retailer_product_mapping_candidates" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "source_scope_key" varchar(240) NOT NULL,
        "retailer_id" uuid NOT NULL,
        "external_id" varchar(240) NOT NULL,
        "exact_name" varchar(500) NOT NULL,
        "source_snapshot_id" uuid NOT NULL,
        "status" varchar(24) NOT NULL DEFAULT 'pending',
        "canonical_product_class_id" uuid NULL,
        "variant_attributes" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "reviewed_by" varchar(160) NULL,
        "reviewed_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "uq_retailer_mapping_candidate_external"
          UNIQUE ("retailer_id", "external_id"),
        CONSTRAINT "ck_retailer_mapping_candidate_status"
          CHECK ("status" IN ('pending', 'approved', 'rejected')),
        CONSTRAINT "fk_retailer_mapping_candidate_snapshot"
          FOREIGN KEY ("source_snapshot_id") REFERENCES "source_snapshots"("id")
          ON DELETE RESTRICT,
        CONSTRAINT "fk_retailer_mapping_candidate_canonical"
          FOREIGN KEY ("canonical_product_class_id") REFERENCES "canonical_product_classes"("id")
          ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_retailer_mapping_candidates_review_queue"
      ON "retailer_product_mapping_candidates" ("source_scope_key", "status", "created_at")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "retailer_product_mapping_candidates"`);
  }
}
