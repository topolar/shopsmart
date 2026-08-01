import { describe, expect, it } from "vitest";

import {
  InvalidDigestFactsError,
  renderNotificationDigest,
} from "./notification.js";

const match = {
  id: "a".repeat(64),
  tenantId: "018f5f70-7b5d-7a21-9f49-01b7f63a9501",
  watchRuleId: "018f5f70-7b5d-7a21-9f49-01b7f63a9502",
  offerId: "018f5f70-7b5d-7a21-9f49-01b7f63a9503",
  canonicalProductClassId: "018f5f70-7b5d-7a21-9f49-01b7f63a9504",
  normalizedUnitPrice: {
    amount: "19.96",
    currency: "CZK",
    unit: "100-gram",
  },
  packagePrice: { amount: "49.90", currency: "CZK" },
  retailer: {
    id: "018f5f70-7b5d-7a21-9f49-01b7f63a9505",
    name: "Synthetic Retailer",
  },
  thresholdReason: {
    scope: "fallback",
    predicate: "max-unit-price",
    actual: "19.96",
    limit: "20.00",
  },
  noveltyKey: `offer-novelty:v1:${"b".repeat(64)}`,
  evaluatedAt: "2026-08-01T12:00:00.000Z",
} as const;

const offer = {
  contractVersion: "1",
  id: match.offerId,
  retailerProductId: "018f5f70-7b5d-7a21-9f49-01b7f63a9506",
  sourceScopeId: "018f5f70-7b5d-7a21-9f49-01b7f63a9507",
  canonicalProductClassId: match.canonicalProductClassId,
  exactName: "Synthetic low-fat curd 250 g",
  variantAttributes: { fatClass: "low-fat" },
  package: {
    declared: "250 g",
    quantity: { amount: "250", unit: "gram" },
    count: 1,
  },
  price: { amount: "49.90", currency: "CZK" },
  regularPrice: { amount: "59.90", currency: "CZK" },
  discountPercent: 17,
  comparisonUnit: "100-gram",
  unitPrices: [match.normalizedUnitPrice],
  membership: { kind: "none" },
  channel: "physical",
  locality: {
    kind: "physical",
    storeId: "018f5f70-7b5d-7a21-9f49-01b7f63a9508",
    applicability: "store",
  },
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
    sourceUrl: "https://retailer.example.invalid/offers/curd",
    verificationUrls: [],
    retrievedAt: "2026-08-01T06:00:00.000Z",
  },
  parserVersion: "synthetic-v1",
  status: "published",
} as const;

describe("renderNotificationDigest", () => {
  it("renders all required validated facts deterministically", () => {
    const payload = renderNotificationDigest({
      tenantId: match.tenantId,
      intervalKey: "2026-08-01T00:00:00Z/2026-08-02T00:00:00Z",
      locale: "cs",
      facts: [{ match, offer }],
    });

    expect(payload.groups[0]?.offers[0]).toMatchObject({
      exactName: offer.exactName,
      package: offer.package,
      price: offer.price,
      normalizedUnitPrice: match.normalizedUnitPrice,
      thresholdReason: match.thresholdReason,
      sourceUrl: offer.evidence.sourceUrl,
      retrievedAt: offer.evidence.retrievedAt,
      validity: offer.validity,
      membership: offer.membership,
      locality: offer.locality,
      availability: offer.availability,
    });
  });

  it.each([
    ["offer", { match, offer: { ...offer, evidence: undefined } }],
    [
      "match identity",
      { match: { ...match, offerId: crypto.randomUUID() }, offer },
    ],
    [
      "normalized price",
      {
        match: {
          ...match,
          normalizedUnitPrice: {
            ...match.normalizedUnitPrice,
            amount: "18.00",
          },
        },
        offer,
      },
    ],
  ])("refuses missing or inconsistent %s facts", (_name, fact) => {
    expectInvalidDigest(() =>
      renderNotificationDigest({
        tenantId: match.tenantId,
        intervalKey: "2026-08-01",
        locale: "cs",
        facts: [fact],
      }),
    );
  });
});

function expectInvalidDigest(action: () => unknown) {
  try {
    action();
    expect.fail("Expected digest rendering to fail closed.");
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidDigestFactsError);
    expect(error).toMatchObject({ code: "INVALID_DIGEST_FACTS" });
  }
}
