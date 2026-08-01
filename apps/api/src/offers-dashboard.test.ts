import type { OffersDashboardResponse } from "@shopsmart/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";
import type { ShopSmartAuth } from "./auth.js";

const tenantId = "018f5f70-7b5d-7a21-9f49-01b7f63a9701";
const otherTenantId = "018f5f70-7b5d-7a21-9f49-01b7f63a9702";
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("GET /api/v1/tenants/:tenantId/offers", () => {
  it("uses the session tenant and returns only the validated dashboard view", async () => {
    const dashboard: OffersDashboardResponse = {
      contractVersion: "1",
      tenantId,
      groups: [],
    };
    const list = async (actorTenantId: string) => {
      expect(actorTenantId).toBe(tenantId);
      return dashboard;
    };
    const app = await buildApp(
      { save: async () => never() },
      {
        auth: fakeAuth(tenantId),
        onboardingStore: {} as never,
        dashboardStore: { list },
      },
    );
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/tenants/${tenantId}/offers`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(dashboard);
    await app.ready();
    expect(app.swagger().paths).toHaveProperty(
      "/api/v1/tenants/{tenantId}/offers",
    );
  });

  it("rejects cross-tenant reads before querying the dashboard store", async () => {
    let queried = false;
    const app = await buildApp(
      { save: async () => never() },
      {
        auth: fakeAuth(otherTenantId),
        onboardingStore: {} as never,
        dashboardStore: {
          list: async () => {
            queried = true;
            return { contractVersion: "1", tenantId, groups: [] };
          },
        },
      },
    );
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/tenants/${tenantId}/offers`,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "TENANT_SCOPE_VIOLATION" });
    expect(queried).toBe(false);
  });
});

function fakeAuth(sessionTenantId: string): ShopSmartAuth {
  return {
    handler: async () => new Response(null, { status: 404 }),
    api: {
      getSession: async () => ({
        user: { id: "synthetic-user", tenantId: sessionTenantId },
        session: { id: "synthetic-session" },
      }),
    },
  } as unknown as ShopSmartAuth;
}

function never(): never {
  throw new Error("Normalization is not used by this test.");
}
