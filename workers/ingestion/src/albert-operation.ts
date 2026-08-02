import {
  ALBERT_CONNECTOR_MANIFEST,
  ALBERT_HYPERMARKET_SCOPE,
  ALBERT_LEAFLET_INDEX_URL,
  type AlbertLeafletKind,
  type AlbertLeafletManifest,
  type AlbertProductMapping,
  type AlbertSnapshotResult,
  ALBERT_SUPERMARKET_SCOPE,
  createAlbertNotModifiedResult,
  discoverAlbertLeaflets,
  fetchAlbertResource,
  processAlbertLeafletSnapshot,
} from "@shopsmart/connectors";

import {
  nextConnectorDueAt,
  prepareConnectorRun,
  reprocessRetainedSnapshot,
} from "./connector-runtime.js";

type ClaimedAlbertJob = Readonly<{
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

type StoredAlbertRetrieval = PreviousRetrieval &
  Readonly<{
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
    }): Promise<ClaimedAlbertJob[]>;
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
        offerCount: number;
        quarantineCount: number;
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
  };
  ingestion: {
    latestRetrieval(sourceScopeKey: string): Promise<PreviousRetrieval | null>;
    loadApprovedAlbertMappings(
      kind: AlbertLeafletKind,
    ): Promise<readonly AlbertProductMapping[]>;
    persistAlbert(
      result: AlbertSnapshotResult,
      options: {
        manifest: AlbertLeafletManifest;
        rawStorageKey: string | null;
      },
    ): Promise<unknown>;
    markRawDeleted(
      storageKeys: readonly string[],
      deletedAt: string,
    ): Promise<void>;
  };
  rawSnapshots: {
    purgeExpired(now: string): Promise<string[]>;
    writeBinary(input: {
      bytes: Uint8Array;
      extension: "pdf";
      contentHash: string;
      retrievedAt: string;
      rawDeleteAt: string;
    }): Promise<{ storageKey: string; absolutePath: string }>;
  };
  fetchResource?: typeof fetchAlbertResource;
  processSnapshot?: typeof processAlbertLeafletSnapshot;
}>;

export async function reprocessStoredAlbertSnapshot(input: {
  kind: AlbertLeafletKind;
  ingestion: {
    latestRetainedRetrieval(
      sourceScopeKey: string,
    ): Promise<StoredAlbertRetrieval | null>;
    loadApprovedAlbertMappings(
      kind: AlbertLeafletKind,
    ): Promise<readonly AlbertProductMapping[]>;
    persistAlbert(
      result: AlbertSnapshotResult,
      options: {
        manifest: AlbertLeafletManifest;
        rawStorageKey: string | null;
      },
    ): Promise<unknown>;
  };
  rawSnapshots: {
    readBinary(storageKey: string, extension: "pdf"): Promise<Uint8Array>;
  };
  fetchResource?: typeof fetchAlbertResource;
  processSnapshot?: typeof processAlbertLeafletSnapshot;
}) {
  const scope =
    input.kind === "supermarket"
      ? ALBERT_SUPERMARKET_SCOPE
      : ALBERT_HYPERMARKET_SCOPE;
  let currentLeaflet: AlbertLeafletManifest | null = null;
  const productMappings = await input.ingestion.loadApprovedAlbertMappings(
    input.kind,
  );
  return reprocessRetainedSnapshot<Uint8Array, AlbertSnapshotResult>({
    manifest: ALBERT_CONNECTOR_MANIFEST,
    scopeKey: scope.key,
    ingestion: {
      latestRetainedRetrieval: (sourceScopeKey) =>
        input.ingestion.latestRetainedRetrieval(sourceScopeKey),
      persist: (result, options) => {
        if (!currentLeaflet) throw new Error("ALBERT_INDEX_BODY_MISSING");
        return input.ingestion.persistAlbert(result, {
          manifest: currentLeaflet,
          rawStorageKey: options.rawStorageKey,
        });
      },
    },
    rawSnapshots: {
      read: (storageKey) => input.rawSnapshots.readBinary(storageKey, "pdf"),
    },
    isSourceUrlAllowed: async (sourceUrl) => {
      const index = await (input.fetchResource ?? fetchAlbertResource)({
        url: ALBERT_LEAFLET_INDEX_URL,
        expected: "html",
      });
      if (!index.body || index.notModified) {
        throw new Error("ALBERT_INDEX_BODY_MISSING");
      }
      currentLeaflet =
        discoverAlbertLeaflets(new TextDecoder().decode(index.body)).find(
          ({ kind }) => kind === input.kind,
        ) ?? null;
      return currentLeaflet?.pdfUrl === sourceUrl;
    },
    parse: ({ content: pdfBytes, previous }) => {
      if (!currentLeaflet) {
        throw new Error("ALBERT_RETAINED_SNAPSHOT_IS_NOT_CURRENT");
      }
      return (input.processSnapshot ?? processAlbertLeafletSnapshot)({
        manifest: currentLeaflet,
        pdfBytes,
        httpStatus: previous.httpStatus,
        retrievedAt: previous.retrievedAt,
        etag: previous.etag,
        lastModified: previous.lastModified,
        previousContentHash: null,
        previousParserVersion: null,
        productMappings,
      });
    },
  });
}

export async function runAlbertOperationOnce(input: OperationInput) {
  const prepared = await prepareConnectorRun({
    manifest: ALBERT_CONNECTOR_MANIFEST,
    now: input.now,
    workerId: input.workerId,
    jobs: input.jobs,
    retention: {
      purgeExpired: (now) => input.rawSnapshots.purgeExpired(now),
      markRawDeleted: (storageKeys, deletedAt) =>
        input.ingestion.markRawDeleted(storageKeys, deletedAt),
    },
  });
  const claims = prepared.claims as ClaimedAlbertJob[];
  if (claims.length === 0) {
    return {
      status: "not-due" as const,
      deletedRawCount: prepared.deletedRawCount,
    };
  }

  const fetchResource = input.fetchResource ?? fetchAlbertResource;
  let manifests: readonly AlbertLeafletManifest[];
  try {
    const index = await fetchResource({
      url: ALBERT_LEAFLET_INDEX_URL,
      expected: "html",
    });
    if (!index.body || index.notModified) {
      throw new Error("ALBERT_INDEX_BODY_MISSING");
    }
    manifests = discoverAlbertLeaflets(new TextDecoder().decode(index.body));
  } catch (error) {
    await Promise.all(
      claims.map((claim) =>
        input.jobs.fail(
          claim.id,
          input.workerId,
          errorCode(error),
          isRetryable(error),
          input.now,
        ),
      ),
    );
    throw error;
  }

  let offerCount = 0;
  let quarantineCount = 0;
  let completedScopes = 0;
  for (const claim of claims) {
    const kind = kindForScope(claim.sourceScopeKey);
    const manifest = manifests.find((item) => item.kind === kind);
    if (!manifest) {
      await input.jobs.fail(
        claim.id,
        input.workerId,
        "MISSING_LEAFLET_SCOPE",
        false,
        input.now,
      );
      continue;
    }
    try {
      const previous = await input.ingestion.latestRetrieval(
        claim.sourceScopeKey,
      );
      const fetched = await fetchResource({
        url: manifest.pdfUrl,
        expected: "pdf",
        etag: previous?.etag ?? null,
        lastModified: previous?.lastModified ?? null,
      });
      let result: AlbertSnapshotResult;
      let rawStorageKey: string | null = null;
      if (fetched.notModified) {
        if (!previous) throw new Error("ALBERT_304_WITHOUT_PREVIOUS");
        result = createAlbertNotModifiedResult({
          manifest,
          retrievedAt: input.now,
          contentHash: previous.contentHash,
          parserVersion: previous.parserVersion,
          etag: fetched.etag ?? previous.etag,
          lastModified: fetched.lastModified ?? previous.lastModified,
        });
      } else {
        if (!fetched.body) throw new Error("ALBERT_PDF_BODY_MISSING");
        const mappings = await input.ingestion.loadApprovedAlbertMappings(kind);
        result = await (input.processSnapshot ?? processAlbertLeafletSnapshot)({
          manifest,
          pdfBytes: fetched.body,
          httpStatus: fetched.httpStatus,
          retrievedAt: input.now,
          etag: fetched.etag,
          lastModified: fetched.lastModified,
          previousContentHash: claim.previousContentHash,
          previousParserVersion: claim.previousParserVersion,
          productMappings: mappings,
        });
        if (result.status !== "unchanged") {
          const stored = await input.rawSnapshots.writeBinary({
            bytes: fetched.body,
            extension: "pdf",
            contentHash: result.retrieval.contentHash,
            retrievedAt: result.retrieval.retrievedAt,
            rawDeleteAt: result.retrieval.rawDeleteAt,
          });
          rawStorageKey = stored.storageKey;
        }
      }
      await input.ingestion.persistAlbert(result, { manifest, rawStorageKey });
      await input.jobs.complete({
        jobId: claim.id,
        workerId: input.workerId,
        completedAt: input.now,
        nextDueAt: nextConnectorDueAt(
          ALBERT_CONNECTOR_MANIFEST,
          claim.sourceScopeKey,
          input.now,
        ),
        parserVersion: result.retrieval.parserVersion,
        contentHash: result.retrieval.contentHash,
        coverageItems: [
          {
            key: claim.sourceScopeKey,
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
                ? (result.quarantines[0]?.reasonCode ?? "PARSE_QUARANTINED")
                : null,
          },
        ],
      });
      completedScopes += 1;
      offerCount += result.offers.length;
      quarantineCount += result.quarantines.length;
    } catch (error) {
      await input.jobs.fail(
        claim.id,
        input.workerId,
        errorCode(error),
        isRetryable(error),
        input.now,
      );
    }
  }

  return {
    status:
      completedScopes === claims.length
        ? ("completed" as const)
        : ("partial" as const),
    scopeCount: completedScopes,
    offerCount,
    quarantineCount,
    deletedRawCount: prepared.deletedRawCount,
  };
}

function kindForScope(sourceScopeKey: string): AlbertLeafletKind {
  if (sourceScopeKey === ALBERT_SUPERMARKET_SCOPE.key) return "supermarket";
  if (sourceScopeKey === ALBERT_HYPERMARKET_SCOPE.key) return "hypermarket";
  throw new Error("UNKNOWN_ALBERT_SCOPE");
}

function errorCode(error: unknown): string {
  if (error instanceof Error && "code" in error) {
    return String((error as Error & { code: unknown }).code).slice(0, 120);
  }
  return error instanceof Error
    ? error.message.replace(/[^A-Z0-9_]+/gi, "_").slice(0, 120)
    : "ALBERT_INGESTION_FAILED";
}

function isRetryable(error: unknown): boolean {
  return (
    error instanceof Error &&
    "httpStatus" in error &&
    typeof (error as Error & { httpStatus: unknown }).httpStatus === "number" &&
    Number((error as Error & { httpStatus: number }).httpStatus) >= 500
  );
}
