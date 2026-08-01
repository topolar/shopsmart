import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateOfferCatalogue20260801100000 implements MigrationInterface {
  name = "CreateOfferCatalogue20260801100000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "canonical_product_classes" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "contract_version" varchar(8) NOT NULL DEFAULT '1',
        "slug" varchar(160) NOT NULL,
        "name" varchar(240) NOT NULL,
        "comparison_unit" varchar(32) NOT NULL,
        "required_attributes" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "excluded_attributes" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "uq_canonical_product_classes_slug" UNIQUE ("slug")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "retailer_products" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "contract_version" varchar(8) NOT NULL DEFAULT '1',
        "retailer_id" uuid NOT NULL,
        "external_id" varchar(240) NOT NULL,
        "canonical_product_class_id" uuid NULL,
        "exact_name" varchar(500) NOT NULL,
        "variant_attributes" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "uq_retailer_products_retailer_external"
          UNIQUE ("retailer_id", "external_id"),
        CONSTRAINT "fk_retailer_products_canonical_product_class"
          FOREIGN KEY ("canonical_product_class_id")
          REFERENCES "canonical_product_classes"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "offers" (
        "id" uuid PRIMARY KEY,
        "contract_version" varchar(8) NOT NULL DEFAULT '1',
        "retailer_product_id" uuid NOT NULL,
        "source_scope_id" uuid NOT NULL,
        "canonical_product_class_id" uuid NOT NULL,
        "exact_name" varchar(500) NOT NULL,
        "variant_attributes" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "package" jsonb NOT NULL,
        "price_amount" numeric(14,2) NOT NULL,
        "currency" char(3) NOT NULL,
        "regular_price_amount" numeric(14,2) NULL,
        "discount_percent" numeric(5,2) NULL,
        "comparison_unit" varchar(32) NOT NULL,
        "unit_prices" jsonb NOT NULL,
        "membership" jsonb NOT NULL,
        "channel" varchar(16) NOT NULL,
        "locality" jsonb NOT NULL,
        "availability" jsonb NOT NULL,
        "validity" jsonb NOT NULL,
        "evidence" jsonb NOT NULL,
        "parser_version" varchar(120) NOT NULL,
        "status" varchar(24) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "fk_offers_retailer_product"
          FOREIGN KEY ("retailer_product_id")
          REFERENCES "retailer_products"("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_offers_canonical_product_class"
          FOREIGN KEY ("canonical_product_class_id")
          REFERENCES "canonical_product_classes"("id") ON DELETE RESTRICT,
        CONSTRAINT "ck_offers_channel" CHECK ("channel" IN ('physical', 'online')),
        CONSTRAINT "ck_offers_status" CHECK ("status" IN ('qualified', 'published'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_offers_scope_status" ON "offers" ("source_scope_id", "status")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "offers"`);
    await queryRunner.query(`DROP TABLE "retailer_products"`);
    await queryRunner.query(`DROP TABLE "canonical_product_classes"`);
  }
}
