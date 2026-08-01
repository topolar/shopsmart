import type { OffersDashboardResponse } from "@shopsmart/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OffersDashboardView } from "./offers-dashboard";

describe("OffersDashboardView", () => {
  it("renders evidence, freshness, locality, prices, and the concrete source", () => {
    const html = renderToStaticMarkup(
      createElement(OffersDashboardView, { dashboard }),
    );

    expect(html).toContain("Ověřené nabídky");
    expect(html).toContain("Syntetický odtučněný tvaroh");
    expect(html).toContain("19,96");
    expect(html).toContain("49,90");
    expect(html).toContain("Oficiální zdroj");
    expect(html).toContain("Naposledy ověřeno");
    expect(html).toContain(
      'href="https://retailer.example.invalid/offers/curd"',
    );
    expect(html).toContain('aria-labelledby="offers-heading"');
  });
});

const dashboard: OffersDashboardResponse = {
  contractVersion: "1",
  tenantId: "018f5f70-7b5d-7a21-9f49-01b7f63a9801",
  groups: [
    {
      canonicalProductClassId: "018f5f70-7b5d-7a21-9f49-01b7f63a9802",
      canonicalProductClassName: "Syntetický odtučněný tvaroh",
      currency: "CZK",
      comparisonUnit: "100-gram",
      offers: [
        {
          matchId: "a".repeat(64),
          watchRuleId: "018f5f70-7b5d-7a21-9f49-01b7f63a9803",
          offerId: "018f5f70-7b5d-7a21-9f49-01b7f63a9804",
          noveltyKey: `offer-novelty:v1:${"b".repeat(64)}`,
          retailer: {
            id: "018f5f70-7b5d-7a21-9f49-01b7f63a9805",
            name: "Synthetic Retailer",
          },
          exactName: "Syntetický odtučněný tvaroh 250 g",
          variantAttributes: { fatClass: "low-fat" },
          package: {
            declared: "250 g",
            quantity: { amount: "250", unit: "gram" },
            count: 1,
          },
          price: { amount: "49.90", currency: "CZK" },
          regularPrice: { amount: "59.90", currency: "CZK" },
          discountPercent: 17,
          normalizedUnitPrice: {
            amount: "19.96",
            currency: "CZK",
            unit: "100-gram",
          },
          membership: { kind: "none" },
          locality: {
            kind: "physical",
            storeId: "018f5f70-7b5d-7a21-9f49-01b7f63a9806",
            applicability: "store",
          },
          availability: {
            kind: "physical",
            evidence: "flyer-applicability",
            stockStatus: "not-asserted",
          },
          localityName: "Praha – syntetická pobočka",
          validity: {
            validFrom: "2026-08-01T00:00:00.000Z",
            validTo: "2026-08-07T23:59:59.000Z",
          },
          thresholdReason: {
            scope: "fallback",
            predicate: "max-unit-price",
            actual: "19.96",
            limit: "20.00",
          },
          sourceUrl: "https://retailer.example.invalid/offers/curd",
          retrievedAt: "2026-08-01T06:00:00.000Z",
          evidenceLevel: "official",
        },
      ],
    },
  ],
};
