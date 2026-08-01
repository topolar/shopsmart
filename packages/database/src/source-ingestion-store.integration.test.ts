import {
  ALBERT_RETAILER_ID,
  ALBERT_SUPERMARKET_SCOPE,
  createAlbertExternalId,
  createGlobusExternalId,
  GLOBUS_BRNO_SCOPE,
  KAUFLAND_PRAHA_VYPICH_SCOPE,
  KAUFLAND_STORE_PARSER_VERSION,
  processAlbertLeafletTextItems,
  processGlobusFeaturedSnapshot,
  processKauflandStoreSnapshot,
} from "@shopsmart/connectors";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DataSource } from "typeorm";

import { integrationDatabaseUrl } from "../../../tests/integration-database.js";

import { createAppDataSource } from "./data-source.js";
import {
  QuarantinedSourceCandidateRecord,
  RetailerProductMappingCandidateRecord,
  SourceSnapshotRecord,
  TypeOrmSourceIngestionStore,
} from "./source-ingestion-store.js";
import {
  CanonicalProductClassRecord,
  OfferRecord,
  RetailerProductRecord,
} from "./offer-record.js";
import { StoreRecord } from "./onboarding-store.js";

const databaseUrl = integrationDatabaseUrl();
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const canonicalProductClassId = "018f5f70-7b5d-7a21-9f49-01b7f63a9501";

describeWithDatabase("Kaufland source ingestion persistence", () => {
  let dataSource: ReturnType<typeof createAppDataSource> | undefined;
  let store: TypeOrmSourceIngestionStore | undefined;

  beforeAll(async () => {
    dataSource = createAppDataSource(databaseUrl);
    await dataSource.initialize();
    await dataSource.runMigrations();
    store = new TypeOrmSourceIngestionStore(dataSource);
  });

  beforeEach(async () => {
    if (!dataSource) return;
    await cleanup(dataSource);
    await dataSource.getRepository(CanonicalProductClassRecord).save({
      id: canonicalProductClassId,
      contractVersion: "1",
      slug: "synthetic-ingestion-bananas",
      name: "Synthetic ingestion bananas",
      comparisonUnit: "kilogram",
      requiredAttributes: {},
      excludedAttributes: {},
    });
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    await cleanup(dataSource);
    await dataSource.destroy();
  });

  it("records retrieval evidence and idempotently upserts shared offers", async () => {
    if (!dataSource || !store) throw new Error("Store was not initialized.");
    const first = processKauflandStoreSnapshot({
      html: syntheticIngestionPage,
      httpStatus: 200,
      retrievedAt: "2026-08-01T12:00:00.000Z",
      etag: '"synthetic-v1"',
      productMappings: [
        {
          externalId: "ingestion-1",
          canonicalProductClassId,
          comparisonUnit: "kilogram",
          variantAttributes: { preparation: "fresh" },
        },
      ],
    });
    const second = processKauflandStoreSnapshot({
      html: syntheticIngestionPage,
      httpStatus: 200,
      retrievedAt: "2026-08-01T18:00:00.000Z",
      etag: '"synthetic-v1"',
      productMappings: [
        {
          externalId: "ingestion-1",
          canonicalProductClassId,
          comparisonUnit: "kilogram",
          variantAttributes: { preparation: "fresh" },
        },
      ],
    });

    await store.persist(first, {
      rawStorageKey: "1785844800000-" + first.retrieval.contentHash + ".html",
    });
    await store.persist(second, {
      rawStorageKey: "1785844800000-" + second.retrieval.contentHash + ".html",
    });

    expect(await dataSource.getRepository(SourceSnapshotRecord).count()).toBe(
      2,
    );
    expect(
      await dataSource.getRepository(RetailerProductRecord).countBy({
        retailerId: KAUFLAND_PRAHA_VYPICH_SCOPE.retailerId,
      }),
    ).toBe(1);
    expect(
      await dataSource.getRepository(OfferRecord).countBy({
        sourceScopeId: KAUFLAND_PRAHA_VYPICH_SCOPE.sourceScopeId,
      }),
    ).toBe(1);
    expect(
      await dataSource.getRepository(StoreRecord).findOneByOrFail({
        id: KAUFLAND_PRAHA_VYPICH_SCOPE.storeId,
      }),
    ).toMatchObject({
      officialName: KAUFLAND_PRAHA_VYPICH_SCOPE.storeName,
      city: KAUFLAND_PRAHA_VYPICH_SCOPE.city,
      sourceUrl: KAUFLAND_PRAHA_VYPICH_SCOPE.sourceUrl,
    });
    expect(
      await dataSource.getRepository(QuarantinedSourceCandidateRecord).find(),
    ).toEqual([
      expect.objectContaining({
        externalId: "unmapped-ingestion-2",
        reasonCode: "UNMAPPED_PRODUCT",
      }),
      expect.objectContaining({
        externalId: "unmapped-ingestion-2",
        reasonCode: "UNMAPPED_PRODUCT",
      }),
    ]);

    const persistedOffer = await dataSource
      .getRepository(OfferRecord)
      .findOneByOrFail({
        sourceScopeId: KAUFLAND_PRAHA_VYPICH_SCOPE.sourceScopeId,
      });
    expect(persistedOffer).toMatchObject({
      status: "published",
      exactName: "Syntetické banány čerstvé",
      parserVersion: KAUFLAND_STORE_PARSER_VERSION,
    });
    expect(persistedOffer.evidence).toMatchObject({
      retrievedAt: "2026-08-01T18:00:00.000Z",
      sourceUrl: KAUFLAND_PRAHA_VYPICH_SCOPE.sourceUrl,
    });
  });

  it("records an unchanged retrieval without duplicating parsed data", async () => {
    if (!dataSource || !store) throw new Error("Store was not initialized.");
    const parsed = processKauflandStoreSnapshot({
      html: syntheticIngestionPage,
      httpStatus: 200,
      retrievedAt: "2026-08-01T12:00:00.000Z",
      productMappings: [],
    });
    const unchanged = processKauflandStoreSnapshot({
      html: syntheticIngestionPage,
      httpStatus: 200,
      retrievedAt: "2026-08-01T18:00:00.000Z",
      previousContentHash: parsed.retrieval.contentHash,
      previousParserVersion: KAUFLAND_STORE_PARSER_VERSION,
      productMappings: [],
    });

    await store.persist(unchanged, { rawStorageKey: null });

    const snapshot = await dataSource
      .getRepository(SourceSnapshotRecord)
      .findOneByOrFail({ sourceScopeKey: KAUFLAND_PRAHA_VYPICH_SCOPE.key });
    expect(snapshot).toMatchObject({
      parseStatus: "unchanged",
      rawStorageKey: null,
      contentHash: parsed.retrieval.contentHash,
    });
    expect(
      await dataSource.getRepository(QuarantinedSourceCandidateRecord).count(),
    ).toBe(0);
    expect(
      await dataSource.getRepository(OfferRecord).countBy({
        sourceScopeId: KAUFLAND_PRAHA_VYPICH_SCOPE.sourceScopeId,
      }),
    ).toBe(0);
  });

  it("retains unmapped candidates and requires one explicit immutable approval", async () => {
    if (!store) throw new Error("Store was not initialized.");
    const parsed = processKauflandStoreSnapshot({
      html: syntheticIngestionPage,
      httpStatus: 200,
      retrievedAt: "2026-08-01T12:00:00.000Z",
      productMappings: [],
    });
    await store.persist(parsed, { rawStorageKey: null });

    const pending = await store.listPendingKauflandMappings();
    expect(pending).toHaveLength(2);
    expect(pending).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalId: "ingestion-1",
          exactName: "Syntetické banány čerstvé",
          status: "pending",
          sourceSnapshotId: expect.any(String),
        }),
      ]),
    );
    const candidate = pending.find(
      ({ externalId }) => externalId === "ingestion-1",
    );
    if (!candidate) throw new Error("Synthetic candidate was not retained.");
    await expect(store.listKauflandCanonicalClasses()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: canonicalProductClassId,
          slug: "synthetic-ingestion-bananas",
          comparisonUnit: "kilogram",
        }),
        expect.objectContaining({
          id: "a1000000-0000-8000-8000-000000000009",
          slug: "fresh-bananas",
          comparisonUnit: "kilogram",
        }),
      ]),
    );
    await expect(
      store.approveKauflandMapping({
        candidateId: candidate.id,
        canonicalProductClassId: "a1000000-0000-8000-8000-000000000009",
        variantAttributes: {},
        reviewedBy: "local-operator",
        reviewedAt: "2026-08-01T12:30:00.000Z",
      }),
    ).rejects.toThrow("MAPPING_ATTRIBUTE_MISMATCH");

    await expect(
      store.approveKauflandMapping({
        candidateId: candidate.id,
        canonicalProductClassId,
        variantAttributes: { preparation: "fresh" },
        reviewedBy: "local-operator",
        reviewedAt: "2026-08-01T12:45:00.000Z",
        allowedSourceScopeKeys: [ALBERT_SUPERMARKET_SCOPE.key],
      }),
    ).rejects.toThrow("MAPPING_CANDIDATE_SCOPE_MISMATCH");

    await expect(
      store.approveKauflandMapping({
        candidateId: candidate.id,
        canonicalProductClassId,
        variantAttributes: { preparation: "fresh" },
        reviewedBy: "local-operator",
        reviewedAt: "2026-08-01T13:00:00.000Z",
        allowedSourceScopeKeys: [KAUFLAND_PRAHA_VYPICH_SCOPE.key],
      }),
    ).resolves.toEqual({
      sourceScopeKey: KAUFLAND_PRAHA_VYPICH_SCOPE.key,
    });

    await expect(store.loadApprovedKauflandMappings()).resolves.toEqual([
      {
        externalId: "ingestion-1",
        canonicalProductClassId,
        comparisonUnit: "kilogram",
        variantAttributes: { preparation: "fresh" },
      },
    ]);
    await expect(
      store.approveKauflandMapping({
        candidateId: candidate.id,
        canonicalProductClassId,
        variantAttributes: {},
        reviewedBy: "second-operator",
        reviewedAt: "2026-08-01T14:00:00.000Z",
      }),
    ).rejects.toThrow("MAPPING_ALREADY_REVIEWED");
  });

  it("persists Albert PDF evidence and its mapping queue through the shared ingestion boundary", async () => {
    if (!dataSource || !store) throw new Error("Store was not initialized.");
    const exactName = "Synthetic Albert bananas";
    const mappedExternalId = createAlbertExternalId({
      kind: "supermarket",
      exactName,
      declaredPackage: "1 kg",
    });
    const result = processAlbertLeafletTextItems({
      manifest: {
        externalId: "3259903",
        kind: "supermarket",
        title: "Synthetic Albert supermarket leaflet",
        validFrom: "2026-07-28T22:00:00.000Z",
        validTo: "2026-08-04T21:59:59.999Z",
        viewerUrl: "https://letaky.albert.cz/synthetic-supermarket/",
        pdfUrl: "https://view.publitas.com/90263/3259903/pdfs/synthetic.pdf",
      },
      pages: [
        [
          structuredItem(exactName, 100, 200, 11),
          structuredItem("• 1 kg", 100, 190, 8),
          structuredItem("24", 130, 220, 40),
          structuredItem("90", 154, 230, 22),
          structuredItem("Unknown Albert cheese", 300, 200, 11),
          structuredItem("• 100 g", 300, 190, 8),
          structuredItem("39", 330, 220, 40),
          structuredItem("90", 354, 230, 22),
        ],
      ],
      pdfBytes: new TextEncoder().encode("synthetic PDF evidence"),
      httpStatus: 200,
      retrievedAt: "2026-08-01T12:00:00.000Z",
      productMappings: [
        {
          externalId: mappedExternalId,
          canonicalProductClassId,
          comparisonUnit: "kilogram",
          variantAttributes: { preparation: "fresh" },
        },
      ],
    });

    await store.persistAlbert(result, {
      manifest: {
        externalId: "3259903",
        kind: "supermarket",
        title: "Synthetic Albert supermarket leaflet",
        validFrom: "2026-07-28T22:00:00.000Z",
        validTo: "2026-08-04T21:59:59.999Z",
        viewerUrl: "https://letaky.albert.cz/synthetic-supermarket/",
        pdfUrl: "https://view.publitas.com/90263/3259903/pdfs/synthetic.pdf",
      },
      rawStorageKey: `1785844800000-${result.retrieval.contentHash}.pdf`,
    });

    await expect(
      dataSource.getRepository(StoreRecord).findOneByOrFail({
        id: ALBERT_SUPERMARKET_SCOPE.storeId,
      }),
    ).resolves.toMatchObject({
      retailerId: ALBERT_RETAILER_ID,
      officialName: ALBERT_SUPERMARKET_SCOPE.storeName,
      city: "Czech Republic",
    });
    await expect(
      dataSource.getRepository(OfferRecord).countBy({
        sourceScopeId: ALBERT_SUPERMARKET_SCOPE.sourceScopeId,
      }),
    ).resolves.toBe(1);
    await expect(
      store.listPendingAlbertMappings("supermarket"),
    ).resolves.toEqual([
      expect.objectContaining({
        exactName: "Unknown Albert cheese — 100 g",
        status: "pending",
      }),
    ]);
  });

  it("persists Globus Brno evidence and exposes its immutable mapping queue", async () => {
    if (!dataSource || !store) throw new Error("Store was not initialized.");
    const exactName = "Synthetic Globus bananas";
    const externalId = createGlobusExternalId({
      exactName,
      declaredPackage: "1 kg",
    });
    const result = processGlobusFeaturedSnapshot({
      html: syntheticGlobusPage,
      httpStatus: 200,
      retrievedAt: "2026-08-01T12:00:00.000Z",
      productMappings: [],
    });
    await store.persistGlobus(result, {
      rawStorageKey: `1785844800000-${result.retrieval.contentHash}.html`,
    });

    await expect(
      store.latestRetainedRetrieval(GLOBUS_BRNO_SCOPE.key),
    ).resolves.toMatchObject({
      contentHash: result.retrieval.contentHash,
      rawStorageKey: `1785844800000-${result.retrieval.contentHash}.html`,
      sourceUrl: GLOBUS_BRNO_SCOPE.sourceUrl,
    });

    await expect(store.listPendingGlobusMappings()).resolves.toEqual([
      expect.objectContaining({
        externalId,
        exactName: `${exactName} — 1 kg`,
        status: "pending",
      }),
    ]);
    const candidate = (await store.listPendingGlobusMappings())[0]!;
    await store.approveKauflandMapping({
      candidateId: candidate.id,
      canonicalProductClassId,
      variantAttributes: {},
      reviewedBy: "local-operator",
      reviewedAt: "2026-08-01T13:00:00.000Z",
      allowedSourceScopeKeys: [GLOBUS_BRNO_SCOPE.key],
    });
    await expect(store.loadApprovedGlobusMappings()).resolves.toEqual([
      {
        externalId,
        canonicalProductClassId,
        comparisonUnit: "kilogram",
        variantAttributes: {},
      },
    ]);
    await expect(
      dataSource.getRepository(StoreRecord).findOneByOrFail({
        id: GLOBUS_BRNO_SCOPE.storeId,
      }),
    ).resolves.toMatchObject({ officialName: "Globus Brno", city: "Brno" });
  });
});

function structuredItem(str: string, x: number, y: number, fontSize: number) {
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

async function cleanup(dataSource: DataSource) {
  await dataSource
    .getRepository(RetailerProductMappingCandidateRecord)
    .delete({ sourceScopeKey: GLOBUS_BRNO_SCOPE.key });
  await dataSource
    .getRepository(QuarantinedSourceCandidateRecord)
    .delete({ sourceScopeKey: GLOBUS_BRNO_SCOPE.key });
  await dataSource
    .getRepository(SourceSnapshotRecord)
    .delete({ sourceScopeKey: GLOBUS_BRNO_SCOPE.key });
  await dataSource.getRepository(OfferRecord).delete({
    sourceScopeId: GLOBUS_BRNO_SCOPE.sourceScopeId,
  });
  await dataSource.getRepository(RetailerProductRecord).delete({
    retailerId: GLOBUS_BRNO_SCOPE.retailerId,
  });
  await dataSource.getRepository(StoreRecord).delete({
    id: GLOBUS_BRNO_SCOPE.storeId,
  });
  await dataSource
    .getRepository(RetailerProductMappingCandidateRecord)
    .createQueryBuilder()
    .delete()
    .where("source_scope_key = :scope", {
      scope: KAUFLAND_PRAHA_VYPICH_SCOPE.key,
    })
    .execute();
  await dataSource
    .getRepository(RetailerProductMappingCandidateRecord)
    .createQueryBuilder()
    .delete()
    .where("source_scope_key = :scope", {
      scope: ALBERT_SUPERMARKET_SCOPE.key,
    })
    .execute();
  await dataSource
    .getRepository(QuarantinedSourceCandidateRecord)
    .createQueryBuilder()
    .delete()
    .where("source_scope_key = :scope", {
      scope: KAUFLAND_PRAHA_VYPICH_SCOPE.key,
    })
    .execute();
  await dataSource
    .getRepository(QuarantinedSourceCandidateRecord)
    .createQueryBuilder()
    .delete()
    .where("source_scope_key = :scope", {
      scope: ALBERT_SUPERMARKET_SCOPE.key,
    })
    .execute();
  await dataSource
    .getRepository(SourceSnapshotRecord)
    .createQueryBuilder()
    .delete()
    .where("source_scope_key = :scope", {
      scope: KAUFLAND_PRAHA_VYPICH_SCOPE.key,
    })
    .execute();
  await dataSource
    .getRepository(SourceSnapshotRecord)
    .createQueryBuilder()
    .delete()
    .where("source_scope_key = :scope", {
      scope: ALBERT_SUPERMARKET_SCOPE.key,
    })
    .execute();
  await dataSource.getRepository(OfferRecord).delete({
    sourceScopeId: KAUFLAND_PRAHA_VYPICH_SCOPE.sourceScopeId,
  });
  await dataSource.getRepository(RetailerProductRecord).delete({
    retailerId: KAUFLAND_PRAHA_VYPICH_SCOPE.retailerId,
  });
  await dataSource.getRepository(OfferRecord).delete({
    sourceScopeId: ALBERT_SUPERMARKET_SCOPE.sourceScopeId,
  });
  await dataSource.getRepository(RetailerProductRecord).delete({
    retailerId: ALBERT_RETAILER_ID,
  });
  await dataSource.getRepository(StoreRecord).delete({
    id: KAUFLAND_PRAHA_VYPICH_SCOPE.storeId,
  });
  await dataSource.getRepository(StoreRecord).delete({
    id: ALBERT_SUPERMARKET_SCOPE.storeId,
  });
  await dataSource.getRepository(CanonicalProductClassRecord).delete({
    id: canonicalProductClassId,
  });
}

const syntheticIngestionPage = `<!doctype html>
<html lang="cs"><body><main>
  <h1>Kaufland Praha-Vypich</h1>
  <section class="t-tiles-slider">
    <h2>Akční nabídka z aktuálního letáku pro tuto prodejnu</h2>
    <h3>Platí od 29.07.2026 do 04.08.2026</h3>
    <a class="k-product-tile" href="/nabidka/prehled.html?kloffer-articleID=ingestion-1">
      <div class="k-product-tile__title">Syntetické banány</div>
      <div class="k-product-tile__subtitle">čerstvé</div>
      <div class="k-product-tile__unit-price">1 kg</div>
      <div class="k-product-tile__pricetags-normal">
        <div class="k-price-tag__price">24,90</div>
      </div>
    </a>
    <a class="k-product-tile" href="/nabidka/prehled.html?kloffer-articleID=unmapped-ingestion-2">
      <div class="k-product-tile__title">Neznámý syntetický produkt</div>
      <div class="k-product-tile__unit-price">1 kg</div>
      <div class="k-product-tile__pricetags-normal">
        <div class="k-price-tag__price">99,90</div>
      </div>
    </a>
  </section>
</main></body></html>`;

const syntheticGlobusPage = `<!doctype html><main><section data-featured-offers>
  <h2>Akční nabídka Brno</h2>
  <article data-featured-offer>
    <h3>Synthetic Globus bananas</h3><p data-package>1 kg</p>
    <p data-unit-price data-price-kind="public">24,90 Kč / kg</p>
    <p data-price-kind="public">24,90 Kč</p>
    <p data-validity>Platné do: 4. 8.</p>
  </article>
</section></main>`;
