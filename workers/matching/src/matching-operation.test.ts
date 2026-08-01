import { describe, expect, it, vi } from "vitest";

import type { PublishedOffer, UserWatchRule } from "@shopsmart/contracts";

import {
  runMatchingFanOut,
  type MatchingFanOutStore,
} from "./matching-operation.js";

const ids = {
  tenantA: "018f5f70-7b5d-7a21-9f49-01b7f63a9201",
  tenantB: "018f5f70-7b5d-7a21-9f49-01b7f63a9202",
  ruleA: "018f5f70-7b5d-7a21-9f49-01b7f63a9203",
  ruleB: "018f5f70-7b5d-7a21-9f49-01b7f63a9204",
  canonical: "018f5f70-7b5d-7a21-9f49-01b7f63a9205",
  retailer: "a1b30000-0000-8000-8000-000000000001",
  retailerProduct: "018f5f70-7b5d-7a21-9f49-01b7f63a9206",
  sourceScope: "018f5f70-7b5d-7a21-9f49-01b7f63a9207",
  store: "018f5f70-7b5d-7a21-9f49-01b7f63a9208",
  offer: "018f5f70-7b5d-7a21-9f49-01b7f63a9209",
};

describe("runMatchingFanOut", () => {
  it("loads a shared offer once and fans it out through the deterministic matcher", async () => {
    const store = createStore([
      rule(),
      rule({ id: ids.ruleB, tenantId: ids.tenantB, storeIds: [] }),
    ]);

    const result = await runMatchingFanOut(store, "2026-08-01T12:00:00.000Z");

    expect(store.listPublishedOffers).toHaveBeenCalledOnce();
    expect(store.listWatchRulesForCanonicalProductClasses).toHaveBeenCalledWith(
      [ids.canonical],
    );
    expect(store.saveMatchesIdempotently).toHaveBeenCalledWith([
      expect.objectContaining({
        tenantId: ids.tenantA,
        watchRuleId: ids.ruleA,
      }),
    ]);
    expect(result).toMatchObject({
      publishedOfferCount: 1,
      candidatePairCount: 2,
      matchedCount: 1,
      insertedCount: 1,
      duplicateCount: 0,
      rejectionCounts: { LOCALITY_NOT_REACHABLE: 1 },
    });
  });

  it("fails closed and counts an offer from an unknown retailer", async () => {
    const store = createStore([rule()], "018f5f70-7b5d-7a21-9f49-01b7f63a9299");

    const result = await runMatchingFanOut(store, "2026-08-01T12:00:00.000Z");

    expect(
      store.listWatchRulesForCanonicalProductClasses,
    ).not.toHaveBeenCalled();
    expect(store.saveMatchesIdempotently).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      publishedOfferCount: 1,
      candidatePairCount: 0,
      matchedCount: 0,
      insertedCount: 0,
      duplicateCount: 0,
      rejectionCounts: { UNKNOWN_RETAILER: 1 },
    });
  });
});

function createStore(
  rules: readonly UserWatchRule[],
  retailerId = ids.retailer,
): MatchingFanOutStore {
  return {
    listPublishedOffers: vi
      .fn()
      .mockResolvedValue([{ offer: offer(), retailerId }]),
    listWatchRulesForCanonicalProductClasses: vi.fn().mockResolvedValue(rules),
    saveMatchesIdempotently: vi.fn().mockResolvedValue({ insertedCount: 1 }),
  };
}

function rule(change: Partial<UserWatchRule> = {}): UserWatchRule {
  return {
    contractVersion: "1",
    id: ids.ruleA,
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
    ...change,
  };
}

function offer(): PublishedOffer {
  return {
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
    status: "published",
  };
}
