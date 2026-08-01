import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createAppDataSource } from "./data-source.js";
import {
  ConnectorJobRecord,
  TypeOrmConnectorJobStore,
} from "./connector-job-store.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const scopeKey = "synthetic:prague:shared-offers";

describeWithDatabase("shared connector job operations", () => {
  let dataSource: ReturnType<typeof createAppDataSource> | undefined;
  let store: TypeOrmConnectorJobStore | undefined;

  beforeAll(async () => {
    dataSource = createAppDataSource(databaseUrl);
    await dataSource.initialize();
    await dataSource.runMigrations();
    store = new TypeOrmConnectorJobStore(dataSource);
  });

  beforeEach(async () => {
    if (!dataSource) return;
    await dataSource
      .getRepository(ConnectorJobRecord)
      .createQueryBuilder()
      .delete()
      .where("source_scope_key LIKE :prefix", { prefix: "synthetic:%" })
      .execute();
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    await dataSource
      .getRepository(ConnectorJobRecord)
      .createQueryBuilder()
      .delete()
      .where("source_scope_key LIKE :prefix", { prefix: "synthetic:%" })
      .execute();
    await dataSource.destroy();
  });

  it("keeps one shared source job for 100 tenant scheduling requests and leases it once", async () => {
    if (!store || !dataSource) throw new Error("Store was not initialized.");
    const syntheticTenantRequests = Array.from(
      { length: 100 },
      (_, index) => `synthetic-tenant-${index}`,
    );
    await Promise.all(
      syntheticTenantRequests.map(() =>
        store!.register({
          sourceScopeKey: scopeKey,
          requiredCoverageKeys: ["official-feed", "store-registry"],
          dueAt: "2026-08-01T12:00:00.000Z",
          expectedParserVersion: "synthetic-v1",
          maxAttempts: 3,
        }),
      ),
    );
    expect(await dataSource.getRepository(ConnectorJobRecord).count()).toBe(1);

    const claims = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        store!.claimDue({
          workerId: `worker-${index}`,
          now: "2026-08-01T12:00:00.000Z",
          leaseSeconds: 60,
          limit: 1,
        }),
      ),
    );
    const claimed = claims.flat();
    expect(claimed).toHaveLength(1);

    const [reclaimed] = await store.claimDue({
      workerId: "worker-recovery",
      now: "2026-08-01T12:01:01.000Z",
      leaseSeconds: 60,
      limit: 1,
    });
    expect(reclaimed).toMatchObject({ id: claimed[0]!.id, attempts: 2 });

    await store.complete({
      jobId: reclaimed!.id,
      workerId: reclaimed!.leaseOwner,
      completedAt: "2026-08-01T12:01:10.000Z",
      nextDueAt: "2026-08-01T13:00:00.000Z",
      parserVersion: "synthetic-v1",
      contentHash: "a".repeat(64),
      coverageItems: [
        { key: "official-feed", status: "unchanged", candidateCount: 0 },
        { key: "store-registry", status: "fetched", candidateCount: 4 },
      ],
    });
    await expect(store.health(scopeKey)).resolves.toMatchObject({
      status: "idle",
      lastSuccessAt: "2026-08-01T12:01:10.000Z",
      lastContentHash: "a".repeat(64),
      lastCoverageComplete: true,
    });
    await expect(store.latestRun(scopeKey)).resolves.toMatchObject({
      status: "success",
      coverageManifest: {
        summary: {
          complete: true,
          successful: true,
          missingKeys: [],
          unexpectedKeys: [],
        },
      },
    });
  });

  it("models rate limits, deterministic retry, parser drift, and dead letter", async () => {
    if (!store) throw new Error("Store was not initialized.");
    const job = await store.register({
      sourceScopeKey: scopeKey,
      requiredCoverageKeys: ["official-feed"],
      dueAt: "2026-08-01T12:00:00.000Z",
      expectedParserVersion: "synthetic-v2",
      maxAttempts: 2,
    });
    await store.recordRateLimit(job.id, "2026-08-01T12:05:00.000Z");
    await expect(
      store.claimDue({
        workerId: "worker-a",
        now: "2026-08-01T12:04:59.000Z",
        leaseSeconds: 60,
        limit: 1,
      }),
    ).resolves.toEqual([]);
    await store.requestEarlyRefresh(
      job.id,
      "explicit-request",
      "2026-08-01T12:05:00.000Z",
    );
    const [first] = await store.claimDue({
      workerId: "worker-a",
      now: "2026-08-01T12:05:00.000Z",
      leaseSeconds: 60,
      limit: 1,
    });
    await store.fail(
      first!.id,
      first!.leaseOwner,
      "TEMPORARY_HTTP_FAILURE",
      true,
      "2026-08-01T12:05:10.000Z",
    );
    await expect(store.health(scopeKey)).resolves.toMatchObject({
      status: "retry",
      dueAt: "2026-08-01T12:06:10.000Z",
    });

    const [second] = await store.claimDue({
      workerId: "worker-b",
      now: "2026-08-01T12:06:10.000Z",
      leaseSeconds: 60,
      limit: 1,
    });
    await store.fail(
      second!.id,
      second!.leaseOwner,
      "TEMPORARY_HTTP_FAILURE",
      true,
      "2026-08-01T12:06:20.000Z",
    );
    await expect(store.health(scopeKey)).resolves.toMatchObject({
      status: "dead-letter",
      lastErrorCode: "TEMPORARY_HTTP_FAILURE",
    });

    await store.requestEarlyRefresh(
      job.id,
      "explicit-request",
      "2026-08-01T12:07:00.000Z",
    );
    const [drifted] = await store.claimDue({
      workerId: "worker-c",
      now: "2026-08-01T12:07:00.000Z",
      leaseSeconds: 60,
      limit: 1,
    });
    await store.complete({
      jobId: drifted!.id,
      workerId: drifted!.leaseOwner,
      completedAt: "2026-08-01T12:07:10.000Z",
      nextDueAt: "2026-08-01T13:00:00.000Z",
      parserVersion: "synthetic-v1",
      contentHash: "c".repeat(64),
      coverageItems: [
        { key: "official-feed", status: "fetched", candidateCount: 2 },
      ],
    });
    await expect(store.health(scopeKey)).resolves.toMatchObject({
      status: "quarantined",
      lastErrorCode: "PARSER_DRIFT",
      quarantineCount: 1,
    });
  });

  it("reuses fresh static context and fails closed on incomplete coverage", async () => {
    if (!store) throw new Error("Store was not initialized.");
    const job = await store.register({
      sourceScopeKey: scopeKey,
      requiredCoverageKeys: ["official-feed", "store-registry"],
      dueAt: "2026-08-01T12:00:00.000Z",
      expectedParserVersion: "synthetic-v1",
      maxAttempts: 3,
    });
    await store.saveStaticContext({
      sourceScopeKey: scopeKey,
      contextKey: "store-registry",
      payload: { count: 4 },
      sourceUrl: "https://retailer.example.invalid/stores",
      verifiedAt: "2026-08-01T12:00:00.000Z",
      expiresAt: "2026-08-02T12:00:00.000Z",
    });
    await expect(
      store.readStaticContext(
        scopeKey,
        "store-registry",
        "2026-08-01T13:00:00.000Z",
      ),
    ).resolves.toMatchObject({ payload: { count: 4 } });
    await expect(
      store.readStaticContext(
        scopeKey,
        "store-registry",
        "2026-08-01T13:00:00.000Z",
        "contradiction",
      ),
    ).resolves.toBeNull();

    const [claim] = await store.claimDue({
      workerId: "worker-a",
      now: "2026-08-01T12:00:00.000Z",
      leaseSeconds: 60,
      limit: 1,
    });
    await expect(
      store.complete({
        jobId: job.id,
        workerId: claim!.leaseOwner,
        completedAt: "2026-08-01T12:00:10.000Z",
        nextDueAt: "2026-08-01T13:00:00.000Z",
        parserVersion: "synthetic-v1",
        contentHash: "b".repeat(64),
        coverageItems: [
          { key: "official-feed", status: "fetched", candidateCount: 2 },
        ],
      }),
    ).rejects.toMatchObject({ code: "INCOMPLETE_COVERAGE" });
  });

  it("caches coarse service-area support separately from product stock", async () => {
    if (!store) throw new Error("Store was not initialized.");
    const serviceAreaId = "018f5f70-7b5d-7a21-9f49-01b7f63a9307";
    await store.saveServiceAreaContext(scopeKey, {
      serviceAreaId,
      locality: {
        city: "Synthetic City",
        region: "CZ-10",
        postalCodePrefix: "110",
      },
      supported: true,
      sourceUrl: "https://retailer.example.invalid/service-area",
      verifiedAt: "2026-07-25T12:00:00.000Z",
      expiresAt: "2026-08-08T12:00:00.000Z",
    });

    await expect(
      store.readServiceAreaContext(
        scopeKey,
        serviceAreaId,
        {
          city: "Synthetic City",
          region: "CZ-10",
          postalCodePrefix: "110",
        },
        "2026-08-01T12:00:00.000Z",
      ),
    ).resolves.toMatchObject({ serviceAreaId, supported: true });
    await expect(
      store.readServiceAreaContext(
        scopeKey,
        serviceAreaId,
        {
          city: "Other Synthetic City",
          region: "CZ-10",
          postalCodePrefix: "110",
        },
        "2026-08-01T12:00:00.000Z",
      ),
    ).resolves.toBeNull();
  });
});
