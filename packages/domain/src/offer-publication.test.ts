import { describe, expect, it } from "vitest";

import { OfferPublicationError, publishOffer } from "./offer-publication.js";

const validOffer = {
  id: "018f5f70-7b5d-7a21-9f49-01b7f63a9010",
  retailerProductId: "018f5f70-7b5d-7a21-9f49-01b7f63a9011",
  sourceScopeId: "018f5f70-7b5d-7a21-9f49-01b7f63a9012",
  canonicalProductClassId: "018f5f70-7b5d-7a21-9f49-01b7f63a9013",
  exactName: "Synthetic low-fat curd 250 g",
  variantAttributes: { fatClass: "low-fat", preparation: "fresh" },
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
  locality: {
    kind: "physical",
    storeId: "018f5f70-7b5d-7a21-9f49-01b7f63a9014",
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
    sourceUrl: "https://retailer.example.invalid/offers/curd-250",
    verificationUrls: [],
    retrievedAt: "2026-08-01T06:00:00.000Z",
  },
  parserVersion: "synthetic-v1",
  status: "qualified",
} as const;

describe("publishOffer", () => {
  it("preserves original package and price alongside the comparable unit price", () => {
    const published = publishOffer(validOffer);

    expect(published.status).toBe("published");
    expect(published.package).toEqual(validOffer.package);
    expect(published.price).toEqual(validOffer.price);
    expect(published.unitPrices).toContainEqual({
      amount: "19.96",
      currency: "CZK",
      unit: "100-gram",
    });
  });

  it.each([
    ["identity", { ...validOffer, canonicalProductClassId: undefined }],
    ["package", { ...validOffer, package: undefined }],
    ["validity", { ...validOffer, validity: undefined }],
    ["source", { ...validOffer, evidence: undefined }],
    ["locality", { ...validOffer, locality: undefined }],
    ["availability", { ...validOffer, availability: undefined }],
  ])("fails closed when %s evidence is missing", (_name, candidate) => {
    expectPublicationFailure(candidate, "INVALID_OFFER_CONTRACT");
  });

  it("rejects publication without the configured comparison unit price", () => {
    expectPublicationFailure(
      { ...validOffer, comparisonUnit: "kilogram" },
      "MISSING_COMPARISON_UNIT",
    );
  });

  it("never publishes candidate-only evidence", () => {
    expectPublicationFailure(
      {
        ...validOffer,
        evidence: { ...validOffer.evidence, level: "candidate-only" },
      },
      "INSUFFICIENT_EVIDENCE",
    );
  });

  it("rejects a validity interval that ends before it starts", () => {
    expectPublicationFailure(
      {
        ...validOffer,
        validity: {
          validFrom: "2026-08-08T00:00:00.000Z",
          validTo: "2026-08-07T23:59:59.000Z",
        },
      },
      "INVALID_OFFER_CONTRACT",
    );
  });

  it("rejects non-HTTP evidence URLs", () => {
    expectPublicationFailure(
      {
        ...validOffer,
        evidence: { ...validOffer.evidence, sourceUrl: "file:///tmp/offer" },
      },
      "INVALID_OFFER_CONTRACT",
    );
  });

  it("requires the channel to match its locality evidence", () => {
    expectPublicationFailure(
      { ...validOffer, channel: "online" },
      "INVALID_OFFER_CONTRACT",
    );
  });
});

function expectPublicationFailure(candidate: unknown, code: string) {
  try {
    publishOffer(candidate);
    expect.fail("Expected offer publication to fail closed.");
  } catch (error) {
    expect(error).toBeInstanceOf(OfferPublicationError);
    expect(error).toMatchObject({ code });
  }
}
