import {
  createAppDataSource,
  LoyaltyMembershipRecord,
  NotificationPreferenceRecord,
  OnboardingProfileRecord,
  StoreRecord,
  TypeOrmNormalizationStore,
  TypeOrmOnboardingStore,
  UserStoreAccessRecord,
} from "@shopsmart/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";
import { createShopSmartAuth } from "./auth.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const testStoreId = "018f5f70-7b5d-7a21-9f49-01b7f63a9401";

describeWithDatabase("authenticated tenant onboarding", () => {
  let dataSource: ReturnType<typeof createAppDataSource> | undefined;
  let authRuntime: ReturnType<typeof createShopSmartAuth> | undefined;
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  beforeAll(async () => {
    dataSource = createAppDataSource(databaseUrl);
    await dataSource.initialize();
    await dataSource.runMigrations();
    authRuntime = createShopSmartAuth({
      databaseUrl: databaseUrl!,
      dataSource,
      secret: "synthetic-integration-secret-32-characters-minimum",
      baseURL: "http://localhost:3000",
      trustedOrigins: ["http://localhost:3000"],
      rateLimitEnabled: false,
    });
    app = await buildApp(new TypeOrmNormalizationStore(dataSource), {
      auth: authRuntime.auth,
      onboardingStore: new TypeOrmOnboardingStore(dataSource),
    });
  });

  beforeEach(async () => {
    if (!dataSource) return;
    await clearSyntheticUsers(dataSource);
    await dataSource.getRepository(StoreRecord).save({
      id: testStoreId,
      retailerId: "018f5f70-7b5d-7a21-9f49-01b7f63a9402",
      officialName: "Synthetic public store",
      city: "Praha",
      sourceUrl: "https://retailer.example.invalid/stores/synthetic",
    });
  });

  afterAll(async () => {
    await app?.close();
    await authRuntime?.close();
    if (dataSource?.isInitialized) {
      await clearSyntheticUsers(dataSource);
      await dataSource.destroy();
    }
  });

  it("persists a Czech onboarding profile from a database-validated session", async () => {
    if (!app || !dataSource) throw new Error("Test app was not initialized.");
    const account = await register("integration-a@example.invalid");

    const response = await app.inject({
      method: "PUT",
      url: `/api/v1/tenants/${account.tenantId}/onboarding`,
      headers: { cookie: account.cookie, origin: "http://localhost:3000" },
      payload: {
        locale: "cs",
        locality: {
          city: "Praha",
          region: "Hlavní město Praha",
          postalCodePrefix: "110",
        },
        storeIds: [testStoreId],
        onlineChannelKeys: ["synthetic-online"],
        loyaltyPrograms: ["clubcard"],
        notification: {
          emailDigestEnabled: true,
          timezone: "Europe/Prague",
        },
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      tenantId: account.tenantId,
      locale: "cs",
      locality: { city: "Praha", postalCodePrefix: "110" },
      completed: true,
    });
    expect(
      await dataSource.getRepository(OnboardingProfileRecord).countBy({
        tenantId: account.tenantId,
      }),
    ).toBe(1);
    expect(
      await dataSource.getRepository(NotificationPreferenceRecord).countBy({
        tenantId: account.tenantId,
      }),
    ).toBe(1);
    expect(
      await dataSource.getRepository(UserStoreAccessRecord).countBy({
        tenantId: account.tenantId,
        storeId: testStoreId,
      }),
    ).toBe(1);
    expect(
      await dataSource.getRepository(LoyaltyMembershipRecord).countBy({
        tenantId: account.tenantId,
        programKey: "clubcard",
      }),
    ).toBe(1);
  });

  it("rejects exact street-address fields instead of retaining them", async () => {
    if (!app || !dataSource) throw new Error("Test app was not initialized.");
    const account = await register("integration-a@example.invalid");

    const response = await app.inject({
      method: "PUT",
      url: `/api/v1/tenants/${account.tenantId}/onboarding`,
      headers: { cookie: account.cookie, origin: "http://localhost:3000" },
      payload: {
        locale: "cs",
        locality: {
          city: "Praha",
          region: "Hlavní město Praha",
          street: "Synthetic private street 1",
        },
        storeIds: [testStoreId],
        onlineChannelKeys: [],
        loyaltyPrograms: [],
        notification: {
          emailDigestEnabled: false,
          timezone: "Europe/Prague",
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(
      await dataSource.getRepository(OnboardingProfileRecord).countBy({
        tenantId: account.tenantId,
      }),
    ).toBe(0);
  });

  it("rejects a valid session when it targets another tenant", async () => {
    if (!app) throw new Error("Test app was not initialized.");
    const accountA = await register("integration-a@example.invalid");
    const accountB = await register("integration-b@example.invalid");

    const response = await app.inject({
      method: "PUT",
      url: `/api/v1/tenants/${accountA.tenantId}/onboarding`,
      headers: { cookie: accountB.cookie, origin: "http://localhost:3000" },
      payload: {
        locale: "cs",
        locality: { city: "Praha", region: "Hlavní město Praha" },
        storeIds: [],
        onlineChannelKeys: ["synthetic-online"],
        loyaltyPrograms: [],
        notification: {
          emailDigestEnabled: false,
          timezone: "Europe/Prague",
        },
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "TENANT_SCOPE_VIOLATION" });
  });

  async function register(email: string) {
    if (!app) throw new Error("Test app was not initialized.");
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      payload: { name: "Synthetic User", email, password: "Synt3tic-pass!" },
    });
    expect(response.statusCode, response.body).toBe(200);
    const cookie = response.headers["set-cookie"];
    expect(Array.isArray(cookie) || typeof cookie === "string").toBe(true);
    const payload = response.json() as { user?: { tenantId?: string } };
    expect(payload.user?.tenantId).toBeTypeOf("string");
    return {
      cookie: Array.isArray(cookie) ? cookie[0]! : cookie!,
      tenantId: payload.user!.tenantId!,
    };
  }
});

async function clearSyntheticUsers(
  dataSource: NonNullable<ReturnType<typeof createAppDataSource>>,
) {
  const rows = (await dataSource.query(
    `SELECT "tenantId" FROM "user" WHERE "email" LIKE 'integration-%@example.invalid'`,
  )) as { tenantId: string }[];
  if (rows.length > 0) {
    const tenantIds = rows.map(({ tenantId }) => tenantId);
    await dataSource
      .getRepository("TenantRecord")
      .createQueryBuilder()
      .delete()
      .where("id IN (:...tenantIds)", { tenantIds })
      .execute();
  }
  await dataSource
    .getRepository(StoreRecord)
    .createQueryBuilder()
    .delete()
    .where("id = :id", { id: testStoreId })
    .execute();
}
