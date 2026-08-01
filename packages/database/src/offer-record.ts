import type { PublishedOffer, QualifiedOffer } from "@shopsmart/contracts";
import { EntitySchema } from "typeorm";

type ProductAttributes = PublishedOffer["variantAttributes"];

export class CanonicalProductClassRecord {
  id!: string;
  contractVersion!: "1";
  slug!: string;
  name!: string;
  comparisonUnit!: PublishedOffer["comparisonUnit"];
  requiredAttributes!: ProductAttributes;
  excludedAttributes!: ProductAttributes;
  createdAt!: Date;
}

export class RetailerProductRecord {
  id!: string;
  contractVersion!: "1";
  retailerId!: string;
  externalId!: string;
  canonicalProductClassId!: string | null;
  exactName!: string;
  variantAttributes!: ProductAttributes;
  createdAt!: Date;
}

export class OfferRecord {
  id!: string;
  contractVersion!: "1";
  retailerProductId!: string;
  sourceScopeId!: string;
  canonicalProductClassId!: string;
  exactName!: string;
  variantAttributes!: ProductAttributes;
  package!: PublishedOffer["package"];
  priceAmount!: string;
  currency!: string;
  regularPriceAmount!: string | null;
  discountPercent!: string | null;
  comparisonUnit!: PublishedOffer["comparisonUnit"];
  unitPrices!: PublishedOffer["unitPrices"];
  membership!: PublishedOffer["membership"];
  channel!: PublishedOffer["channel"];
  locality!: PublishedOffer["locality"];
  availability!: PublishedOffer["availability"];
  validity!: PublishedOffer["validity"];
  evidence!: PublishedOffer["evidence"];
  parserVersion!: string;
  status!: QualifiedOffer["status"] | PublishedOffer["status"];
  createdAt!: Date;
  updatedAt!: Date;
}

export const canonicalProductClassRecordSchema =
  new EntitySchema<CanonicalProductClassRecord>({
    name: "CanonicalProductClassRecord",
    tableName: "canonical_product_classes",
    target: CanonicalProductClassRecord,
    columns: {
      id: { type: "uuid", primary: true, generated: "uuid" },
      contractVersion: {
        name: "contract_version",
        type: "varchar",
        length: 8,
        default: "1",
      },
      slug: { type: "varchar", length: 160, unique: true },
      name: { type: "varchar", length: 240 },
      comparisonUnit: {
        name: "comparison_unit",
        type: "varchar",
        length: 32,
      },
      requiredAttributes: {
        name: "required_attributes",
        type: "jsonb",
        default: {},
      },
      excludedAttributes: {
        name: "excluded_attributes",
        type: "jsonb",
        default: {},
      },
      createdAt: { name: "created_at", type: "timestamptz", createDate: true },
    },
  });

export const retailerProductRecordSchema =
  new EntitySchema<RetailerProductRecord>({
    name: "RetailerProductRecord",
    tableName: "retailer_products",
    target: RetailerProductRecord,
    columns: {
      id: { type: "uuid", primary: true, generated: "uuid" },
      contractVersion: {
        name: "contract_version",
        type: "varchar",
        length: 8,
        default: "1",
      },
      retailerId: { name: "retailer_id", type: "uuid" },
      externalId: { name: "external_id", type: "varchar", length: 240 },
      canonicalProductClassId: {
        name: "canonical_product_class_id",
        type: "uuid",
        nullable: true,
      },
      exactName: { name: "exact_name", type: "varchar", length: 500 },
      variantAttributes: {
        name: "variant_attributes",
        type: "jsonb",
        default: {},
      },
      createdAt: { name: "created_at", type: "timestamptz", createDate: true },
    },
    uniques: [
      {
        name: "uq_retailer_products_retailer_external",
        columns: ["retailerId", "externalId"],
      },
    ],
  });

export const offerRecordSchema = new EntitySchema<OfferRecord>({
  name: "OfferRecord",
  tableName: "offers",
  target: OfferRecord,
  columns: {
    id: { type: "uuid", primary: true },
    contractVersion: {
      name: "contract_version",
      type: "varchar",
      length: 8,
      default: "1",
    },
    retailerProductId: { name: "retailer_product_id", type: "uuid" },
    sourceScopeId: { name: "source_scope_id", type: "uuid" },
    canonicalProductClassId: {
      name: "canonical_product_class_id",
      type: "uuid",
    },
    exactName: { name: "exact_name", type: "varchar", length: 500 },
    variantAttributes: {
      name: "variant_attributes",
      type: "jsonb",
      default: {},
    },
    package: { type: "jsonb" },
    priceAmount: {
      name: "price_amount",
      type: "numeric",
      precision: 14,
      scale: 2,
    },
    currency: { type: "char", length: 3 },
    regularPriceAmount: {
      name: "regular_price_amount",
      type: "numeric",
      precision: 14,
      scale: 2,
      nullable: true,
    },
    discountPercent: {
      name: "discount_percent",
      type: "numeric",
      precision: 5,
      scale: 2,
      nullable: true,
    },
    comparisonUnit: {
      name: "comparison_unit",
      type: "varchar",
      length: 32,
    },
    unitPrices: { name: "unit_prices", type: "jsonb" },
    membership: { type: "jsonb" },
    channel: { type: "varchar", length: 16 },
    locality: { type: "jsonb" },
    availability: { type: "jsonb" },
    validity: { type: "jsonb" },
    evidence: { type: "jsonb" },
    parserVersion: { name: "parser_version", type: "varchar", length: 120 },
    status: { type: "varchar", length: 24 },
    createdAt: { name: "created_at", type: "timestamptz", createDate: true },
    updatedAt: { name: "updated_at", type: "timestamptz", updateDate: true },
  },
});
