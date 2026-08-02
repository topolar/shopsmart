import { describe, expect, it, vi } from "vitest";

import { connectorManifestSchema } from "@shopsmart/contracts";
import { CONNECTOR_MANIFESTS } from "@shopsmart/connectors";

import {
  assertConnectorAdapterConformance,
  assertConnectorRegistryConformance,
  collectConnectorHealth,
  prepareConnectorRun,
  reprocessRetainedSnapshot,
} from "./connector-runtime.js";
import { createConnectorAdapters } from "./connector-adapters.js";

const manifest = connectorManifestSchema.parse({
  contractVersion: "1",
  connectorId: "synthetic",
  displayName: "Synthetic Czech connector",
  country: "CZ",
  parserVersion: "synthetic-v1",
  contentKind: "html",
  capabilities: {
    conditionalRequests: true,
    retainedSnapshotReprocess: true,
    physicalOffers: true,
    onlineStock: false,
  },
  scopes: [
    {
      key: "synthetic:cz:scope-a",
      entryUrl: "https://example.test/a",
      requiredCoverageKeys: ["synthetic:cz:scope-a"],
      refreshIntervalSeconds: 43_200,
      leaseSeconds: 900,
      maxAttempts: 3,
      minimumRateLimitPauseSeconds: 21_600,
      rawRetentionSeconds: 259_200,
    },
    {
      key: "synthetic:cz:scope-b",
      entryUrl: "https://example.test/b",
      requiredCoverageKeys: ["synthetic:cz:scope-b"],
      refreshIntervalSeconds: 43_200,
      leaseSeconds: 900,
      maxAttempts: 3,
      minimumRateLimitPauseSeconds: 21_600,
      rawRetentionSeconds: 259_200,
    },
  ],
});

describe("shared connector runtime", () => {
  it("registers every shared scope, purges retention once, and claims due work without tenant input", async () => {
    const jobs = {
      register: vi.fn(async () => undefined),
      claimDue: vi.fn(async ({ sourceScopeKey }: { sourceScopeKey: string }) =>
        sourceScopeKey.endsWith("scope-a")
          ? [
              {
                id: "job-a",
                sourceScopeKey,
                leaseOwner: "worker-1",
                previousContentHash: null,
                previousParserVersion: null,
              },
            ]
          : [],
      ),
    };
    const purgeExpired = vi.fn(async () => ["expired.html"]);
    const markRawDeleted = vi.fn(async () => undefined);

    const result = await prepareConnectorRun({
      manifest,
      now: "2026-08-02T12:00:00.000Z",
      workerId: "worker-1",
      jobs,
      retention: { purgeExpired, markRawDeleted },
    });

    expect(result).toEqual({
      claims: [
        expect.objectContaining({ sourceScopeKey: "synthetic:cz:scope-a" }),
      ],
      deletedRawCount: 1,
    });
    expect(jobs.register).toHaveBeenCalledTimes(2);
    expect(jobs.claimDue).toHaveBeenCalledTimes(2);
    expect(jobs.claimDue).toHaveBeenCalledWith({
      workerId: "worker-1",
      now: "2026-08-02T12:00:00.000Z",
      leaseSeconds: 900,
      limit: 1,
      sourceScopeKey: "synthetic:cz:scope-a",
    });
    expect(purgeExpired).toHaveBeenCalledOnce();
    expect(markRawDeleted).toHaveBeenCalledWith(
      ["expired.html"],
      "2026-08-02T12:00:00.000Z",
    );
  });

  it("hash-verifies and persists a retained snapshot without a network fetch", async () => {
    const hash = "a".repeat(64);
    const persist = vi.fn(async () => undefined);
    const parse = vi.fn(async () => ({
      status: "parsed" as const,
      retrieval: {
        sourceScopeKey: "synthetic:cz:scope-a",
        sourceUrl: "https://example.test/a",
        retrievedAt: "2026-08-02T12:00:00.000Z",
        httpStatus: 200,
        contentHash: hash,
        parserVersion: "synthetic-v1",
      },
      offers: [{ id: "offer-1" }],
      quarantines: [{ reasonCode: "UNMAPPED_PRODUCT" }],
    }));

    await expect(
      reprocessRetainedSnapshot({
        manifest,
        scopeKey: "synthetic:cz:scope-a",
        ingestion: {
          latestRetainedRetrieval: vi.fn(async () => ({
            contentHash: hash,
            parserVersion: "synthetic-v1",
            etag: null,
            lastModified: null,
            rawStorageKey: `1-${hash}.html`,
            sourceUrl: "https://example.test/a",
            retrievedAt: "2026-08-02T12:00:00.000Z",
            httpStatus: 200,
          })),
          persist,
        },
        rawSnapshots: { read: vi.fn(async () => "retained") },
        parse,
      }),
    ).resolves.toEqual({
      status: "reprocessed",
      offerCount: 1,
      quarantineCount: 1,
      contentHash: hash,
    });
    expect(parse).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledOnce();
  });

  it("combines job, coverage, retrieval, and raw-retention health per scope", async () => {
    const result = await collectConnectorHealth({
      manifest,
      jobs: {
        health: vi.fn(async (sourceScopeKey: string) => ({
          sourceScopeKey,
          status: "idle",
          dueAt: "2026-08-03T00:00:00.000Z",
          leaseExpiresAt: null,
          rateLimitUntil: null,
          lastSuccessAt: "2026-08-02T12:00:00.000Z",
          lastContentHash: "a".repeat(64),
          parserVersion: "synthetic-v1",
          expectedParserVersion: "synthetic-v1",
          lastErrorCode: null,
          lastCoverageComplete: true,
          quarantineCount: 2,
          attempts: 0,
        })),
        latestRun: vi.fn(async () => ({
          status: "success",
          completedAt: "2026-08-02T12:00:00.000Z",
          contentHash: "a".repeat(64),
          parserVersion: "synthetic-v1",
          coverageManifest: {
            expectedKeys: ["synthetic:cz:scope-a"],
            items: [
              {
                key: "synthetic:cz:scope-a",
                status: "fetched",
                candidateCount: 7,
                offerCount: 3,
                quarantineCount: 4,
                reasonCode: null,
              },
            ],
          },
        })),
      },
      ingestion: {
        latestRetrieval: vi.fn(async () => ({
          sourceUrl: "https://example.test/a",
          retrievedAt: "2026-08-02T12:00:00.000Z",
          httpStatus: 200,
          rawDeleteAt: "2026-08-05T12:00:00.000Z",
        })),
        latestRetainedRetrieval: vi.fn(async () => ({
          sourceUrl: "https://example.test/a",
          retrievedAt: "2026-08-02T12:00:00.000Z",
          httpStatus: 200,
          rawStorageKey: "retained.html",
          rawDeleteAt: "2026-08-05T12:00:00.000Z",
        })),
      },
    });

    expect(result.scopes[0]).toMatchObject({
      connectorId: "synthetic",
      sourceScopeKey: "synthetic:cz:scope-a",
      lastAttemptAt: "2026-08-02T12:00:00.000Z",
      lastContentChangeAt: "2026-08-02T12:00:00.000Z",
      httpStatus: 200,
      candidateCount: 7,
      offerCount: 3,
      quarantineCount: 4,
      rawSnapshotAvailable: true,
      rawDeleteAt: "2026-08-05T12:00:00.000Z",
    });
  });
});

describe("installed connector conformance", () => {
  it("accepts the versioned Kaufland, Albert, and Globus manifests", () => {
    expect(CONNECTOR_MANIFESTS.map(({ connectorId }) => connectorId)).toEqual([
      "albert",
      "globus",
      "kaufland",
    ]);
    expect(() =>
      assertConnectorRegistryConformance(CONNECTOR_MANIFESTS),
    ).not.toThrow();
    expect(CONNECTOR_MANIFESTS.flatMap(({ scopes }) => scopes)).toHaveLength(4);
    const adapters = createConnectorAdapters({
      jobs: {} as never,
      ingestion: {} as never,
      rawSnapshotStore: vi.fn() as never,
    });
    expect(() => assertConnectorAdapterConformance(adapters)).not.toThrow();
  });
});
