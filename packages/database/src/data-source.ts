import "reflect-metadata";

import { DataSource } from "typeorm";

import { CreateNormalizationRecords20260801090000 } from "./migrations/20260801090000-create-normalization-records.js";
import { CreateOfferCatalogue20260801100000 } from "./migrations/20260801100000-create-offer-catalogue.js";
import { normalizationRecordSchema } from "./normalization-record.js";
import {
  canonicalProductClassRecordSchema,
  offerRecordSchema,
  retailerProductRecordSchema,
} from "./offer-record.js";

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
    entities: [
      normalizationRecordSchema,
      canonicalProductClassRecordSchema,
      retailerProductRecordSchema,
      offerRecordSchema,
    ],
    migrations: [
      CreateNormalizationRecords20260801090000,
      CreateOfferCatalogue20260801100000,
    ],
    migrationsTableName: "shopsmart_migrations",
  });
}
