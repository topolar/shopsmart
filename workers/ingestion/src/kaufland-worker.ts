import {
  createKauflandNotModifiedResult,
  fetchKauflandStorePage,
  KauflandAccessError,
  KAUFLAND_CONNECTOR_MANIFEST,
  KAUFLAND_PRAHA_VYPICH_SCOPE,
  KAUFLAND_STORE_PARSER_VERSION,
  processKauflandStoreSnapshot,
  type KauflandFetchResult,
  type KauflandProductMapping,
  type KauflandSnapshotResult,
} from "@shopsmart/connectors";
import type { CoverageItemInput } from "@shopsmart/contracts";

import {
  connectorRateLimitUntil,
  nextConnectorDueAt,
} from "./connector-runtime.js";

type ClaimedJob = Readonly<{
  id: string;
  sourceScopeKey: string;
  leaseOwner: string;
  previousContentHash: string | null;
  previousParserVersion: string | null;
}>;

type PreviousRetrieval = Readonly<{
  contentHash: string;
  parserVersion: string;
  etag: string | null;
  lastModified: string | null;
}>;

type RawSnapshotPort = Readonly<{
  write(input: {
    html: string;
    contentHash: string;
    retrievedAt: string;
    rawDeleteAt: string;
  }): Promise<Readonly<{ storageKey: string }>>;
}>;

type IngestionPort = Readonly<{
  latestRetrieval(sourceScopeKey: string): Promise<PreviousRetrieval | null>;
  persist(
    result: KauflandSnapshotResult,
    options: Readonly<{ rawStorageKey: string | null }>,
  ): Promise<Readonly<{ snapshotId: string }>>;
}>;

type JobPort = Readonly<{
  complete(input: {
    jobId: string;
    workerId: string;
    completedAt: string;
    nextDueAt: string;
    parserVersion: string;
    contentHash: string;
    coverageItems: CoverageItemInput[];
  }): Promise<void>;
  fail(
    jobId: string,
    workerId: string,
    errorCode: string,
    retryable: boolean,
    failedAt: string,
  ): Promise<void>;
  recordRateLimit(jobId: string, until: string): Promise<void>;
}>;

type RunClaimedKauflandJobInput = Readonly<{
  claim: ClaimedJob;
  workerId: string;
  retrievedAt: string;
  productMappings: readonly KauflandProductMapping[];
  rawSnapshots: RawSnapshotPort;
  ingestion: IngestionPort;
  jobs: JobPort;
  fetchPage?: typeof fetchKauflandStorePage;
}>;

export async function runClaimedKauflandJob(
  input: RunClaimedKauflandJobInput,
): Promise<KauflandSnapshotResult> {
  if (input.claim.sourceScopeKey !== KAUFLAND_PRAHA_VYPICH_SCOPE.key) {
    throw new Error("The claimed job does not belong to the Kaufland scope.");
  }
  if (input.claim.leaseOwner !== input.workerId || !input.workerId.trim()) {
    throw new Error("The worker does not own this connector lease.");
  }
  const retrievedAt = parseCanonicalTimestamp(input.retrievedAt);
  let result: KauflandSnapshotResult;
  try {
    result = await ingestSnapshot(input, retrievedAt);
  } catch (error) {
    await recordFailure(input, retrievedAt, error);
    throw error;
  }

  await input.jobs.complete({
    jobId: input.claim.id,
    workerId: input.workerId,
    completedAt: retrievedAt.toISOString(),
    nextDueAt: nextConnectorDueAt(
      KAUFLAND_CONNECTOR_MANIFEST,
      KAUFLAND_PRAHA_VYPICH_SCOPE.key,
      retrievedAt.toISOString(),
    ),
    parserVersion: result.retrieval.parserVersion,
    contentHash: result.retrieval.contentHash,
    coverageItems: [coverageItem(result)],
  });
  return result;
}

async function ingestSnapshot(
  input: RunClaimedKauflandJobInput,
  retrievedAt: Date,
): Promise<KauflandSnapshotResult> {
  const previous = await input.ingestion.latestRetrieval(
    input.claim.sourceScopeKey,
  );
  const parserIsCurrent =
    input.claim.previousParserVersion === KAUFLAND_STORE_PARSER_VERSION &&
    previous?.parserVersion === KAUFLAND_STORE_PARSER_VERSION;
  const fetchResult = await (input.fetchPage ?? fetchKauflandStorePage)({
    retrievedAt: retrievedAt.toISOString(),
    etag: parserIsCurrent ? previous.etag : null,
    lastModified: parserIsCurrent ? previous.lastModified : null,
  });
  const result = createResult({
    fetchResult,
    retrievedAt: retrievedAt.toISOString(),
    claim: input.claim,
    previous,
    productMappings: input.productMappings,
  });

  let rawStorageKey: string | null = null;
  if (fetchResult.html !== null) {
    const stored = await input.rawSnapshots.write({
      html: fetchResult.html,
      contentHash: result.retrieval.contentHash,
      retrievedAt: result.retrieval.retrievedAt,
      rawDeleteAt: result.retrieval.rawDeleteAt,
    });
    rawStorageKey = stored.storageKey;
  }
  await input.ingestion.persist(result, { rawStorageKey });
  return result;
}

async function recordFailure(
  input: RunClaimedKauflandJobInput,
  failedAt: Date,
  error: unknown,
): Promise<void> {
  if (error instanceof KauflandAccessError && error.code === "RATE_LIMITED") {
    await input.jobs.recordRateLimit(
      input.claim.id,
      connectorRateLimitUntil(
        KAUFLAND_CONNECTOR_MANIFEST,
        KAUFLAND_PRAHA_VYPICH_SCOPE.key,
        failedAt.toISOString(),
        error.retryAt,
      ),
    );
    return;
  }
  const errorCode =
    error instanceof KauflandAccessError ? error.code : "INGESTION_FAILED";
  const retryable =
    !(error instanceof KauflandAccessError) ||
    error.code === "HTTP_ERROR" ||
    error.code === "TOO_MANY_REDIRECTS";
  await input.jobs.fail(
    input.claim.id,
    input.workerId,
    errorCode,
    retryable,
    failedAt.toISOString(),
  );
}

export async function purgeExpiredKauflandSnapshots(input: {
  now: string;
  rawSnapshots: Readonly<{
    purgeExpired(now: string): Promise<string[]>;
  }>;
  ingestion: Readonly<{
    markRawDeleted(
      storageKeys: readonly string[],
      deletedAt: string,
    ): Promise<void>;
  }>;
}): Promise<number> {
  const now = parseCanonicalTimestamp(input.now).toISOString();
  const storageKeys = await input.rawSnapshots.purgeExpired(now);
  await input.ingestion.markRawDeleted(storageKeys, now);
  return storageKeys.length;
}

function createResult(input: {
  fetchResult: KauflandFetchResult;
  retrievedAt: string;
  claim: ClaimedJob;
  previous: PreviousRetrieval | null;
  productMappings: readonly KauflandProductMapping[];
}): KauflandSnapshotResult {
  if (input.fetchResult.notModified) {
    if (input.fetchResult.html !== null || !input.previous) {
      throw new Error(
        "An HTTP 304 response requires previous retrieval state.",
      );
    }
    return createKauflandNotModifiedResult({
      retrievedAt: input.retrievedAt,
      contentHash: input.previous.contentHash,
      parserVersion: input.previous.parserVersion,
      etag: input.fetchResult.etag,
      lastModified: input.fetchResult.lastModified,
    });
  }
  if (input.fetchResult.html === null) {
    throw new Error("A modified response must contain HTML.");
  }
  return processKauflandStoreSnapshot({
    html: input.fetchResult.html,
    httpStatus: input.fetchResult.httpStatus,
    retrievedAt: input.retrievedAt,
    etag: input.fetchResult.etag,
    lastModified: input.fetchResult.lastModified,
    previousContentHash: input.claim.previousContentHash,
    previousParserVersion: input.claim.previousParserVersion,
    productMappings: input.productMappings,
  });
}

function coverageItem(result: KauflandSnapshotResult): CoverageItemInput {
  return {
    key: result.retrieval.sourceScopeKey,
    status:
      result.status === "parsed"
        ? "fetched"
        : result.status === "unchanged"
          ? "unchanged"
          : "quarantined",
    candidateCount: result.offers.length + result.quarantines.length,
    offerCount: result.offers.length,
    quarantineCount: result.quarantines.length,
    reasonCode:
      result.status === "quarantined"
        ? (result.quarantines[0]?.reasonCode ?? "INVALID_SOURCE_PAGE")
        : null,
  };
}

function parseCanonicalTimestamp(value: string): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error("retrievedAt must be a canonical ISO timestamp.");
  }
  return parsed;
}
