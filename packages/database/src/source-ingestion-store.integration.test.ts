import {
  KAUFLAND_PRAHA_VYPICH_SCOPE,
  KAUFLAND_STORE_PARSER_VERSION,
  processKauflandStoreSnapshot,
} from "@shopsmart/connectors";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DataSource } from "typeorm";

import { createAppDataSource } from "./data-source.js";
import {
  QuarantinedSourceCandidateRecord,
  SourceSnapshotRecord,
  TypeOrmSourceIngestionStore,
} from "./source-ingestion-store.js";
import {
  CanonicalProductClassRecord,
  OfferRecord,
  RetailerProductRecord,
} from "./offer-record.js";
import { StoreRecord } from "./onboarding-store.js";

const databaseUrl = process.env.DATABASE_URL;
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
});

async function cleanup(dataSource: DataSource) {
  await dataSource
    .getRepository(QuarantinedSourceCandidateRecord)
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
      scope: KAUFLAND_PRAHA_VYPICH_SCOPE.key,
    })
    .execute();
  await dataSource.getRepository(OfferRecord).delete({
    sourceScopeId: KAUFLAND_PRAHA_VYPICH_SCOPE.sourceScopeId,
  });
  await dataSource.getRepository(RetailerProductRecord).delete({
    retailerId: KAUFLAND_PRAHA_VYPICH_SCOPE.retailerId,
  });
  await dataSource.getRepository(StoreRecord).delete({
    id: KAUFLAND_PRAHA_VYPICH_SCOPE.storeId,
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
