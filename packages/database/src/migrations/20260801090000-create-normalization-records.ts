import { type MigrationInterface, QueryRunner, Table } from "typeorm";

export class CreateNormalizationRecords20260801090000 implements MigrationInterface {
  name = "CreateNormalizationRecords20260801090000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "normalization_records",
        columns: [
          {
            name: "id",
            type: "uuid",
            isPrimary: true,
            generationStrategy: "uuid",
            isGenerated: true,
          },
          {
            name: "package_price",
            type: "numeric",
            precision: 14,
            scale: 2,
          },
          { name: "currency", type: "char", length: "3" },
          {
            name: "package_quantity_amount",
            type: "numeric",
            precision: 18,
            scale: 6,
          },
          {
            name: "package_quantity_unit",
            type: "varchar",
            length: "32",
          },
          {
            name: "comparison_unit",
            type: "varchar",
            length: "32",
          },
          {
            name: "normalized_amount",
            type: "numeric",
            precision: 14,
            scale: 2,
          },
          {
            name: "created_at",
            type: "timestamptz",
            default: "CURRENT_TIMESTAMP",
          },
        ],
      }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("normalization_records");
  }
}
