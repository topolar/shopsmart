import type {
  NormalizeUnitPriceRequest,
  NormalizeUnitPriceResponse,
} from "@shopsmart/contracts";
import type { NormalizationStore } from "@shopsmart/database";
import type { NormalizedUnitPrice } from "@shopsmart/domain";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("POST /api/v1/normalizations", () => {
  it("validates, normalizes, and persists through the store port", async () => {
    const store = new FakeNormalizationStore();
    const app = await buildApp(store);
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/normalizations",
      payload: {
        packagePrice: "49.90",
        currency: "CZK",
        packageQuantity: { amount: "250", unit: "gram" },
        comparisonUnit: "100-gram",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      normalizedUnitPrice: {
        amount: "19.96",
        currency: "CZK",
        unit: "100-gram",
      },
    });
    expect(store.saved).toHaveLength(1);
  });

  it("fails closed for incompatible unit families", async () => {
    const app = await buildApp(new FakeNormalizationStore());
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/normalizations",
      payload: {
        packagePrice: "49.90",
        currency: "CZK",
        packageQuantity: { amount: "250", unit: "gram" },
        comparisonUnit: "piece",
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: "INCOMPATIBLE_UNIT" });
  });

  it("publishes the route in generated OpenAPI", async () => {
    const app = await buildApp(new FakeNormalizationStore());
    apps.push(app);
    await app.ready();

    const document = app.swagger();
    expect(document.paths).toHaveProperty("/api/v1/normalizations");
  });
});

class FakeNormalizationStore implements NormalizationStore {
  readonly saved: NormalizeUnitPriceRequest[] = [];

  async save(
    request: NormalizeUnitPriceRequest,
    normalized: NormalizedUnitPrice,
  ): Promise<NormalizeUnitPriceResponse> {
    this.saved.push(request);
    return {
      id: "018f5f70-7b5d-7a21-9f49-01b7f63a9001",
      normalizedUnitPrice: {
        amount: normalized.amount,
        currency: request.currency,
        unit: normalized.unit,
      },
      createdAt: "2026-08-01T00:00:00.000Z",
    };
  }
}
