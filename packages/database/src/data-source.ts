import "reflect-metadata";

import { DataSource } from "typeorm";

import { CreateNormalizationRecords20260801090000 } from "./migrations/20260801090000-create-normalization-records.js";
import { CreateOfferCatalogue20260801100000 } from "./migrations/20260801100000-create-offer-catalogue.js";
import { CreateTenantMatching20260801110000 } from "./migrations/20260801110000-create-tenant-matching.js";
import { CreateAuthOnboarding20260801120000 } from "./migrations/20260801120000-create-auth-onboarding.js";
import { CreateNotificationOutbox20260801130000 } from "./migrations/20260801130000-create-notification-outbox.js";
import { CreateConnectorOperations20260801140000 } from "./migrations/20260801140000-create-connector-operations.js";
import {
  connectorJobRecordSchema,
  connectorRefreshEventRecordSchema,
  connectorRunRecordSchema,
  staticContextRecordSchema,
} from "./connector-job-store.js";
import {
  matchRecordSchema,
  tenantRecordSchema,
  watchRuleRecordSchema,
} from "./matching-store.js";
import { normalizationRecordSchema } from "./normalization-record.js";
import {
  notificationDeliveryRecordSchema,
  notificationEventRecordSchema,
  notificationOutboxRecordSchema,
} from "./notification-outbox.js";
import {
  loyaltyMembershipRecordSchema,
  notificationPreferenceRecordSchema,
  onboardingProfileRecordSchema,
  storeRecordSchema,
  userStoreAccessRecordSchema,
} from "./onboarding-store.js";
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
      tenantRecordSchema,
      watchRuleRecordSchema,
      matchRecordSchema,
      storeRecordSchema,
      onboardingProfileRecordSchema,
      userStoreAccessRecordSchema,
      loyaltyMembershipRecordSchema,
      notificationPreferenceRecordSchema,
      notificationOutboxRecordSchema,
      notificationEventRecordSchema,
      notificationDeliveryRecordSchema,
      connectorJobRecordSchema,
      connectorRunRecordSchema,
      staticContextRecordSchema,
      connectorRefreshEventRecordSchema,
    ],
    migrations: [
      CreateNormalizationRecords20260801090000,
      CreateOfferCatalogue20260801100000,
      CreateTenantMatching20260801110000,
      CreateAuthOnboarding20260801120000,
      CreateNotificationOutbox20260801130000,
      CreateConnectorOperations20260801140000,
    ],
    migrationsTableName: "shopsmart_migrations",
  });
}
