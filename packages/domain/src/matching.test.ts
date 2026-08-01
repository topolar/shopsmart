import { describe, expect, it } from "vitest";

import { publishOffer } from "./offer-publication.js";
import {
  createOfferNoveltyKey,
  groupAndSortMatches,
  matchOffer,
} from "./matching.js";

const ids = {
  tenant: "018f5f70-7b5d-7a21-9f49-01b7f63a9201",
  rule: "018f5f70-7b5d-7a21-9f49-01b7f63a9202",
  canonical: "018f5f70-7b5d-7a21-9f49-01b7f63a9203",
  retailer: "018f5f70-7b5d-7a21-9f49-01b7f63a9204",
  preferredRetailer: "018f5f70-7b5d-7a21-9f49-01b7f63a9205",
  retailerProduct: "018f5f70-7b5d-7a21-9f49-01b7f63a9206",
  sourceScope: "018f5f70-7b5d-7a21-9f49-01b7f63a9207",
  store: "018f5f70-7b5d-7a21-9f49-01b7f63a9208",
};

const baseRule = {
  id: ids.rule,
  tenantId: ids.tenant,
  canonicalProductClassId: ids.canonical,
  requiredAttributes: { fatClass: "low-fat", preparation: "fresh" },
  excludedAttributes: { flavour: ["vanilla"], preparation: ["frozen"] },
  comparisonUnit: "100-gram",
  preferredRetailerIds: [ids.preferredRetailer],
  preferredThreshold: {
    maxUnitPrice: { amount: "22.00", currency: "CZK", unit: "100-gram" },
    minDiscountPercent: "15",
  },
  fallbackThreshold: {
    maxUnitPrice: { amount: "20.00", currency: "CZK", unit: "100-gram" },
    minDiscountPercent: "25",
  },
  acceptedMemberships: ["loyalty:clubcard"],
  channels: ["physical"],
  storeIds: [ids.store],
  serviceAreaIds: [],
} as const;

const baseOffer = {
  id: "018f5f70-7b5d-7a21-9f49-01b7f63a9210",
  retailerProductId: ids.retailerProduct,
  sourceScopeId: ids.sourceScope,
  canonicalProductClassId: ids.canonical,
  exactName: "Synthetic low-fat curd 250 g",
  variantAttributes: {
    fatClass: "low-fat",
    preparation: "fresh",
    flavour: "plain",
  },
  package: {
    declared: "250 g",
    quantity: { amount: "250", unit: "gram" },
    count: 1,
  },
  price: { amount: "49.90", currency: "CZK" },
  regularPrice: { amount: "59.90", currency: "CZK" },
  discountPercent: 17,
  comparisonUnit: "100-gram",
  unitPrices: [{ amount: "19.96", currency: "CZK", unit: "100-gram" }],
  membership: { kind: "none" },
  channel: "physical",
  locality: { kind: "physical", storeId: ids.store, applicability: "store" },
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
    sourceUrl: "https://retailer.example.invalid/offers/curd-250",
    verificationUrls: [],
    retrievedAt: "2026-08-01T06:00:00.000Z",
  },
  parserVersion: "synthetic-v1",
  status: "qualified",
} as const;

describe("matchOffer", () => {
  it("matches required attributes and reports the exact fallback unit-price threshold", () => {
    const decision = evaluate();

    expect(decision).toMatchObject({
      matched: true,
      match: {
        tenantId: ids.tenant,
        watchRuleId: ids.rule,
        thresholdReason: {
          scope: "fallback",
          predicate: "max-unit-price",
          actual: "19.96",
          limit: "20.00",
        },
      },
    });
  });

  it("rejects missing required and present excluded attributes", () => {
    expect(
      evaluate({ variantAttributes: { fatClass: "low-fat" } }),
    ).toMatchObject({ matched: false, reason: "REQUIRED_ATTRIBUTE_MISMATCH" });
    expect(
      evaluate({
        variantAttributes: {
          fatClass: "low-fat",
          preparation: "fresh",
          flavour: "vanilla",
        },
      }),
    ).toMatchObject({ matched: false, reason: "EXCLUDED_ATTRIBUTE" });
  });

  it("uses preferred thresholds only for an explicitly preferred retailer", () => {
    const decision = evaluate(
      { unitPrices: [{ amount: "21.00", currency: "CZK", unit: "100-gram" }] },
      { id: ids.preferredRetailer },
    );

    expect(decision).toMatchObject({
      matched: true,
      match: {
        thresholdReason: {
          scope: "preferred",
          predicate: "max-unit-price",
          actual: "21.00",
          limit: "22.00",
        },
      },
    });
  });

  it("can qualify by the exact discount predicate when price fails", () => {
    const decision = evaluate({
      unitPrices: [{ amount: "24.00", currency: "CZK", unit: "100-gram" }],
      discountPercent: 30,
    });

    expect(decision).toMatchObject({
      matched: true,
      match: {
        thresholdReason: {
          scope: "fallback",
          predicate: "min-discount-percent",
          actual: "30",
          limit: "25",
        },
      },
    });
  });

  it("never silently compares an incompatible unit", () => {
    const decision = matchOffer(
      baseRule,
      {
        offer: publishOffer({
          ...baseOffer,
          comparisonUnit: "kilogram",
          unitPrices: [{ amount: "199.60", currency: "CZK", unit: "kilogram" }],
        }),
        retailer: { id: ids.retailer, name: "Synthetic Retailer" },
      },
      "2026-08-01T12:00:00.000Z",
    );

    expect(decision).toMatchObject({
      matched: false,
      reason: "INCOMPATIBLE_COMPARISON_UNIT",
    });
  });

  it("fails closed for unaccepted memberships and unreachable locality", () => {
    expect(
      evaluate({ membership: { kind: "loyalty", program: "other-club" } }),
    ).toMatchObject({ matched: false, reason: "MEMBERSHIP_NOT_ACCEPTED" });
    expect(
      evaluate({
        locality: {
          kind: "physical",
          storeId: "018f5f70-7b5d-7a21-9f49-01b7f63a9299",
          applicability: "store",
        },
      }),
    ).toMatchObject({ matched: false, reason: "LOCALITY_NOT_REACHABLE" });
  });

  it("rejects offers outside their validity interval", () => {
    expect(evaluate({}, {}, "2026-08-08T00:00:00.000Z")).toMatchObject({
      matched: false,
      reason: "OFFER_NOT_ACTIVE",
    });
  });
});

describe("offer novelty", () => {
  it("ignores URL and retrieval-only changes", () => {
    const original = published();
    const moved = published({
      evidence: {
        ...baseOffer.evidence,
        sourceUrl: "https://retailer.example.invalid/new-url",
        retrievedAt: "2026-08-01T07:00:00.000Z",
      },
    });

    expect(createOfferNoveltyKey(original, ids.retailer)).toBe(
      createOfferNoveltyKey(moved, ids.retailer),
    );
  });

  it.each([
    ["price", { price: { amount: "48.90", currency: "CZK" } }],
    [
      "package",
      {
        package: {
          declared: "500 g",
          quantity: { amount: "500", unit: "gram" },
          count: 1,
        },
      },
    ],
    [
      "validity",
      {
        validity: {
          validFrom: "2026-08-01T00:00:00.000Z",
          validTo: "2026-08-08T23:59:59.000Z",
        },
      },
    ],
    ["membership", { membership: { kind: "loyalty", program: "clubcard" } }],
  ])("changes when %s changes", (_field, change) => {
    expect(createOfferNoveltyKey(published(), ids.retailer)).not.toBe(
      createOfferNoveltyKey(published(change), ids.retailer),
    );
  });
});

describe("groupAndSortMatches", () => {
  it("groups by watched canonical product and sorts by unit, package price, then retailer", () => {
    const matches = [
      matched({
        id: "018f5f70-7b5d-7a21-9f49-01b7f63a9231",
        normalizedUnitPrice: {
          amount: "20.00",
          currency: "CZK",
          unit: "100-gram",
        },
        packagePrice: { amount: "49.90", currency: "CZK" },
        retailer: { id: ids.retailer, name: "Beta" },
      }),
      matched({
        id: "018f5f70-7b5d-7a21-9f49-01b7f63a9232",
        normalizedUnitPrice: {
          amount: "19.00",
          currency: "CZK",
          unit: "100-gram",
        },
        packagePrice: { amount: "59.90", currency: "CZK" },
        retailer: { id: ids.preferredRetailer, name: "Gamma" },
      }),
      matched({
        id: "018f5f70-7b5d-7a21-9f49-01b7f63a9233",
        normalizedUnitPrice: {
          amount: "20.00",
          currency: "CZK",
          unit: "100-gram",
        },
        packagePrice: { amount: "49.90", currency: "CZK" },
        retailer: { id: ids.preferredRetailer, name: "Alpha" },
      }),
    ];

    const groups = groupAndSortMatches(matches);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.matches.map(({ id }) => id)).toEqual([
      "018f5f70-7b5d-7a21-9f49-01b7f63a9232",
      "018f5f70-7b5d-7a21-9f49-01b7f63a9233",
      "018f5f70-7b5d-7a21-9f49-01b7f63a9231",
    ]);
  });
});

function evaluate(
  offerChange: Record<string, unknown> = {},
  retailerChange: Record<string, unknown> = {},
  evaluatedAt = "2026-08-01T12:00:00.000Z",
) {
  return matchOffer(
    baseRule,
    {
      offer: published(offerChange),
      retailer: {
        id: ids.retailer,
        name: "Synthetic Retailer",
        ...retailerChange,
      },
    },
    evaluatedAt,
  );
}

function published(change: Record<string, unknown> = {}) {
  return publishOffer({ ...baseOffer, ...change });
}

function matched(change: Record<string, unknown>) {
  const decision = evaluate();
  if (!decision.matched) throw new Error("Expected synthetic offer to match.");
  return { ...decision.match, ...change };
}
