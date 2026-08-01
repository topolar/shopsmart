import {
  createGlobusNotModifiedResult,
  fetchGlobusFeaturedPage,
  GLOBUS_BRNO_SCOPE,
  GLOBUS_FEATURED_PARSER_VERSION,
  GlobusAccessError,
  type GlobusFetchResult,
  type GlobusProductMapping,
  type GlobusSnapshotResult,
  processGlobusFeaturedSnapshot,
} from "@shopsmart/connectors";

type Claim = Readonly<{
  id: string;
  sourceScopeKey: string;
  leaseOwner: string;
  previousContentHash: string | null;
  previousParserVersion: string | null;
}>;
type Previous = Readonly<{
  contentHash: string;
  parserVersion: string;
  etag: string | null;
  lastModified: string | null;
  rawStorageKey?: string | null;
  sourceUrl?: string;
  retrievedAt?: string;
  httpStatus?: number;
}>;

type IngestionPort = Readonly<{
  latestRetrieval(sourceScopeKey: string): Promise<Previous | null>;
  latestRetainedRetrieval(sourceScopeKey: string): Promise<Previous | null>;
  loadApprovedGlobusMappings(): Promise<readonly GlobusProductMapping[]>;
  persistGlobus(
    result: GlobusSnapshotResult,
    options: { rawStorageKey: string | null },
  ): Promise<unknown>;
  markRawDeleted(
    storageKeys: readonly string[],
    deletedAt: string,
  ): Promise<void>;
}>;
type RawPort = Readonly<{
  write(input: {
    html: string;
    contentHash: string;
    retrievedAt: string;
    rawDeleteAt: string;
  }): Promise<{ storageKey: string }>;
  read(storageKey: string): Promise<string>;
  purgeExpired(now: string): Promise<string[]>;
}>;
type JobPort = Readonly<{
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
  }): Promise<Claim[]>;
  complete(input: {
    jobId: string;
    workerId: string;
    completedAt: string;
    nextDueAt: string;
    parserVersion: string;
    contentHash: string;
    coverageItems: Array<{
      key: string;
      status: "fetched" | "unchanged" | "quarantined";
      candidateCount: number;
      reasonCode: string | null;
    }>;
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

export async function runGlobusOperationOnce(input: {
  now: string;
  workerId: string;
  jobs: JobPort;
  ingestion: IngestionPort;
  rawSnapshots: RawPort;
  fetchPage?: typeof fetchGlobusFeaturedPage;
}) {
  const now = parseCanonicalTimestamp(input.now);
  const deleted = await input.rawSnapshots.purgeExpired(input.now);
  await input.ingestion.markRawDeleted(deleted, input.now);
  await input.jobs.register({
    sourceScopeKey: GLOBUS_BRNO_SCOPE.key,
    requiredCoverageKeys: [GLOBUS_BRNO_SCOPE.key],
    dueAt: input.now,
    expectedParserVersion: GLOBUS_FEATURED_PARSER_VERSION,
    maxAttempts: 3,
  });
  const [claim] = await input.jobs.claimDue({
    workerId: input.workerId,
    now: input.now,
    leaseSeconds: 15 * 60,
    limit: 1,
    sourceScopeKey: GLOBUS_BRNO_SCOPE.key,
  });
  if (!claim)
    return { status: "not-due" as const, deletedRawCount: deleted.length };
  if (
    claim.leaseOwner !== input.workerId ||
    claim.sourceScopeKey !== GLOBUS_BRNO_SCOPE.key
  ) {
    throw new Error("The worker does not own the Globus connector lease.");
  }

  let result: GlobusSnapshotResult;
  try {
    const previous = await input.ingestion.latestRetrieval(
      GLOBUS_BRNO_SCOPE.key,
    );
    const parserIsCurrent =
      claim.previousParserVersion === GLOBUS_FEATURED_PARSER_VERSION &&
      previous?.parserVersion === GLOBUS_FEATURED_PARSER_VERSION;
    const fetched = await (input.fetchPage ?? fetchGlobusFeaturedPage)({
      retrievedAt: input.now,
      etag: parserIsCurrent ? previous?.etag : null,
      lastModified: parserIsCurrent ? previous?.lastModified : null,
    });
    result = await processFetched({
      fetched,
      claim,
      previous,
      now: input.now,
      mappings: await input.ingestion.loadApprovedGlobusMappings(),
    });
    let rawStorageKey: string | null = null;
    if (fetched.html !== null && result.status !== "unchanged") {
      rawStorageKey = (
        await input.rawSnapshots.write({
          html: fetched.html,
          contentHash: result.retrieval.contentHash,
          retrievedAt: result.retrieval.retrievedAt,
          rawDeleteAt: result.retrieval.rawDeleteAt,
        })
      ).storageKey;
    }
    await input.ingestion.persistGlobus(result, { rawStorageKey });
  } catch (error) {
    if (error instanceof GlobusAccessError && error.code === "RATE_LIMITED") {
      const minimum = now.getTime() + 6 * 60 * 60 * 1_000;
      await input.jobs.recordRateLimit(
        claim.id,
        new Date(
          Math.max(minimum, error.retryAt ? Date.parse(error.retryAt) : 0),
        ).toISOString(),
      );
    } else {
      const errorCode =
        error instanceof GlobusAccessError
          ? error.code
          : "GLOBUS_INGESTION_FAILED";
      const retryable =
        !(error instanceof GlobusAccessError) ||
        error.code === "HTTP_ERROR" ||
        error.code === "TOO_MANY_REDIRECTS";
      await input.jobs.fail(
        claim.id,
        input.workerId,
        errorCode,
        retryable,
        input.now,
      );
    }
    throw error;
  }

  await input.jobs.complete({
    jobId: claim.id,
    workerId: input.workerId,
    completedAt: input.now,
    nextDueAt: new Date(now.getTime() + 12 * 60 * 60 * 1_000).toISOString(),
    parserVersion: result.retrieval.parserVersion,
    contentHash: result.retrieval.contentHash,
    coverageItems: [
      {
        key: GLOBUS_BRNO_SCOPE.key,
        status: result.status === "parsed" ? "fetched" : result.status,
        candidateCount: result.offers.length + result.quarantines.length,
        reasonCode:
          result.status === "quarantined"
            ? (result.quarantines[0]?.reasonCode ?? "PARSE_QUARANTINED")
            : null,
      },
    ],
  });
  return {
    status: result.status,
    offerCount: result.offers.length,
    quarantineCount: result.quarantines.length,
    deletedRawCount: deleted.length,
  };
}

export async function reprocessStoredGlobusSnapshot(input: {
  ingestion: Pick<
    IngestionPort,
    "latestRetainedRetrieval" | "loadApprovedGlobusMappings" | "persistGlobus"
  >;
  rawSnapshots: Pick<RawPort, "read">;
}) {
  const previous = await input.ingestion.latestRetainedRetrieval(
    GLOBUS_BRNO_SCOPE.key,
  );
  if (
    !previous?.rawStorageKey ||
    !previous.sourceUrl ||
    !previous.retrievedAt ||
    previous.httpStatus === undefined
  )
    throw new Error("GLOBUS_RAW_SNAPSHOT_UNAVAILABLE");
  if (previous.sourceUrl !== GLOBUS_BRNO_SCOPE.sourceUrl) {
    throw new Error("GLOBUS_RETAINED_SNAPSHOT_SCOPE_MISMATCH");
  }
  const html = await input.rawSnapshots.read(previous.rawStorageKey);
  const result = processGlobusFeaturedSnapshot({
    html,
    httpStatus: previous.httpStatus,
    retrievedAt: previous.retrievedAt,
    etag: previous.etag,
    lastModified: previous.lastModified,
    productMappings: await input.ingestion.loadApprovedGlobusMappings(),
  });
  if (result.retrieval.contentHash !== previous.contentHash) {
    throw new Error("GLOBUS_RETAINED_SNAPSHOT_HASH_MISMATCH");
  }
  await input.ingestion.persistGlobus(result, {
    rawStorageKey: previous.rawStorageKey,
  });
  return {
    status: "reprocessed" as const,
    offerCount: result.offers.length,
    quarantineCount: result.quarantines.length,
  };
}

async function processFetched(input: {
  fetched: GlobusFetchResult;
  claim: Claim;
  previous: Previous | null;
  now: string;
  mappings: readonly GlobusProductMapping[];
}) {
  if (input.fetched.notModified) {
    if (input.fetched.html !== null || !input.previous) {
      throw new Error("GLOBUS_304_WITHOUT_PREVIOUS");
    }
    return createGlobusNotModifiedResult({
      retrievedAt: input.now,
      contentHash: input.previous.contentHash,
      parserVersion: input.previous.parserVersion,
      etag: input.fetched.etag,
      lastModified: input.fetched.lastModified,
    });
  }
  if (input.fetched.html === null) throw new Error("GLOBUS_HTML_BODY_MISSING");
  return processGlobusFeaturedSnapshot({
    html: input.fetched.html,
    httpStatus: input.fetched.httpStatus,
    retrievedAt: input.now,
    etag: input.fetched.etag,
    lastModified: input.fetched.lastModified,
    previousContentHash: input.claim.previousContentHash,
    previousParserVersion: input.claim.previousParserVersion,
    productMappings: input.mappings,
  });
}

function parseCanonicalTimestamp(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error("now must be a canonical ISO timestamp.");
  }
  return parsed;
}
