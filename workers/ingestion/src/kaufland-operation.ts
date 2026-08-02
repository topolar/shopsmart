import {
  KAUFLAND_PRAHA_VYPICH_SCOPE,
  KAUFLAND_CONNECTOR_MANIFEST,
  type KauflandFetchResult,
  type KauflandProductMapping,
  type KauflandSnapshotResult,
  processKauflandStoreSnapshot,
} from "@shopsmart/connectors";

import {
  prepareConnectorRun,
  reprocessRetainedSnapshot,
} from "./connector-runtime.js";
import { runClaimedKauflandJob } from "./kaufland-worker.js";

type ClaimedKauflandJob = Readonly<{
  id: string;
  sourceScopeKey: string;
  leaseOwner: string;
  previousContentHash: string | null;
  previousParserVersion: string | null;
}>;

type StoredKauflandRetrieval = Readonly<{
  contentHash: string;
  parserVersion: string;
  etag: string | null;
  lastModified: string | null;
  rawStorageKey: string | null;
  sourceUrl: string;
  retrievedAt: string;
  httpStatus: number;
}>;

type OperationInput = Readonly<{
  now: string;
  workerId: string;
  jobs: {
    register(input: {
      sourceScopeKey: string;
      requiredCoverageKeys: string[];
      dueAt: string;
      expectedParserVersion: string;
      maxAttempts: number;
    }): Promise<unknown>;
    claimDue(input: {
      workerId: string;
      now: string;
      leaseSeconds: number;
      limit: number;
      sourceScopeKey: string;
    }): Promise<ClaimedKauflandJob[]>;
    complete: Parameters<typeof runClaimedKauflandJob>[0]["jobs"]["complete"];
    fail: Parameters<typeof runClaimedKauflandJob>[0]["jobs"]["fail"];
    recordRateLimit: Parameters<
      typeof runClaimedKauflandJob
    >[0]["jobs"]["recordRateLimit"];
  };
  ingestion: Parameters<typeof runClaimedKauflandJob>[0]["ingestion"] & {
    loadApprovedKauflandMappings(): Promise<readonly KauflandProductMapping[]>;
    markRawDeleted(
      storageKeys: readonly string[],
      deletedAt: string,
    ): Promise<void>;
  };
  rawSnapshots: Parameters<typeof runClaimedKauflandJob>[0]["rawSnapshots"] & {
    purgeExpired(now: string): Promise<string[]>;
  };
  fetchPage?: (input: {
    retrievedAt: string;
    etag?: string | null;
    lastModified?: string | null;
  }) => Promise<KauflandFetchResult>;
}>;

export async function runKauflandOperationOnce(input: OperationInput) {
  const prepared = await prepareConnectorRun({
    manifest: KAUFLAND_CONNECTOR_MANIFEST,
    now: input.now,
    workerId: input.workerId,
    jobs: input.jobs,
    retention: {
      purgeExpired: (now) => input.rawSnapshots.purgeExpired(now),
      markRawDeleted: (storageKeys, deletedAt) =>
        input.ingestion.markRawDeleted(storageKeys, deletedAt),
    },
  });
  const [claim] = prepared.claims;
  if (!claim)
    return {
      status: "not-due" as const,
      deletedRawCount: prepared.deletedRawCount,
    };

  const productMappings = await input.ingestion.loadApprovedKauflandMappings();
  const result = await runClaimedKauflandJob({
    claim,
    workerId: input.workerId,
    retrievedAt: input.now,
    productMappings,
    rawSnapshots: input.rawSnapshots,
    ingestion: input.ingestion,
    jobs: input.jobs,
    ...(input.fetchPage ? { fetchPage: input.fetchPage } : {}),
  });
  return {
    status: result.status,
    offerCount: result.offers.length,
    quarantineCount: result.quarantines.length,
    deletedRawCount: prepared.deletedRawCount,
  };
}

export async function reprocessStoredKauflandSnapshot(input: {
  ingestion: Readonly<{
    latestRetainedRetrieval(
      sourceScopeKey: string,
    ): Promise<StoredKauflandRetrieval | null>;
    loadApprovedKauflandMappings(): Promise<readonly KauflandProductMapping[]>;
    persist(
      result: KauflandSnapshotResult,
      options: { rawStorageKey: string | null },
    ): Promise<unknown>;
  }>;
  rawSnapshots: Readonly<{
    read(storageKey: string): Promise<string>;
  }>;
}) {
  const productMappings = await input.ingestion.loadApprovedKauflandMappings();
  return reprocessRetainedSnapshot<string, KauflandSnapshotResult>({
    manifest: KAUFLAND_CONNECTOR_MANIFEST,
    scopeKey: KAUFLAND_PRAHA_VYPICH_SCOPE.key,
    ingestion: input.ingestion,
    rawSnapshots: input.rawSnapshots,
    parse: ({ content: html, previous }) =>
      processKauflandStoreSnapshot({
        html,
        httpStatus: previous.httpStatus,
        retrievedAt: previous.retrievedAt,
        etag: previous.etag,
        lastModified: previous.lastModified,
        productMappings,
      }),
  });
}
