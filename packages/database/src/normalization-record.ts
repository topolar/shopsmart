import { EntitySchema } from "typeorm";

export class NormalizationRecord {
  id!: string;
  packagePrice!: string;
  currency!: "CZK";
  packageQuantityAmount!: string;
  packageQuantityUnit!: string;
  comparisonUnit!: string;
  normalizedAmount!: string;
  createdAt!: Date;
}

export const normalizationRecordSchema = new EntitySchema<NormalizationRecord>({
  name: "NormalizationRecord",
  tableName: "normalization_records",
  target: NormalizationRecord,
  columns: {
    id: {
      type: "uuid",
      primary: true,
      generated: "uuid",
    },
    packagePrice: {
      name: "package_price",
      type: "numeric",
      precision: 14,
      scale: 2,
    },
    currency: {
      type: "char",
      length: 3,
    },
    packageQuantityAmount: {
      name: "package_quantity_amount",
      type: "numeric",
      precision: 18,
      scale: 6,
    },
    packageQuantityUnit: {
      name: "package_quantity_unit",
      type: "varchar",
      length: 32,
    },
    comparisonUnit: {
      name: "comparison_unit",
      type: "varchar",
      length: 32,
    },
    normalizedAmount: {
      name: "normalized_amount",
      type: "numeric",
      precision: 14,
      scale: 2,
    },
    createdAt: {
      name: "created_at",
      type: "timestamptz",
      createDate: true,
    },
  },
});
