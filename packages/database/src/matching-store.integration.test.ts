import { publishOffer, matchOffer } from "@shopsmart/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createAppDataSource } from "./data-source.js";
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
import { StoreRecord } from "./onboarding-store.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const tenantA = "018f5f70-7b5d-7a21-9f49-01b7f63a9301";
const tenantB = "018f5f70-7b5d-7a21-9f49-01b7f63a9302";
const canonicalId = "018f5f70-7b5d-7a21-9f49-01b7f63a9303";
const retailerProductId = "018f5f70-7b5d-7a21-9f49-01b7f63a9304";
const retailerId = "018f5f70-7b5d-7a21-9f49-01b7f63a9305";
const storeId = "018f5f70-7b5d-7a21-9f49-01b7f63a9306";

const rule = {
  id: "018f5f70-7b5d-7a21-9f49-01b7f63a9310",
  tenantId: tenantA,
  canonicalProductClassId: canonicalId,
  requiredAttributes: { fatClass: "low-fat" },
  excludedAttributes: { flavour: ["vanilla"] },
  comparisonUnit: "100-gram",
  preferredRetailerIds: [],
  preferredThreshold: {
    maxUnitPrice: { amount: "20.00", currency: "CZK", unit: "100-gram" },
    minDiscountPercent: null,
  },
  fallbackThreshold: {
    maxUnitPrice: { amount: "20.00", currency: "CZK", unit: "100-gram" },
    minDiscountPercent: null,
  },
  acceptedMemberships: [],
  channels: ["physical"],
  storeIds: [storeId],
  serviceAreaIds: [],
} as const;

describeWithDatabase("tenant-scoped matching persistence", () => {
  let dataSource: ReturnType<typeof createAppDataSource> | undefined;
  let store: TypeOrmMatchingStore | undefined;

  beforeAll(async () => {
    dataSource = createAppDataSource(databaseUrl);
    await dataSource.initialize();
    await dataSource.runMigrations();
    store = new TypeOrmMatchingStore(dataSource);
  });

  beforeEach(async () => {
    if (!dataSource) return;
    await clearMatchingData(dataSource);
    await dataSource.getRepository(CanonicalProductClassRecord).save({
      id: canonicalId,
      slug: "tenant-test-curd",
      name: "Synthetic tenant test curd",
      comparisonUnit: "100-gram",
      requiredAttributes: { fatClass: "low-fat" },
      excludedAttributes: {},
    });
    await dataSource.getRepository(RetailerProductRecord).save({
      id: retailerProductId,
      retailerId,
      externalId: "tenant-test-curd-250",
      canonicalProductClassId: canonicalId,
      exactName: "Synthetic low-fat curd 250 g",
      variantAttributes: { fatClass: "low-fat" },
    });
    await dataSource.getRepository(TenantRecord).save([
      { id: tenantA, name: "Synthetic tenant A" },
      { id: tenantB, name: "Synthetic tenant B" },
    ]);
    await dataSource.getRepository(StoreRecord).save({
      id: storeId,
      retailerId,
      officialName: "Synthetic Prague branch",
      city: "Praha",
      sourceUrl: "https://retailer.example.invalid/stores/browser-test",
    });
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    await clearMatchingData(dataSource);
    await dataSource.destroy();
  });

  it("rejects cross-tenant watch-rule reads and writes", async () => {
    if (!store) throw new Error("Matching store was not initialized.");
    await store.saveWatchRule(tenantA, rule);

    await expect(store.getWatchRule(tenantB, rule.id)).resolves.toBeNull();
    await expect(store.saveWatchRule(tenantB, rule)).rejects.toMatchObject({
      code: "TENANT_SCOPE_VIOLATION",
    });
  });

  it("persists and lists matches only in the owning tenant scope", async () => {
    if (!store || !dataSource) {
      throw new Error("Matching persistence was not initialized.");
    }
    await store.saveWatchRule(tenantA, rule);
    const offer = publishOffer({
      id: "018f5f70-7b5d-7a21-9f49-01b7f63a9320",
      retailerProductId,
      sourceScopeId: "018f5f70-7b5d-7a21-9f49-01b7f63a9321",
      canonicalProductClassId: canonicalId,
      exactName: "Synthetic low-fat curd 250 g",
      variantAttributes: { fatClass: "low-fat", flavour: "plain" },
      package: {
        declared: "250 g",
        quantity: { amount: "250", unit: "gram" },
        count: 1,
      },
      price: { amount: "49.90", currency: "CZK" },
      regularPrice: null,
      discountPercent: null,
      comparisonUnit: "100-gram",
      unitPrices: [{ amount: "19.96", currency: "CZK", unit: "100-gram" }],
      membership: { kind: "none" },
      channel: "physical",
      locality: { kind: "physical", storeId, applicability: "store" },
      availability: {
        kind: "physical",
        evidence: "flyer-applicability",
        stockStatus: "not-asserted",
      },
      validity: {
        validFrom: "2026-08-01T00:00:00.000Z",
        validTo: "2026-08-07T23:59:59.000Z",
      },
      evidence: {
        level: "official",
        sourceUrl: "https://retailer.example.invalid/offers/tenant-test",
        verificationUrls: [],
        retrievedAt: "2026-08-01T06:00:00.000Z",
      },
      parserVersion: "synthetic-v1",
      status: "qualified",
    });
    await new TypeOrmOfferStore(dataSource).save(offer);
    const decision = matchOffer(
      rule,
      { offer, retailer: { id: retailerId, name: "Synthetic Retailer" } },
      "2026-08-01T12:00:00.000Z",
    );
    if (!decision.matched) throw new Error(decision.reason);

    await expect(
      store.saveMatch(tenantB, decision.match),
    ).rejects.toMatchObject({ code: "TENANT_SCOPE_VIOLATION" });
    expect(
      await dataSource
        .getRepository(MatchRecord)
        .countBy([{ tenantId: tenantA }, { tenantId: tenantB }]),
    ).toBe(0);

    await store.saveMatch(tenantA, decision.match);
    await expect(store.listMatches(tenantB, rule.id)).resolves.toEqual([]);
    await expect(store.listMatches(tenantA, rule.id)).resolves.toEqual([
      decision.match,
    ]);

    const dashboardStore = new TypeOrmOffersDashboardStore(dataSource);
    await expect(dashboardStore.list(tenantB)).resolves.toEqual({
      contractVersion: "1",
      tenantId: tenantB,
      groups: [],
    });
    await expect(dashboardStore.list(tenantA)).resolves.toMatchObject({
      tenantId: tenantA,
      groups: [
        {
          canonicalProductClassName: "Synthetic tenant test curd",
          comparisonUnit: "100-gram",
          offers: [
            {
              localityName: "Synthetic Prague branch",
              exactName: offer.exactName,
              package: offer.package,
              price: offer.price,
              normalizedUnitPrice: decision.match.normalizedUnitPrice,
              sourceUrl: offer.evidence.sourceUrl,
              retrievedAt: offer.evidence.retrievedAt,
            },
          ],
        },
      ],
    });

    await dataSource
      .getRepository(OfferRecord)
      .update(
        { id: offer.id },
        { evidence: { ...offer.evidence, level: "candidate-only" } },
      );
    await expect(dashboardStore.list(tenantA)).resolves.toMatchObject({
      groups: [],
    });
  });
});

async function clearMatchingData(
  dataSource: NonNullable<ReturnType<typeof createAppDataSource>>,
) {
  for (const record of [
    [MatchRecord, "tenant_id IN (:...ids)", { ids: [tenantA, tenantB] }],
    [WatchRuleRecord, "tenant_id IN (:...ids)", { ids: [tenantA, tenantB] }],
    [TenantRecord, "id IN (:...ids)", { ids: [tenantA, tenantB] }],
    [StoreRecord, "id = :id", { id: storeId }],
    [OfferRecord, "id = :id", { id: "018f5f70-7b5d-7a21-9f49-01b7f63a9320" }],
    [RetailerProductRecord, "id = :id", { id: retailerProductId }],
    [CanonicalProductClassRecord, "id = :id", { id: canonicalId }],
  ] as const) {
    await dataSource
      .getRepository(record[0])
      .createQueryBuilder()
      .delete()
      .where(record[1], record[2])
      .execute();
  }
}
