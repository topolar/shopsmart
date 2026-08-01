import { ALBERT_RETAILER_ID } from "@shopsmart/connectors";
import { matchOffer, publishOffer } from "@shopsmart/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { integrationDatabaseUrl } from "../../../tests/integration-database.js";
import { runMatchingFanOut } from "../../../workers/matching/src/matching-operation.js";
import { runDigestPlanning } from "../../../workers/notifications/src/digest-planning.js";

import { createAppDataSource } from "./data-source.js";
import { TypeOrmDigestPlanningStore } from "./digest-planning-store.js";
import { TypeOrmMatchingFanOutStore } from "./matching-fanout-store.js";
import {
  MatchRecord,
  TenantRecord,
  TypeOrmMatchingStore,
  WatchRuleRecord,
} from "./matching-store.js";
import {
  CanonicalProductClassRecord,
  OfferRecord,
  RetailerProductRecord,
} from "./offer-record.js";
import { TypeOrmOfferStore } from "./offer-store.js";
import { TypeOrmOffersDashboardStore } from "./offers-dashboard-store.js";
import {
  NotificationEventRecord,
  NotificationOutboxRecord,
} from "./notification-outbox.js";
import {
  NotificationPreferenceRecord,
  StoreRecord,
} from "./onboarding-store.js";

const databaseUrl = integrationDatabaseUrl();
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const ids = {
  tenantA: "018f5f70-7b5d-7a21-9f49-01b7f63a9401",
  tenantB: "018f5f70-7b5d-7a21-9f49-01b7f63a9402",
  rule: "018f5f70-7b5d-7a21-9f49-01b7f63a9403",
  canonical: "018f5f70-7b5d-7a21-9f49-01b7f63a9404",
  otherCanonical: "018f5f70-7b5d-7a21-9f49-01b7f63a9405",
  retailerProduct: "018f5f70-7b5d-7a21-9f49-01b7f63a9406",
  offer: "018f5f70-7b5d-7a21-9f49-01b7f63a9407",
  store: "018f5f70-7b5d-7a21-9f49-01b7f63a9408",
  sourceScope: "018f5f70-7b5d-7a21-9f49-01b7f63a9409",
};

const watchRule = {
  contractVersion: "1",
  id: ids.rule,
  tenantId: ids.tenantA,
  canonicalProductClassId: ids.canonical,
  requiredAttributes: { state: "fresh" },
  excludedAttributes: {},
  comparisonUnit: "piece",
  preferredRetailerIds: [],
  preferredThreshold: {
    maxUnitPrice: { amount: "25.00", currency: "CZK", unit: "piece" },
    minDiscountPercent: null,
  },
  fallbackThreshold: {
    maxUnitPrice: { amount: "25.00", currency: "CZK", unit: "piece" },
    minDiscountPercent: null,
  },
  acceptedMemberships: [],
  channels: ["physical"],
  storeIds: [ids.store],
  serviceAreaIds: [],
} as const;

describeWithDatabase("matching fan-out persistence", () => {
  let dataSource: ReturnType<typeof createAppDataSource> | undefined;

  beforeAll(async () => {
    dataSource = createAppDataSource(databaseUrl);
    await dataSource.initialize();
    await dataSource.runMigrations();
  });

  beforeEach(async () => {
    if (!dataSource) return;
    await clearData(dataSource);
    await dataSource.getRepository(CanonicalProductClassRecord).save([
      {
        id: ids.canonical,
        slug: "fanout-cucumber",
        name: "Synthetic cucumber",
        comparisonUnit: "piece",
        requiredAttributes: { state: "fresh" },
        excludedAttributes: {},
      },
      {
        id: ids.otherCanonical,
        slug: "fanout-other",
        name: "Synthetic unrelated product",
        comparisonUnit: "piece",
        requiredAttributes: {},
        excludedAttributes: {},
      },
    ]);
    await dataSource.getRepository(RetailerProductRecord).save({
      id: ids.retailerProduct,
      retailerId: ALBERT_RETAILER_ID,
      externalId: "fanout-cucumber-1",
      canonicalProductClassId: ids.canonical,
      exactName: "Synthetic cucumber 1 pc",
      variantAttributes: { state: "fresh" },
    });
    await dataSource.getRepository(TenantRecord).save([
      { id: ids.tenantA, name: "Synthetic fan-out tenant A" },
      { id: ids.tenantB, name: "Synthetic fan-out tenant B" },
    ]);
    await dataSource.getRepository(StoreRecord).save({
      id: ids.store,
      retailerId: ALBERT_RETAILER_ID,
      officialName: "Synthetic Albert nationwide scope",
      city: "Česko",
      sourceUrl: "https://www.albert.cz/aktualni-letaky",
    });
    await dataSource.getRepository(NotificationPreferenceRecord).save([
      {
        tenantId: ids.tenantA,
        emailDigestEnabled: true,
        locale: "cs",
        timezone: "Europe/Prague",
      },
      {
        tenantId: ids.tenantB,
        emailDigestEnabled: true,
        locale: "cs",
        timezone: "Europe/Prague",
      },
    ]);
    await dataSource.query(
      `INSERT INTO "user" ("id", "name", "email", "tenantId") VALUES ($1, $2, $3, $4)`,
      [
        `digest-user-${ids.tenantA}`,
        "Synthetic digest user",
        "digest-user@example.invalid",
        ids.tenantA,
      ],
    );
    await new TypeOrmMatchingStore(dataSource).saveWatchRule(
      ids.tenantA,
      watchRule,
    );
    await new TypeOrmOfferStore(dataSource).save(publishedOffer());
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    await clearData(dataSource);
    await dataSource.destroy();
  });

  it("loads published offers once and narrows rules by canonical product class", async () => {
    if (!dataSource) throw new Error("Test database was not initialized.");
    const store = new TypeOrmMatchingFanOutStore(dataSource);

    await expect(store.listPublishedOffers()).resolves.toEqual([
      { offer: publishedOffer(), retailerId: ALBERT_RETAILER_ID },
    ]);
    await expect(
      store.listWatchRulesForCanonicalProductClasses([ids.otherCanonical]),
    ).resolves.toEqual([]);
    await expect(
      store.listWatchRulesForCanonicalProductClasses([ids.canonical]),
    ).resolves.toEqual([watchRule]);
  });

  it("persists concurrent repeated matches once and rejects a mismatched tenant/rule", async () => {
    if (!dataSource) throw new Error("Test database was not initialized.");
    const store = new TypeOrmMatchingFanOutStore(dataSource);
    const decision = matchOffer(
      watchRule,
      {
        offer: publishedOffer(),
        retailer: { id: ALBERT_RETAILER_ID, name: "Albert" },
      },
      "2026-08-01T12:00:00.000Z",
    );
    if (!decision.matched) throw new Error(decision.reason);

    const results = await Promise.all([
      store.saveMatchesIdempotently([decision.match]),
      store.saveMatchesIdempotently([decision.match]),
    ]);

    expect(results.reduce((sum, result) => sum + result.insertedCount, 0)).toBe(
      1,
    );
    await expect(
      store.saveMatchesIdempotently([
        { ...decision.match, tenantId: ids.tenantB },
      ]),
    ).rejects.toMatchObject({ code: "TENANT_SCOPE_VIOLATION" });
    await expect(dataSource.getRepository(MatchRecord).count()).resolves.toBe(
      1,
    );
  });

  it("fans out idempotently and exposes results only on the owning tenant dashboard", async () => {
    if (!dataSource) throw new Error("Test database was not initialized.");
    const store = new TypeOrmMatchingFanOutStore(dataSource);

    await expect(
      runMatchingFanOut(store, "2026-08-01T12:00:00.000Z"),
    ).resolves.toMatchObject({
      publishedOfferCount: 1,
      candidatePairCount: 1,
      matchedCount: 1,
      insertedCount: 1,
      duplicateCount: 0,
    });
    await expect(
      runMatchingFanOut(store, "2026-08-01T12:01:00.000Z"),
    ).resolves.toMatchObject({
      matchedCount: 1,
      insertedCount: 0,
      duplicateCount: 1,
    });

    const dashboard = new TypeOrmOffersDashboardStore(dataSource);
    await expect(dashboard.list(ids.tenantA)).resolves.toMatchObject({
      tenantId: ids.tenantA,
      groups: [
        {
          offers: [
            {
              exactName: "Synthetic cucumber 1 pc",
              localityName: "Synthetic Albert nationwide scope",
            },
          ],
        },
      ],
    });
    await expect(dashboard.list(ids.tenantB)).resolves.toEqual({
      contractVersion: "1",
      tenantId: ids.tenantB,
      groups: [],
    });
  });

  it("plans one aggregate outbox item and makes an unchanged second plan silent", async () => {
    if (!dataSource) throw new Error("Test database was not initialized.");
    await runMatchingFanOut(
      new TypeOrmMatchingFanOutStore(dataSource),
      "2026-08-01T12:00:00.000Z",
    );
    const planner = new TypeOrmDigestPlanningStore(dataSource);

    await expect(
      runDigestPlanning(planner, "2026-08-01"),
    ).resolves.toMatchObject({
      candidateTenantCount: 1,
      candidateFactCount: 1,
      enqueuedCount: 1,
      skippedCounts: {},
    });
    await expect(
      runDigestPlanning(planner, "2026-08-01"),
    ).resolves.toMatchObject({
      candidateTenantCount: 0,
      candidateFactCount: 0,
      enqueuedCount: 0,
    });
    await expect(
      dataSource.getRepository(NotificationOutboxRecord).find(),
    ).resolves.toEqual([
      expect.objectContaining({
        tenantId: ids.tenantA,
        intervalKey: "2026-08-01",
        recipientEmail: "digest-user@example.invalid",
        status: "pending",
      }),
    ]);
    await expect(
      dataSource.getRepository(NotificationEventRecord).count(),
    ).resolves.toBe(1);
  });

  it("fails closed for ambiguous recipients and invalid persisted evidence", async () => {
    if (!dataSource) throw new Error("Test database was not initialized.");
    await runMatchingFanOut(
      new TypeOrmMatchingFanOutStore(dataSource),
      "2026-08-01T12:00:00.000Z",
    );
    await dataSource.query(
      `INSERT INTO "user" ("id", "name", "email", "tenantId") VALUES ($1, $2, $3, $4)`,
      [
        `digest-user-second-${ids.tenantA}`,
        "Synthetic second digest user",
        "digest-second@example.invalid",
        ids.tenantA,
      ],
    );
    const planner = new TypeOrmDigestPlanningStore(dataSource);
    await expect(
      runDigestPlanning(planner, "2026-08-01"),
    ).resolves.toMatchObject({
      enqueuedCount: 0,
      skippedCounts: { AMBIGUOUS_RECIPIENT: 1 },
    });
    await expect(
      dataSource.getRepository(NotificationOutboxRecord).count(),
    ).resolves.toBe(0);

    await dataSource.query(`DELETE FROM "user" WHERE "id" = $1`, [
      `digest-user-second-${ids.tenantA}`,
    ]);
    const offer = publishedOffer();
    await dataSource
      .getRepository(OfferRecord)
      .update(
        { id: offer.id },
        { evidence: { ...offer.evidence, level: "candidate-only" } },
      );
    await expect(
      runDigestPlanning(planner, "2026-08-01"),
    ).resolves.toMatchObject({
      enqueuedCount: 0,
      skippedCounts: { INVALID_FACTS: 1 },
    });
    await expect(
      dataSource.getRepository(NotificationOutboxRecord).count(),
    ).resolves.toBe(0);
  });
});

function publishedOffer() {
  return publishOffer({
    contractVersion: "1",
    id: ids.offer,
    retailerProductId: ids.retailerProduct,
    sourceScopeId: ids.sourceScope,
    canonicalProductClassId: ids.canonical,
    exactName: "Synthetic cucumber 1 pc",
    variantAttributes: { state: "fresh" },
    package: {
      declared: "1 pc",
      quantity: { amount: "1", unit: "piece" },
      count: 1,
    },
    price: { amount: "19.90", currency: "CZK" },
    regularPrice: null,
    discountPercent: null,
    comparisonUnit: "piece",
    unitPrices: [{ amount: "19.90", currency: "CZK", unit: "piece" }],
    membership: { kind: "none" },
    channel: "physical",
    locality: {
      kind: "physical",
      storeId: ids.store,
      applicability: "national",
    },
    availability: {
      kind: "physical",
      evidence: "flyer-applicability",
      stockStatus: "not-asserted",
    },
    validity: {
      validFrom: "2026-07-29T00:00:00.000Z",
      validTo: "2026-08-04T21:59:59.999Z",
    },
    evidence: {
      level: "official",
      sourceUrl: "https://www.albert.cz/aktualni-letaky",
      verificationUrls: [],
      retrievedAt: "2026-08-01T10:00:00.000Z",
    },
    parserVersion: "synthetic-v1",
    status: "qualified",
  });
}

async function clearData(
  dataSource: NonNullable<ReturnType<typeof createAppDataSource>>,
) {
  for (const [record, condition, parameters] of [
    [
      NotificationEventRecord,
      "tenant_id IN (:...ids)",
      { ids: [ids.tenantA, ids.tenantB] },
    ],
    [
      NotificationOutboxRecord,
      "tenant_id IN (:...ids)",
      { ids: [ids.tenantA, ids.tenantB] },
    ],
    [
      MatchRecord,
      "tenant_id IN (:...ids)",
      { ids: [ids.tenantA, ids.tenantB] },
    ],
    [
      WatchRuleRecord,
      "tenant_id IN (:...ids)",
      { ids: [ids.tenantA, ids.tenantB] },
    ],
    [TenantRecord, "id IN (:...ids)", { ids: [ids.tenantA, ids.tenantB] }],
    [StoreRecord, "id = :id", { id: ids.store }],
    [OfferRecord, "id = :id", { id: ids.offer }],
    [RetailerProductRecord, "id = :id", { id: ids.retailerProduct }],
    [
      CanonicalProductClassRecord,
      "id IN (:...ids)",
      { ids: [ids.canonical, ids.otherCanonical] },
    ],
  ] as const) {
    await dataSource
      .getRepository(record)
      .createQueryBuilder()
      .delete()
      .where(condition, parameters)
      .execute();
  }
}
