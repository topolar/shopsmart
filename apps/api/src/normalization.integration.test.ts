import {
  createAppDataSource,
  NormalizationRecord,
  TypeOrmNormalizationStore,
} from "@shopsmart/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { integrationDatabaseUrl } from "../../../tests/integration-database.js";

import { buildApp } from "./app.js";

const databaseUrl = integrationDatabaseUrl();
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("normalization persistence", () => {
  let dataSource: ReturnType<typeof createAppDataSource> | undefined;
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  beforeAll(async () => {
    dataSource = createAppDataSource(databaseUrl);
    await dataSource.initialize();
    app = await buildApp(new TypeOrmNormalizationStore(dataSource));
  });

  beforeEach(async () => {
    await dataSource?.getRepository(NormalizationRecord).clear();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.getRepository(NormalizationRecord).clear();
    }
    await app?.close();
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  it("persists a normalized unit price through Fastify and TypeORM", async () => {
    if (!app || !dataSource) {
      throw new Error("Test application was not initialized.");
    }

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/normalizations",
      payload: {
        packagePrice: "59.90",
        currency: "CZK",
        packageQuantity: { amount: "8", unit: "piece" },
        comparisonUnit: "piece",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      normalizedUnitPrice: {
        amount: "7.49",
        currency: "CZK",
        unit: "piece",
      },
    });
    expect(await dataSource.getRepository(NormalizationRecord).count()).toBe(1);
  });
});
