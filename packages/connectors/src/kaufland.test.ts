import { describe, expect, it, vi } from "vitest";

import {
  KAUFLAND_PRAHA_VYPICH_SCOPE,
  KAUFLAND_STORE_PARSER_VERSION,
  KauflandAccessError,
  fetchKauflandStorePage,
  processKauflandStoreSnapshot,
  type KauflandProductMapping,
} from "./kaufland.js";

const canonicalBananaId = "018f5f70-7b5d-7a21-9f49-01b7f63a9401";
const canonicalCheeseId = "018f5f70-7b5d-7a21-9f49-01b7f63a9402";
const canonicalCrackersId = "018f5f70-7b5d-7a21-9f49-01b7f63a9403";

const mappings: readonly KauflandProductMapping[] = [
  {
    externalId: "1001",
    canonicalProductClassId: canonicalBananaId,
    comparisonUnit: "kilogram",
    variantAttributes: { preparation: "fresh" },
  },
  {
    externalId: "1002",
    canonicalProductClassId: canonicalCheeseId,
    comparisonUnit: "100-gram",
    variantAttributes: { maturation: "12-month" },
  },
  {
    externalId: "1003",
    canonicalProductClassId: canonicalCrackersId,
    comparisonUnit: "100-gram",
    variantAttributes: {},
  },
];

describe("Kaufland Praha-Vypich connector", () => {
  it("parses mapped physical offers and quarantines uncertain candidates", () => {
    const result = processKauflandStoreSnapshot({
      html: syntheticStorePage,
      httpStatus: 200,
      retrievedAt: "2026-08-01T12:00:00.000Z",
      productMappings: mappings,
    });

    expect(result.status).toBe("parsed");
    expect(result.retrieval).toMatchObject({
      sourceUrl: KAUFLAND_PRAHA_VYPICH_SCOPE.sourceUrl,
      retrievedAt: "2026-08-01T12:00:00.000Z",
      httpStatus: 200,
      parserVersion: KAUFLAND_STORE_PARSER_VERSION,
    });
    expect(result.retrieval.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.retrieval.rawDeleteAt).toBe("2026-08-04T12:00:00.000Z");

    expect(result.offers).toHaveLength(3);
    expect(result.offers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          canonicalProductClassId: canonicalBananaId,
          exactName: "Testovací banány čerstvé",
          price: { amount: "24.90", currency: "CZK" },
          regularPrice: { amount: "39.90", currency: "CZK" },
          discountPercent: 37,
          comparisonUnit: "kilogram",
          unitPrices: [{ amount: "24.90", currency: "CZK", unit: "kilogram" }],
          membership: { kind: "none" },
          channel: "physical",
          locality: {
            kind: "physical",
            storeId: KAUFLAND_PRAHA_VYPICH_SCOPE.storeId,
            applicability: "store",
          },
          availability: {
            kind: "physical",
            evidence: "flyer-applicability",
            stockStatus: "not-asserted",
          },
          validity: {
            validFrom: "2026-07-28T22:00:00.000Z",
            validTo: "2026-08-04T21:59:59.999Z",
          },
          evidence: {
            level: "official",
            sourceUrl: KAUFLAND_PRAHA_VYPICH_SCOPE.sourceUrl,
            verificationUrls: [KAUFLAND_PRAHA_VYPICH_SCOPE.leafletUrl],
            retrievedAt: "2026-08-01T12:00:00.000Z",
          },
          status: "published",
        }),
        expect.objectContaining({
          canonicalProductClassId: canonicalCheeseId,
          price: { amount: "69.90", currency: "CZK" },
          unitPrices: [{ amount: "38.83", currency: "CZK", unit: "100-gram" }],
          membership: { kind: "none" },
        }),
        expect.objectContaining({
          canonicalProductClassId: canonicalCheeseId,
          price: { amount: "63.90", currency: "CZK" },
          unitPrices: [{ amount: "35.50", currency: "CZK", unit: "100-gram" }],
          membership: { kind: "loyalty", program: "Kaufland Card" },
        }),
      ]),
    );
    expect(new Set(result.offers.map(({ id }) => id)).size).toBe(3);
    expect(result.quarantines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalId: "1003",
          reasonCode: "AMBIGUOUS_PACKAGE",
        }),
        expect.objectContaining({
          externalId: "1004",
          reasonCode: "UNMAPPED_PRODUCT",
        }),
      ]),
    );
  });

  it("does not reparse unchanged content unless the parser version changed", () => {
    const first = processKauflandStoreSnapshot({
      html: syntheticStorePage,
      httpStatus: 200,
      retrievedAt: "2026-08-01T12:00:00.000Z",
      productMappings: mappings,
    });
    const unchanged = processKauflandStoreSnapshot({
      html: syntheticStorePage,
      httpStatus: 200,
      retrievedAt: "2026-08-01T18:00:00.000Z",
      previousContentHash: first.retrieval.contentHash,
      previousParserVersion: KAUFLAND_STORE_PARSER_VERSION,
      productMappings: mappings,
    });
    const reparsed = processKauflandStoreSnapshot({
      html: syntheticStorePage,
      httpStatus: 200,
      retrievedAt: "2026-08-01T18:00:00.000Z",
      previousContentHash: first.retrieval.contentHash,
      previousParserVersion: "kaufland-store-v0",
      productMappings: mappings,
    });

    expect(unchanged).toMatchObject({
      status: "unchanged",
      offers: [],
      quarantines: [],
    });
    expect(reparsed.status).toBe("parsed");
    expect(reparsed.offers).toHaveLength(3);
  });

  it("fails closed when the page belongs to a different store or lacks validity", () => {
    const wrongStore = processKauflandStoreSnapshot({
      html: syntheticStorePage.replace(
        "Kaufland Praha-Vypich",
        "Kaufland Jiné město",
      ),
      httpStatus: 200,
      retrievedAt: "2026-08-01T12:00:00.000Z",
      productMappings: mappings,
    });
    const missingValidity = processKauflandStoreSnapshot({
      html: syntheticStorePage.replace(
        "Platí od 29.07.2026 do 04.08.2026",
        "Platnost neuvedena",
      ),
      httpStatus: 200,
      retrievedAt: "2026-08-01T12:00:00.000Z",
      productMappings: mappings,
    });

    expect(wrongStore).toMatchObject({
      status: "quarantined",
      offers: [],
      quarantines: [{ reasonCode: "STORE_SCOPE_MISMATCH" }],
    });
    expect(missingValidity).toMatchObject({
      status: "quarantined",
      offers: [],
      quarantines: [{ reasonCode: "MISSING_VALIDITY" }],
    });
  });

  it("does not invent a loyalty program from an unlabeled price container", () => {
    const result = processKauflandStoreSnapshot({
      html: syntheticStorePage.replace(
        "Tvoje cena s Kaufland Card",
        "Speciální cena",
      ),
      httpStatus: 200,
      retrievedAt: "2026-08-01T12:00:00.000Z",
      productMappings: mappings,
    });

    expect(
      result.offers.filter(
        ({ canonicalProductClassId }) =>
          canonicalProductClassId === canonicalCheeseId,
      ),
    ).toHaveLength(1);
    expect(result.quarantines).toContainEqual(
      expect.objectContaining({
        externalId: "1002",
        reasonCode: "AMBIGUOUS_MEMBERSHIP",
      }),
    );
  });

  it("fetches only allowlisted HTML and refuses an off-host redirect", async () => {
    const successfulFetch = vi.fn(
      async () =>
        new Response(syntheticStorePage, {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
            etag: '"synthetic-etag"',
          },
        }),
    );
    const fetched = await fetchKauflandStorePage({
      fetchImpl: successfulFetch,
      retrievedAt: "2026-08-01T12:00:00.000Z",
    });

    expect(successfulFetch).toHaveBeenCalledWith(
      KAUFLAND_PRAHA_VYPICH_SCOPE.sourceUrl,
      expect.objectContaining({
        redirect: "manual",
        headers: expect.objectContaining({
          accept: "text/html",
        }),
      }),
    );
    expect(fetched).toMatchObject({
      html: syntheticStorePage,
      httpStatus: 200,
      etag: '"synthetic-etag"',
    });

    const redirectingFetch = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://example.invalid/copied-page" },
        }),
    );
    await expect(
      fetchKauflandStorePage({
        fetchImpl: redirectingFetch,
        retrievedAt: "2026-08-01T12:00:00.000Z",
      }),
    ).rejects.toMatchObject({
      code: "UNAPPROVED_REDIRECT",
    } satisfies Partial<KauflandAccessError>);

    const rateLimitedFetch = vi.fn(
      async () =>
        new Response(null, {
          status: 429,
          headers: { "retry-after": "25200" },
        }),
    );
    await expect(
      fetchKauflandStorePage({
        fetchImpl: rateLimitedFetch,
        retrievedAt: "2026-08-01T12:00:00.000Z",
      }),
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryAt: "2026-08-01T19:00:00.000Z",
    } satisfies Partial<KauflandAccessError>);
  });
});

const syntheticStorePage = `<!doctype html>
<html lang="cs">
  <body>
    <main>
      <h1>Kaufland Praha-Vypich</h1>
      <section class="t-tiles-slider">
        <h2>Akční nabídka z aktuálního letáku pro tuto prodejnu</h2>
        <h3>Platí od 29.07.2026 do 04.08.2026</h3>

        <a class="k-product-tile" href="/nabidka/prehled.html?kloffer-articleID=1001">
          <div class="k-product-tile__title">Testovací banány</div>
          <div class="k-product-tile__subtitle">čerstvé</div>
          <div class="k-product-tile__unit-price">1 kg</div>
          <div class="k-product-tile__pricetags-normal">
            <div class="k-price-tag__discount">-37%</div>
            <div class="k-price-tag__price">24,90</div>
            <div class="k-price-tag__old-price-line-through">39,90</div>
          </div>
        </a>

        <a class="k-product-tile" href="/nabidka/prehled.html?kloffer-articleID=1002">
          <div class="k-product-tile__title">Testovací tvrdý sýr</div>
          <div class="k-product-tile__subtitle">zrající 12 měsíců</div>
          <div class="k-product-tile__unit-price">180 g</div>
          <div class="k-product-tile__promo">Tvoje cena s Kaufland Card</div>
          <div class="k-product-tile__pricetags-normal">
            <div class="k-price-tag__discount">-36%</div>
            <div class="k-price-tag__price">69,90</div>
            <div class="k-price-tag__old-price-line-through">109,90</div>
          </div>
          <div class="k-product-tile__pricetags-loyalty">
            <div class="k-price-tag__discount">-41%</div>
            <div class="k-price-tag__price">63,90</div>
            <div class="k-price-tag__old-price-line-through">109,90</div>
          </div>
        </a>

        <a class="k-product-tile" href="/nabidka/prehled.html?kloffer-articleID=1003">
          <div class="k-product-tile__title">Testovací krekry</div>
          <div class="k-product-tile__unit-price">90 g / 100 g</div>
          <div class="k-product-tile__pricetags-normal">
            <div class="k-price-tag__price">12,90</div>
          </div>
        </a>

        <a class="k-product-tile" href="/nabidka/prehled.html?kloffer-articleID=1004">
          <div class="k-product-tile__title">Neznámý syntetický produkt</div>
          <div class="k-product-tile__unit-price">250 g</div>
          <div class="k-product-tile__pricetags-normal">
            <div class="k-price-tag__price">19,90</div>
          </div>
        </a>
      </section>
    </main>
  </body>
</html>`;
