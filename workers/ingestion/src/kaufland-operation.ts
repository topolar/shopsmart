import {
  KAUFLAND_PRAHA_VYPICH_SCOPE,
  KAUFLAND_STORE_PARSER_VERSION,
  type KauflandFetchResult,
  type KauflandProductMapping,
  type KauflandSnapshotResult,
  processKauflandStoreSnapshot,
} from "@shopsmart/connectors";

import {
  purgeExpiredKauflandSnapshots,
  runClaimedKauflandJob,
} from "./kaufland-worker.js";

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
  const deletedRawCount = await purgeExpiredKauflandSnapshots({
    now: input.now,
    rawSnapshots: input.rawSnapshots,
    ingestion: input.ingestion,
  });
  await input.jobs.register({
    sourceScopeKey: KAUFLAND_PRAHA_VYPICH_SCOPE.key,
    requiredCoverageKeys: [KAUFLAND_PRAHA_VYPICH_SCOPE.key],
    dueAt: input.now,
    expectedParserVersion: KAUFLAND_STORE_PARSER_VERSION,
    maxAttempts: 3,
  });
  const [claim] = await input.jobs.claimDue({
    workerId: input.workerId,
    now: input.now,
    leaseSeconds: 15 * 60,
    limit: 1,
    sourceScopeKey: KAUFLAND_PRAHA_VYPICH_SCOPE.key,
  });
  if (!claim) return { status: "not-due" as const, deletedRawCount };

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
    deletedRawCount,
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
  const previous = await input.ingestion.latestRetainedRetrieval(
    KAUFLAND_PRAHA_VYPICH_SCOPE.key,
  );
  if (!previous?.rawStorageKey) {
    throw new Error("KAUFLAND_RAW_SNAPSHOT_UNAVAILABLE");
  }
  if (previous.sourceUrl !== KAUFLAND_PRAHA_VYPICH_SCOPE.sourceUrl) {
    throw new Error("KAUFLAND_RETAINED_SNAPSHOT_SCOPE_MISMATCH");
  }
  const html = await input.rawSnapshots.read(previous.rawStorageKey);
  const result = processKauflandStoreSnapshot({
    html,
    httpStatus: previous.httpStatus,
    retrievedAt: previous.retrievedAt,
    etag: previous.etag,
    lastModified: previous.lastModified,
    productMappings: await input.ingestion.loadApprovedKauflandMappings(),
  });
  if (result.retrieval.contentHash !== previous.contentHash) {
    throw new Error("KAUFLAND_RETAINED_SNAPSHOT_HASH_MISMATCH");
  }
  await input.ingestion.persist(result, {
    rawStorageKey: previous.rawStorageKey,
  });
  return {
    status: "reprocessed" as const,
    offerCount: result.offers.length,
    quarantineCount: result.quarantines.length,
    contentHash: result.retrieval.contentHash,
  };
}
