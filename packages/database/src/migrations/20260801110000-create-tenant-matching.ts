import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateTenantMatching20260801110000 implements MigrationInterface {
  name = "CreateTenantMatching20260801110000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "tenants" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(160) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "watch_rules" (
        "id" uuid PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "contract_version" varchar(8) NOT NULL DEFAULT '1',
        "canonical_product_class_id" uuid NOT NULL,
        "required_attributes" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "excluded_attributes" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "comparison_unit" varchar(32) NOT NULL,
        "preferred_retailer_ids" uuid[] NOT NULL DEFAULT '{}',
        "preferred_threshold" jsonb NOT NULL,
        "fallback_threshold" jsonb NOT NULL,
        "accepted_memberships" varchar[] NOT NULL DEFAULT '{}',
        "channels" varchar[] NOT NULL,
        "store_ids" uuid[] NOT NULL DEFAULT '{}',
        "service_area_ids" uuid[] NOT NULL DEFAULT '{}',
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "uq_watch_rules_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "fk_watch_rules_tenant" FOREIGN KEY ("tenant_id")
          REFERENCES "tenants"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_watch_rules_canonical_product_class"
          FOREIGN KEY ("canonical_product_class_id")
          REFERENCES "canonical_product_classes"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "matches" (
        "id" char(64) PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "watch_rule_id" uuid NOT NULL,
        "offer_id" uuid NOT NULL,
        "canonical_product_class_id" uuid NOT NULL,
        "normalized_amount" varchar(64) NOT NULL,
        "currency" char(3) NOT NULL,
        "comparison_unit" varchar(32) NOT NULL,
        "package_price_amount" varchar(64) NOT NULL,
        "retailer" jsonb NOT NULL,
        "threshold_reason" jsonb NOT NULL,
        "novelty_key" varchar(96) NOT NULL,
        "evaluated_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "uq_matches_tenant_rule_novelty"
          UNIQUE ("tenant_id", "watch_rule_id", "novelty_key"),
        CONSTRAINT "fk_matches_tenant" FOREIGN KEY ("tenant_id")
          REFERENCES "tenants"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_matches_tenant_watch_rule"
          FOREIGN KEY ("tenant_id", "watch_rule_id")
          REFERENCES "watch_rules"("tenant_id", "id") ON DELETE CASCADE,
        CONSTRAINT "fk_matches_offer" FOREIGN KEY ("offer_id")
          REFERENCES "offers"("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_matches_canonical_product_class"
          FOREIGN KEY ("canonical_product_class_id")
          REFERENCES "canonical_product_classes"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_matches_tenant_rule" ON "matches" ("tenant_id", "watch_rule_id", "evaluated_at")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "matches"`);
    await queryRunner.query(`DROP TABLE "watch_rules"`);
    await queryRunner.query(`DROP TABLE "tenants"`);
  }
}
