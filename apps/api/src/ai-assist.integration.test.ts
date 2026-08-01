import {
  AiAssistCacheRecord,
  AiAssistFailureRecord,
  AiAssistProposalRecord,
  AiAssistReviewRecord,
  SourceSnapshotRecord,
  TypeOrmAiAssistStore,
  TypeOrmNormalizationStore,
  TypeOrmOnboardingStore,
  TypeOrmOperatorStore,
  createAppDataSource,
} from "@shopsmart/database";
import { validateAiAssistCandidate } from "@shopsmart/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { integrationDatabaseUrl } from "../../../tests/integration-database.js";

import { buildApp } from "./app.js";
import { createShopSmartAuth } from "./auth.js";

const databaseUrl = integrationDatabaseUrl();
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const sourceHash = "c".repeat(64);

describeWithDatabase("authenticated AI-assist operator review API", () => {
  let dataSource: ReturnType<typeof createAppDataSource> | undefined;
  let authRuntime: ReturnType<typeof createShopSmartAuth> | undefined;
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  let store: TypeOrmAiAssistStore | undefined;

  beforeAll(async () => {
    dataSource = createAppDataSource(databaseUrl);
    await dataSource.initialize();
    await dataSource.runMigrations();
    store = new TypeOrmAiAssistStore(dataSource);
    authRuntime = createShopSmartAuth({
      databaseUrl: databaseUrl!,
      dataSource,
      secret: "synthetic-ai-review-secret-32-characters-minimum",
      baseURL: "http://localhost:3000",
      trustedOrigins: ["http://localhost:3000"],
      rateLimitEnabled: false,
    });
    app = await buildApp(new TypeOrmNormalizationStore(dataSource), {
      auth: authRuntime.auth,
      onboardingStore: new TypeOrmOnboardingStore(dataSource),
      aiAssistStore: store,
    });
  });

  beforeEach(async () => {
    if (!dataSource || !store) return;
    await cleanup(dataSource);
    const snapshot = await dataSource.getRepository(SourceSnapshotRecord).save({
      sourceScopeKey: "synthetic:ai-review",
      sourceUrl: "https://retailer.example.invalid/flyer/approved",
      retrievedAt: new Date("2026-08-01T12:00:00.000Z"),
      httpStatus: 200,
      contentHash: sourceHash,
      parserVersion: "synthetic-v1",
      parseStatus: "quarantined",
      etag: null,
      lastModified: null,
      rawStorageKey: null,
      rawDeleteAt: new Date("2026-08-04T12:00:00.000Z"),
      rawDeletedAt: null,
    });
    await store.saveValidation(
      validateAiAssistCandidate(flyerProposal(snapshot.id), {
        sourceContentHash: sourceHash,
        sourceLength: 500,
        mappingCandidateId: null,
        allowedCanonicalProductClassIds: [],
        allowedStoreIds: ["018f5f70-7b5d-7a21-9f49-01b7f63ab004"],
        sourceUrl: "https://retailer.example.invalid/flyer/approved",
        budget: {
          maxInputTokens: 2_000,
          maxOutputTokens: 500,
          maxCostMicros: 20_000,
        },
        minimumConfidence: 0.8,
        taskKind: "flyer-extraction",
      }),
    );
  });

  afterAll(async () => {
    await app?.close();
    await authRuntime?.close();
    if (dataSource?.isInitialized) {
      await cleanup(dataSource);
      await dataSource.destroy();
    }
  });

  it("denies a regular tenant and exposes the review queue only to an operator", async () => {
    if (!app || !dataSource) throw new Error("Test app was not initialized.");
    const regular = await register("regular@example.invalid");
    const operator = await register("operator@example.invalid");

    const beforeGrant = await app.inject({
      method: "GET",
      url: "/api/v1/operator/ai-assist/proposals",
      headers: { cookie: operator.cookie, origin: "http://localhost:3000" },
    });
    expect(beforeGrant.statusCode).toBe(403);

    await new TypeOrmOperatorStore(dataSource).grantByEmail(
      "operator@example.invalid",
    );

    const denied = await app.inject({
      method: "GET",
      url: "/api/v1/operator/ai-assist/proposals",
      headers: { cookie: regular.cookie, origin: "http://localhost:3000" },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ code: "OPERATOR_REQUIRED" });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/operator/ai-assist/proposals",
      headers: { cookie: operator.cookie, origin: "http://localhost:3000" },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      items: [
        {
          id: "018f5f70-7b5d-7a21-9f49-01b7f63ab005",
          reviewStatus: "pending",
          validationStatus: "pending-review",
          payload: { kind: "flyer-extraction" },
        },
      ],
    });
    const users = (await dataSource.query(
      `SELECT "role" FROM "user" WHERE "email" = 'operator@example.invalid'`,
    )) as Array<{ role: string }>;
    expect(users).toEqual([{ role: "operator" }]);
  });

  it("records one operator rejection and publishes both routes in OpenAPI", async () => {
    if (!app || !dataSource) throw new Error("Test app was not initialized.");
    const operator = await register("operator@example.invalid");
    await new TypeOrmOperatorStore(dataSource).grantByEmail(
      "operator@example.invalid",
    );
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/operator/ai-assist/proposals/018f5f70-7b5d-7a21-9f49-01b7f63ab005/review",
      headers: { cookie: operator.cookie, origin: "http://localhost:3000" },
      payload: {
        decision: "rejected",
        reason: "Synthetic fixture intentionally rejected by operator.",
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      proposalId: "018f5f70-7b5d-7a21-9f49-01b7f63ab005",
      reviewStatus: "rejected",
    });
    const repeated = await app.inject({
      method: "POST",
      url: "/api/v1/operator/ai-assist/proposals/018f5f70-7b5d-7a21-9f49-01b7f63ab005/review",
      headers: { cookie: operator.cookie, origin: "http://localhost:3000" },
      payload: {
        decision: "approved",
        reason: "Must not overwrite the first decision.",
      },
    });
    expect(repeated.statusCode).toBe(409);
    expect(repeated.json()).toMatchObject({
      code: "AI_PROPOSAL_ALREADY_REVIEWED",
    });

    await app.ready();
    const document = app.swagger();
    expect(document.paths).toHaveProperty(
      "/api/v1/operator/ai-assist/proposals",
    );
    expect(document.paths).toHaveProperty(
      "/api/v1/operator/ai-assist/proposals/{proposalId}/review",
    );
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
    return { cookie: Array.isArray(cookie) ? cookie[0]! : cookie! };
  }
});

function flyerProposal(sourceSnapshotId: string) {
  const fields = [
    "sourceUrl",
    "storeId",
    "exactName",
    "package.declared",
    "price.amount",
    "validity.validFrom",
    "validity.validTo",
  ];
  return {
    contractVersion: "1",
    id: "018f5f70-7b5d-7a21-9f49-01b7f63ab005",
    taskKey: "synthetic:flyer:review-1",
    sourceSnapshotId,
    promptVersion: "flyer-extraction-v1",
    model: {
      provider: "synthetic-provider",
      name: "synthetic-model",
      version: "2026-08-01",
    },
    confidence: 0.9,
    evidenceSpans: fields.map((field, index) => ({
      field,
      start: index * 10,
      end: index * 10 + 8,
      sourceContentHash: sourceHash,
    })),
    usage: { inputTokens: 500, outputTokens: 140, costMicros: 3_000 },
    payload: {
      kind: "flyer-extraction",
      sourceUrl: "https://retailer.example.invalid/flyer/approved",
      storeId: "018f5f70-7b5d-7a21-9f49-01b7f63ab004",
      exactName: "Synthetic bananas",
      package: {
        declared: "1 kg",
        quantity: { amount: "1", unit: "kilogram" },
        count: 1,
      },
      price: { amount: "24.90", currency: "CZK" },
      membership: { kind: "none" },
      validity: {
        validFrom: "2026-08-01T00:00:00.000Z",
        validTo: "2026-08-07T23:59:59.999Z",
      },
    },
    createdAt: "2026-08-01T12:00:00.000Z",
  };
}

async function cleanup(
  dataSource: NonNullable<ReturnType<typeof createAppDataSource>>,
) {
  for (const record of [
    AiAssistCacheRecord,
    AiAssistReviewRecord,
    AiAssistProposalRecord,
    AiAssistFailureRecord,
  ]) {
    await dataSource
      .getRepository(record)
      .createQueryBuilder()
      .delete()
      .execute();
  }
  await dataSource
    .getRepository(SourceSnapshotRecord)
    .createQueryBuilder()
    .delete()
    .where("source_scope_key = 'synthetic:ai-review'")
    .execute();
  const users = (await dataSource.query(
    `SELECT "tenantId" FROM "user" WHERE "email" IN ('regular@example.invalid', 'operator@example.invalid')`,
  )) as Array<{ tenantId: string }>;
  if (users.length > 0) {
    await dataSource
      .getRepository("TenantRecord")
      .createQueryBuilder()
      .delete()
      .where("id IN (:...ids)", { ids: users.map(({ tenantId }) => tenantId) })
      .execute();
  }
}
