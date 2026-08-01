import { describe, expect, it, vi } from "vitest";

import {
  AlbertAccessError,
  createAlbertExternalId,
  discoverAlbertLeaflets,
  fetchAlbertResource,
  processAlbertLeafletSnapshot,
  processAlbertLeafletTextItems,
} from "./albert.js";

describe("Albert Czech leaflet connector", () => {
  it("discovers the current supermarket and hypermarket PDFs with validity", () => {
    const leaflets = discoverAlbertLeaflets(syntheticLeafletIndex);

    expect(leaflets).toEqual([
      {
        externalId: "3259903",
        kind: "supermarket",
        title: "Albert - 31SM_akcni_letak",
        validFrom: "2026-07-28T22:00:00.000Z",
        validTo: "2026-08-04T21:59:59.999Z",
        viewerUrl: "https://letaky.albert.cz/31sm_akcni_letak/",
        pdfUrl:
          "https://view.publitas.com/90263/3259903/pdfs/supermarket.pdf?response-content-disposition=attachment",
      },
      {
        externalId: "3259898",
        kind: "hypermarket",
        title: "Albert - 31HM_akcni_letak",
        validFrom: "2026-07-28T22:00:00.000Z",
        validTo: "2026-08-04T21:59:59.999Z",
        viewerUrl: "https://letaky.albert.cz/31hm_akcni_letak/",
        pdfUrl:
          "https://view.publitas.com/90263/3259898/pdfs/hypermarket.pdf?response-content-disposition=attachment",
      },
    ]);
  });

  it("fails closed when an advertised PDF leaves the approved Publitas path", () => {
    expect(() =>
      discoverAlbertLeaflets(
        syntheticLeafletIndex.replace(
          "https://view.publitas.com/90263/3259903/pdfs/supermarket.pdf",
          "https://cdn.example.invalid/copied-supermarket.pdf",
        ),
      ),
    ).toThrowError(
      expect.objectContaining({ code: "UNAPPROVED_RESOURCE_URL" }),
    );
  });

  it("rejects redirects, non-PDF responses and oversized resources", async () => {
    const redirectingFetch = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://example.invalid/flyer.pdf" },
        }),
    );
    await expect(
      fetchAlbertResource({
        url: "https://view.publitas.com/90263/3259903/pdfs/supermarket.pdf",
        expected: "pdf",
        fetchImpl: redirectingFetch,
      }),
    ).rejects.toMatchObject({ code: "UNAPPROVED_REDIRECT" });

    const htmlFetch = vi.fn(
      async () =>
        new Response("challenge", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    );
    await expect(
      fetchAlbertResource({
        url: "https://view.publitas.com/90263/3259903/pdfs/supermarket.pdf",
        expected: "pdf",
        fetchImpl: htmlFetch,
      }),
    ).rejects.toBeInstanceOf(AlbertAccessError);

    const oversizedFetch = vi.fn(
      async () =>
        new Response(new Uint8Array(17), {
          status: 200,
          headers: {
            "content-type": "application/pdf",
            "content-length": String(80 * 1_024 * 1_024 + 1),
          },
        }),
    );
    await expect(
      fetchAlbertResource({
        url: "https://view.publitas.com/90263/3259903/pdfs/supermarket.pdf",
        expected: "pdf",
        fetchImpl: oversizedFetch,
      }),
    ).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
  });

  it("preserves fetched PDF bytes when the extractor transfers its input buffer", async () => {
    const pdfBytes = new TextEncoder().encode("synthetic Albert PDF evidence");
    const expectedBytes = [...pdfBytes];

    const result = await processAlbertLeafletSnapshot({
      manifest: supermarketManifest,
      pdfBytes,
      httpStatus: 200,
      retrievedAt: "2026-08-01T12:00:00.000Z",
      productMappings: [],
      extractItems: async (extractionBytes) => {
        structuredClone(extractionBytes, {
          transfer: [extractionBytes.buffer as ArrayBuffer],
        });
        return { totalPages: 1, items: [syntheticStructuredPage] };
      },
    });

    expect([...pdfBytes]).toEqual(expectedBytes);
    expect(result.retrieval.contentHash).not.toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("publishes only mapped, geometrically unambiguous prices and quarantines the rest", () => {
    const radegastExternalId = createAlbertExternalId({
      kind: "supermarket",
      exactName: "Radegast Ryze hořká 12",
      declaredPackage: "0,5 l",
    });
    const majolaExternalId = createAlbertExternalId({
      kind: "supermarket",
      exactName: "Majola Slunečnicový olej",
      declaredPackage: "1 l",
    });
    const magnumExternalId = createAlbertExternalId({
      kind: "supermarket",
      exactName: "Zmrzlina Magnum",
      declaredPackage: "85–110 ml",
    });

    const result = processAlbertLeafletTextItems({
      manifest: supermarketManifest,
      pages: [syntheticStructuredPage],
      pdfBytes: new TextEncoder().encode("synthetic Albert PDF"),
      httpStatus: 200,
      retrievedAt: "2026-08-01T12:00:00.000Z",
      etag: '"synthetic"',
      lastModified: "Mon, 27 Jul 2026 12:55:13 GMT",
      productMappings: [
        {
          externalId: radegastExternalId,
          canonicalProductClassId: "018f5f70-7b5d-7a21-9f49-01b7f63a9401",
          comparisonUnit: "litre",
          variantAttributes: {},
        },
        {
          externalId: majolaExternalId,
          canonicalProductClassId: "018f5f70-7b5d-7a21-9f49-01b7f63a9402",
          comparisonUnit: "litre",
          variantAttributes: {},
        },
        {
          externalId: magnumExternalId,
          canonicalProductClassId: "018f5f70-7b5d-7a21-9f49-01b7f63a9403",
          comparisonUnit: "litre",
          variantAttributes: {},
        },
      ],
    });

    expect(result.status).toBe("parsed");
    expect(result.retrieval).toMatchObject({
      sourceUrl: supermarketManifest.pdfUrl,
      parserVersion: "albert-leaflet-v1",
      rawDeleteAt: "2026-08-04T12:00:00.000Z",
      etag: '"synthetic"',
    });
    expect(result.retrieval.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.offers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exactName: "Radegast Ryze hořká 12",
          price: { amount: "21.90", currency: "CZK" },
          membership: { kind: "none" },
          validity: {
            validFrom: supermarketManifest.validFrom,
            validTo: supermarketManifest.validTo,
          },
          evidence: {
            level: "official",
            sourceUrl: supermarketManifest.pdfUrl,
            verificationUrls: [supermarketManifest.viewerUrl],
            retrievedAt: "2026-08-01T12:00:00.000Z",
          },
          status: "published",
        }),
        expect.objectContaining({
          exactName: "Majola Slunečnicový olej",
          price: { amount: "26.90", currency: "CZK" },
          membership: { kind: "app", program: "Můj Albert" },
          status: "published",
        }),
      ]),
    );
    expect(result.quarantines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalId: magnumExternalId,
          exactName: "Zmrzlina Magnum",
          reasonCode: "AMBIGUOUS_PACKAGE",
        }),
        expect.objectContaining({
          exactName: "Mattoni",
          reasonCode: "UNMAPPED_PRODUCT",
        }),
      ]),
    );
  });
});

const supermarketManifest = {
  externalId: "3259903",
  kind: "supermarket" as const,
  title: "Albert - 31SM_akcni_letak",
  validFrom: "2026-07-28T22:00:00.000Z",
  validTo: "2026-08-04T21:59:59.999Z",
  viewerUrl: "https://letaky.albert.cz/31sm_akcni_letak/",
  pdfUrl:
    "https://view.publitas.com/90263/3259903/pdfs/supermarket.pdf?response-content-disposition=attachment",
};

function item(str: string, x: number, y: number, fontSize: number) {
  return {
    str,
    x,
    y,
    width: str.length * fontSize * 0.5,
    height: fontSize,
    fontSize,
    fontFamily: "Synthetic",
    dir: "ltr",
    hasEOL: true,
  };
}

const syntheticStructuredPage = [
  item("Zmrzlina Magnum", 324, 797, 11),
  item("• 85–110 ml • vybrané druhy", 324, 787, 8),
  item("24", 257, 743, 47.5),
  item("90", 285, 756, 27.7),
  item("BEZ", 266, 722, 5.4),
  item("APLIKACE", 260, 716, 5.4),
  item("Majola", 125, 516, 11),
  item("Slunečnicový olej", 125, 505, 11),
  item("• 1 l", 125, 496, 8),
  item("26", 130, 566, 54.6),
  item("90", 164, 582, 31.9),
  item("BEZ", 142, 542, 6.2),
  item("APLIKACE", 135, 535, 6.2),
  item("Radegast", 244, 521, 11),
  item("Ryze hořká 12", 244, 510, 11),
  item("• světlý ležák", 244, 501, 8),
  item("• 0,5 l • 1 l = 43,80 Kč", 244, 491, 8),
  item("21", 322, 482, 47.5),
  item("90", 346, 495, 27.7),
  item("Mattoni", 226, 90, 11),
  item("• ochucená minerální voda • 1,5 l", 226, 80, 8),
  item("14", 260, 112, 36.5),
  item("90", 279, 123, 21.3),
];

const syntheticLeafletIndex = `<!doctype html>
<html lang="cs">
  <body>
    <script id="__NEXT_DATA__" type="application/json">
      {
        "props": {
          "pageProps": {
            "apolloState": {
              "Leaflet:3259903": {
                "__typename": "Leaflet",
                "id": "3259903",
                "isDefault": true,
                "validityStartDateFormatted": "29.07.2026",
                "validityEndDateFormatted": "04.08.2026",
                "title": "Albert - 31SM_akcni_letak",
                "locationType": "SUPERMARKET",
                "viewUrl": "https://letaky.albert.cz/31sm_akcni_letak/",
                "downloadUrl": "https://view.publitas.com/90263/3259903/pdfs/supermarket.pdf?response-content-disposition=attachment",
                "documentType": "LEAFLET"
              },
              "Leaflet:3259898": {
                "__typename": "Leaflet",
                "id": "3259898",
                "isDefault": true,
                "validityStartDateFormatted": "29.07.2026",
                "validityEndDateFormatted": "04.08.2026",
                "title": "Albert - 31HM_akcni_letak",
                "locationType": "HYPERMARKET",
                "viewUrl": "https://letaky.albert.cz/31hm_akcni_letak/",
                "downloadUrl": "https://view.publitas.com/90263/3259898/pdfs/hypermarket.pdf?response-content-disposition=attachment",
                "documentType": "LEAFLET"
              },
              "Leaflet:3259891": {
                "__typename": "Leaflet",
                "id": "3259891",
                "isDefault": false,
                "validityStartDateFormatted": "29.07.2026",
                "validityEndDateFormatted": "11.08.2026",
                "title": "Albert - brand catalogue",
                "locationType": "HYPERMARKET",
                "viewUrl": "https://letaky.albert.cz/brand/",
                "downloadUrl": "https://view.publitas.com/90263/3259891/pdfs/brand.pdf",
                "documentType": "CATALOGUE"
              }
            }
          }
        }
      }
    </script>
  </body>
</html>`;
