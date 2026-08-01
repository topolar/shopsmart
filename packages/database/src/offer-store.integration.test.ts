import { publishOffer } from "@shopsmart/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createAppDataSource } from "./data-source.js";
import {
  CanonicalProductClassRecord,
  OfferRecord,
  RetailerProductRecord,
} from "./offer-record.js";
import { TypeOrmOfferStore } from "./offer-store.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("offer catalogue persistence", () => {
  const canonicalProductClassId = "018f5f70-7b5d-7a21-9f49-01b7f63a9101";
  const retailerProductId = "018f5f70-7b5d-7a21-9f49-01b7f63a9102";
  let dataSource: ReturnType<typeof createAppDataSource> | undefined;

  beforeAll(async () => {
    dataSource = createAppDataSource(databaseUrl);
    await dataSource.initialize();
    await dataSource.runMigrations();
  });

  beforeEach(async () => {
    if (!dataSource) return;
    await clearCatalogue(dataSource);

    await dataSource.getRepository(CanonicalProductClassRecord).save({
      id: canonicalProductClassId,
      slug: "synthetic-curd",
      name: "Synthetic curd",
      comparisonUnit: "100-gram",
      requiredAttributes: { fatClass: "low-fat" },
      excludedAttributes: {},
    });
    await dataSource.getRepository(RetailerProductRecord).save({
      id: retailerProductId,
      retailerId: "018f5f70-7b5d-7a21-9f49-01b7f63a9103",
      externalId: "synthetic-curd-250",
      canonicalProductClassId,
      exactName: "Synthetic low-fat curd 250 g",
      variantAttributes: { fatClass: "low-fat" },
    });
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    await clearCatalogue(dataSource);
    await dataSource.destroy();
  });

  it("preserves the validated package, price, locality, and evidence", async () => {
    if (!dataSource) throw new Error("Test database was not initialized.");

    const published = publishOffer({
      id: "018f5f70-7b5d-7a21-9f49-01b7f63a9104",
      retailerProductId,
      sourceScopeId: "018f5f70-7b5d-7a21-9f49-01b7f63a9105",
      canonicalProductClassId,
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
      unitPrices: [{ amount: "19.96", currency: "CZK", unit: "100-gram" }],
      membership: { kind: "none" },
      channel: "physical",
      locality: {
        kind: "physical",
        storeId: "018f5f70-7b5d-7a21-9f49-01b7f63a9106",
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
    });

    const saved = await new TypeOrmOfferStore(dataSource).save(published);
    const record = await dataSource.getRepository(OfferRecord).findOneByOrFail({
      id: saved.id,
    });

    expect(record.package).toEqual(published.package);
    expect(record.priceAmount).toBe("49.90");
    expect(record.unitPrices).toEqual(published.unitPrices);
    expect(record.locality).toEqual(published.locality);
    expect(record.availability).toEqual(published.availability);
    expect(record.evidence).toEqual(published.evidence);
    expect(saved).toEqual(published);
  });
});

async function clearCatalogue(
  dataSource: NonNullable<ReturnType<typeof createAppDataSource>>,
) {
  await dataSource
    .getRepository(OfferRecord)
    .createQueryBuilder()
    .delete()
    .execute();
  await dataSource
    .getRepository(RetailerProductRecord)
    .createQueryBuilder()
    .delete()
    .execute();
  await dataSource
    .getRepository(CanonicalProductClassRecord)
    .createQueryBuilder()
    .delete()
    .execute();
}
