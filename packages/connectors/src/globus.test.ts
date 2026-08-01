import { describe, expect, it, vi } from "vitest";

import {
  createGlobusExternalId,
  fetchGlobusFeaturedPage,
  GLOBUS_BRNO_SCOPE,
  GlobusAccessError,
  processGlobusFeaturedSnapshot,
} from "./globus.js";

describe("Globus Brno featured-offer connector", () => {
  it("quarantines stable retailer products until an operator approves mappings", () => {
    const result = processGlobusFeaturedSnapshot({
      html: syntheticPage,
      httpStatus: 200,
      retrievedAt: "2026-08-01T12:00:00.000Z",
      productMappings: [],
    });

    expect(result.status).toBe("parsed");
    expect(result.offers).toEqual([]);
    expect(result.quarantines).toEqual([
      {
        externalId: createGlobusExternalId({
          exactName: "Trvanlivé mléko plnotučné 3,5 %",
          declaredPackage: "1 l",
        }),
        exactName: "Trvanlivé mléko plnotučné 3,5 %",
        declaredPackage: "1 l",
        reasonCode: "UNMAPPED_PRODUCT",
      },
      {
        externalId: createGlobusExternalId({
          exactName: "Meloun vodní červený",
          declaredPackage: "1 kg",
        }),
        exactName: "Meloun vodní červený",
        declaredPackage: "1 kg",
        reasonCode: "UNMAPPED_PRODUCT",
      },
    ]);
  });

  it("keeps public and clearly labelled Můj Globus prices as separate offers", () => {
    const milkExternalId = createGlobusExternalId({
      exactName: "Trvanlivé mléko plnotučné 3,5 %",
      declaredPackage: "1 l",
    });
    const melonExternalId = createGlobusExternalId({
      exactName: "Meloun vodní červený",
      declaredPackage: "1 kg",
    });
    const result = processGlobusFeaturedSnapshot({
      html: syntheticPage,
      httpStatus: 200,
      retrievedAt: "2026-08-01T12:00:00.000Z",
      productMappings: [
        {
          externalId: milkExternalId,
          canonicalProductClassId: "018f5f70-7b5d-7a21-9f49-01b7f63a9501",
          comparisonUnit: "litre",
          variantAttributes: { fatClass: "3.5%" },
        },
        {
          externalId: melonExternalId,
          canonicalProductClassId: "018f5f70-7b5d-7a21-9f49-01b7f63a9502",
          comparisonUnit: "kilogram",
          variantAttributes: {},
        },
      ],
    });

    expect(result.offers).toHaveLength(3);
    expect(result.offers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exactName: "Trvanlivé mléko plnotučné 3,5 %",
          price: { amount: "12.90", currency: "CZK" },
          membership: { kind: "none" },
          locality: {
            kind: "physical",
            storeId: GLOBUS_BRNO_SCOPE.storeId,
            applicability: "store",
          },
          validity: {
            validFrom: "2026-07-31T22:00:00.000Z",
            validTo: "2026-08-04T21:59:59.999Z",
          },
          evidence: expect.objectContaining({
            level: "official",
            sourceUrl: GLOBUS_BRNO_SCOPE.sourceUrl,
            retrievedAt: "2026-08-01T12:00:00.000Z",
          }),
          status: "published",
        }),
        expect.objectContaining({
          exactName: "Trvanlivé mléko plnotučné 3,5 %",
          price: { amount: "8.90", currency: "CZK" },
          membership: { kind: "loyalty", program: "Můj Globus" },
          status: "published",
        }),
        expect.objectContaining({
          exactName: "Meloun vodní červený",
          price: { amount: "7.90", currency: "CZK" },
          membership: { kind: "none" },
          status: "published",
        }),
      ]),
    );
  });

  it("fails closed when the Brno heading or an explicit membership label is missing", () => {
    const mismatched = processGlobusFeaturedSnapshot({
      html: syntheticPage.replace("Akční nabídka Brno", "Akční nabídka Praha"),
      httpStatus: 200,
      retrievedAt: "2026-08-01T12:00:00.000Z",
      productMappings: [],
    });
    expect(mismatched.quarantines).toEqual([
      expect.objectContaining({ reasonCode: "STORE_SCOPE_MISMATCH" }),
    ]);

    const ambiguous = processGlobusFeaturedSnapshot({
      html: syntheticPage.replace("Můj Globus", "Klubová cena"),
      httpStatus: 200,
      retrievedAt: "2026-08-01T12:00:00.000Z",
      productMappings: [
        {
          externalId: createGlobusExternalId({
            exactName: "Trvanlivé mléko plnotučné 3,5 %",
            declaredPackage: "1 l",
          }),
          canonicalProductClassId: "018f5f70-7b5d-7a21-9f49-01b7f63a9501",
          comparisonUnit: "litre",
          variantAttributes: {},
        },
      ],
    });
    expect(ambiguous.quarantines).toContainEqual(
      expect.objectContaining({ reasonCode: "AMBIGUOUS_MEMBERSHIP" }),
    );
    expect(ambiguous.offers).toHaveLength(1);
    expect(ambiguous.offers[0]?.membership).toEqual({ kind: "none" });
  });

  it("rejects redirects to disallowed detail paths and access challenges", async () => {
    const redirectingFetch = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: {
            location: "/brno/hypermarket/akcni-nabidka/vsechny-produkty",
          },
        }),
    );
    await expect(
      fetchGlobusFeaturedPage({
        retrievedAt: "2026-08-01T12:00:00.000Z",
        fetchImpl: redirectingFetch,
      }),
    ).rejects.toMatchObject({ code: "UNAPPROVED_REDIRECT" });

    const challengeFetch = vi.fn(
      async () =>
        new Response("<html><title>Attention Required</title>captcha</html>", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
    );
    await expect(
      fetchGlobusFeaturedPage({
        retrievedAt: "2026-08-01T12:00:00.000Z",
        fetchImpl: challengeFetch,
      }),
    ).rejects.toBeInstanceOf(GlobusAccessError);
  });

  it("discovers SSR cards without following their robot-denied product links", () => {
    const result = processGlobusFeaturedSnapshot({
      html: ssrPageShape,
      httpStatus: 200,
      retrievedAt: "2026-08-01T12:00:00.000Z",
      productMappings: [],
    });
    expect(result.status).toBe("parsed");
    expect(result.quarantines).toEqual([
      expect.objectContaining({
        exactName: "Pragolaktos Trvanlivé mléko 3,5% plnotučné mléko 1l",
        declaredPackage: "1 l",
        reasonCode: "UNMAPPED_PRODUCT",
      }),
    ]);
  });
});

const syntheticPage = `<!doctype html>
<html lang="cs">
  <body>
    <main>
      <section data-featured-offers>
        <h2>Akční nabídka Brno</h2>
        <article data-featured-offer>
          <h3>Trvanlivé mléko plnotučné 3,5 %</h3>
          <p data-package>1 l</p>
          <p data-unit-price data-price-kind="public">12,90 Kč / l</p>
          <p data-price-kind="public">12,90 Kč</p>
          <p data-unit-price data-price-kind="loyalty">8,90 Kč / l</p>
          <p data-price-kind="loyalty"><span>Můj Globus</span> 8,90 Kč</p>
          <p data-validity>Platné 1. 8. – 4. 8.</p>
        </article>
        <article data-featured-offer>
          <h3>Meloun vodní červený</h3>
          <p data-package>1 kg</p>
          <p data-unit-price data-price-kind="public">7,90 Kč / kg</p>
          <p data-price-kind="public">7,90 Kč</p>
          <p data-validity>Platné do: 4. 8.</p>
        </article>
      </section>
    </main>
  </body>
</html>`;

const ssrPageShape = `<!doctype html><main>
  <section class="container space-y-4">
    <h2>Akční nabídka <span>Brno</span></h2>
    <p class="legend">Můj Globus</p>
    <div class="grid grid-cols-2 lg:grid-cols-3">
      <div class="isolate shadow-md rounded-2.5xl relative flex flex-col">
        <div><img alt="Pragolaktos Trvanlivé mléko 3,5% plnotučné mléko 1l"></div>
        <div class="mt-4">
          <h3><a href="/brno/hypermarket/akcni-nabidka/p/denied-product">Pragolaktos Trvanlivé mléko 3,5% plnotučné mléko 1l</a></h3>
          <div class="unit-prices"><span>12,90 Kč/ 1 l</span><span class="loyalty-unit"><i></i>8,90 Kč/ 1 l</span></div>
        </div>
        <div>
          <div aria-label="12.9 Kč - Výhodně" class="text-price-sale"><span>12</span><sup>90</sup></div>
          <div class="text-brand-globus-green-dark"><span aria-label="8,90 Kč">8<sup>90</sup></span></div>
          <span>Platné do: 4.8.</span>
        </div>
      </div>
    </div>
  </section>
</main>`;
