import {
  ALBERT_HYPERMARKET_SCOPE,
  ALBERT_LEAFLET_INDEX_URL,
  ALBERT_LEAFLET_PARSER_VERSION,
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

const scopes = [ALBERT_SUPERMARKET_SCOPE, ALBERT_HYPERMARKET_SCOPE] as const;

export async function runAlbertOperationOnce(input: OperationInput) {
  const deleted = await input.rawSnapshots.purgeExpired(input.now);
  await input.ingestion.markRawDeleted(deleted, input.now);
  for (const scope of scopes) {
    await input.jobs.register({
      sourceScopeKey: scope.key,
      requiredCoverageKeys: [scope.key],
      dueAt: input.now,
      expectedParserVersion: ALBERT_LEAFLET_PARSER_VERSION,
      maxAttempts: 3,
    });
  }
  const claims = (
    await Promise.all(
      scopes.map(async (scope) => {
        const [claim] = await input.jobs.claimDue({
          workerId: input.workerId,
          now: input.now,
          leaseSeconds: 30 * 60,
          limit: 1,
          sourceScopeKey: scope.key,
        });
        return claim ?? null;
      }),
    )
  ).filter((claim): claim is ClaimedAlbertJob => claim !== null);
  if (claims.length === 0) {
    return { status: "not-due" as const, deletedRawCount: deleted.length };
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
        nextDueAt: new Date(
          Date.parse(input.now) + 12 * 60 * 60 * 1_000,
        ).toISOString(),
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
    deletedRawCount: deleted.length,
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
