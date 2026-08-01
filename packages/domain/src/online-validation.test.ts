import { describe, expect, it } from "vitest";

import {
  confirmOnlineCandidate,
  isServiceAreaContextUsable,
  prequalifyOnlineCandidate,
} from "./online-validation.js";

const ids = {
  tenant: "018f5f70-7b5d-7a21-9f49-01b7f63a9301",
  rule: "018f5f70-7b5d-7a21-9f49-01b7f63a9302",
  canonical: "018f5f70-7b5d-7a21-9f49-01b7f63a9303",
  retailer: "018f5f70-7b5d-7a21-9f49-01b7f63a9304",
  retailerProduct: "018f5f70-7b5d-7a21-9f49-01b7f63a9305",
  sourceScope: "018f5f70-7b5d-7a21-9f49-01b7f63a9306",
  serviceArea: "018f5f70-7b5d-7a21-9f49-01b7f63a9307",
  otherServiceArea: "018f5f70-7b5d-7a21-9f49-01b7f63a9399",
} as const;

const evaluatedAt = "2026-08-01T12:00:00.000Z";
const retailer = { id: ids.retailer, name: "Synthetic Online Retailer" };

const rule = {
  id: ids.rule,
  tenantId: ids.tenant,
  canonicalProductClassId: ids.canonical,
  requiredAttributes: { preparation: "fresh" },
  excludedAttributes: { preparation: ["frozen"] },
  comparisonUnit: "100-gram",
  preferredRetailerIds: [],
  preferredThreshold: {
    maxUnitPrice: { amount: "22.00", currency: "CZK", unit: "100-gram" },
    minDiscountPercent: null,
  },
  fallbackThreshold: {
    maxUnitPrice: { amount: "20.00", currency: "CZK", unit: "100-gram" },
    minDiscountPercent: null,
  },
  acceptedMemberships: [],
  channels: ["online"],
  storeIds: [],
  serviceAreaIds: [ids.serviceArea],
} as const;

const candidate = {
  contractVersion: "1",
  id: "018f5f70-7b5d-7a21-9f49-01b7f63a9310",
  retailerProductId: ids.retailerProduct,
  sourceScopeId: ids.sourceScope,
  canonicalProductClassId: ids.canonical,
  exactName: "Synthetic fresh cheese 250 g",
  variantAttributes: { preparation: "fresh" },
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
  channel: "online",
  locality: {
    kind: "online",
    serviceAreaId: ids.serviceArea,
    fulfilment: "delivery",
  },
  availability: { kind: "online", stockStatus: "unknown" },
  validity: {
    validFrom: "2026-08-01T00:00:00.000Z",
    validTo: null,
  },
  evidence: {
    level: "official",
    sourceUrl: "https://retailer.example.invalid/products/fresh-cheese",
    verificationUrls: [],
    retrievedAt: "2026-08-01T11:30:00.000Z",
  },
  parserVersion: "synthetic-v1",
  status: "candidate",
} as const;

const stockCheck = {
  candidateId: candidate.id,
  serviceAreaId: ids.serviceArea,
  stockStatus: "in-stock",
  checkedAt: "2026-08-01T11:58:00.000Z",
  fulfilment: "delivery",
  fulfilmentDetails: "Delivery to the configured synthetic city",
  deliveryFee: { amount: "49.00", currency: "CZK" },
  minimumBasket: { amount: "500.00", currency: "CZK" },
  fulfilmentWindow: "2026-08-01T16:00:00.000Z/2026-08-01T18:00:00.000Z",
  evidenceUrl: "https://retailer.example.invalid/availability/fresh-cheese",
} as const;

describe("candidate-first online validation", () => {
  it("rejects identity or price before any product-stock check is needed", () => {
    expect(
      prequalifyOnlineCandidate(
        rule,
        {
          ...candidate,
          price: { amount: "59.90", currency: "CZK" },
          unitPrices: [{ amount: "23.96", currency: "CZK", unit: "100-gram" }],
        },
        retailer,
        evaluatedAt,
      ),
    ).toEqual({ eligible: false, reason: "THRESHOLD_NOT_MET" });
  });

  it("publishes and matches only a current in-stock result with fulfilment details", () => {
    const prequalified = prequalifyOnlineCandidate(
      rule,
      candidate,
      retailer,
      evaluatedAt,
    );
    expect(prequalified).toMatchObject({ eligible: true });
    if (!prequalified.eligible) throw new Error("Expected prequalification.");

    const decision = confirmOnlineCandidate(prequalified, stockCheck);

    expect(decision).toMatchObject({
      confirmed: true,
      offer: {
        status: "published",
        availability: {
          kind: "online",
          stockStatus: "in-stock",
          deliveryFee: { amount: "49.00", currency: "CZK" },
          minimumBasket: { amount: "500.00", currency: "CZK" },
          fulfilmentWindow: stockCheck.fulfilmentWindow,
          stockEvidenceUrl: stockCheck.evidenceUrl,
        },
      },
      match: { tenantId: ids.tenant, watchRuleId: ids.rule },
    });
  });

  it.each([
    ["OUT_OF_STOCK", { stockStatus: "out-of-stock" }],
    ["STALE_STOCK_CHECK", { checkedAt: "2026-08-01T11:40:00.000Z" }],
    ["LOCALITY_CHECK_MISMATCH", { serviceAreaId: ids.otherServiceArea }],
    ["FULFILMENT_MISMATCH", { fulfilment: "pickup" }],
  ])("fails closed with %s", (reason, change) => {
    const prequalified = prequalifyOnlineCandidate(
      rule,
      candidate,
      retailer,
      evaluatedAt,
    );
    if (!prequalified.eligible) throw new Error("Expected prequalification.");

    expect(
      confirmOnlineCandidate(prequalified, { ...stockCheck, ...change }),
    ).toEqual({ confirmed: false, reason });
  });
});

describe("service-area cache context", () => {
  const context = {
    serviceAreaId: ids.serviceArea,
    locality: {
      city: "Synthetic City",
      region: "CZ-10",
      postalCodePrefix: "110",
    },
    supported: true,
    sourceUrl: "https://retailer.example.invalid/service-area",
    verifiedAt: "2026-07-25T12:00:00.000Z",
    expiresAt: "2026-08-08T12:00:00.000Z",
  } as const;

  it("uses only a fresh supported context matching the configured coarse locality", () => {
    expect(
      isServiceAreaContextUsable(
        context,
        {
          city: "Synthetic City",
          region: "CZ-10",
          postalCodePrefix: "110",
        },
        evaluatedAt,
      ),
    ).toBe(true);
    expect(
      isServiceAreaContextUsable(
        { ...context, expiresAt: "2026-08-01T11:59:59.000Z" },
        {
          city: "Synthetic City",
          region: "CZ-10",
          postalCodePrefix: "110",
        },
        evaluatedAt,
      ),
    ).toBe(false);
    expect(
      isServiceAreaContextUsable(
        context,
        {
          city: "Other Synthetic City",
          region: "CZ-10",
          postalCodePrefix: "110",
        },
        evaluatedAt,
      ),
    ).toBe(false);
  });
});
