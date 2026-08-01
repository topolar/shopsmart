import "reflect-metadata";

import { DataSource } from "typeorm";

import { CreateNormalizationRecords20260801090000 } from "./migrations/20260801090000-create-normalization-records.js";
import { normalizationRecordSchema } from "./normalization-record.js";

export function createAppDataSource(
  databaseUrl = process.env.DATABASE_URL,
): DataSource {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  return new DataSource({
    type: "postgres",
    url: databaseUrl,
    synchronize: false,
    migrationsRun: false,
    entities: [normalizationRecordSchema],
    migrations: [CreateNormalizationRecords20260801090000],
    migrationsTableName: "shopsmart_migrations",
  });
}
