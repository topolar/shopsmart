import {
  connectorManifestSchema,
  coverageItemSchema,
  type ConnectorManifest,
} from "@shopsmart/contracts";

export type ClaimedConnectorJob = Readonly<{
  id: string;
  sourceScopeKey: string;
  leaseOwner: string;
  previousContentHash: string | null;
  previousParserVersion: string | null;
}>;

export type ConnectorRuntimeAdapter = Readonly<{
  manifest: ConnectorManifest;
  run(input: Readonly<{ now: string; workerId: string }>): Promise<unknown>;
  reprocess(sourceScopeKey: string): Promise<unknown>;
}>;

type JobPreparationPort = Readonly<{
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
  }): Promise<ClaimedConnectorJob[]>;
}>;

export async function prepareConnectorRun(input: {
  manifest: ConnectorManifest;
  now: string;
  workerId: string;
  jobs: JobPreparationPort;
  retention: Readonly<{
    purgeExpired(now: string): Promise<string[]>;
    markRawDeleted(
      storageKeys: readonly string[],
      deletedAt: string,
    ): Promise<void>;
  }>;
}) {
  const manifest = connectorManifestSchema.parse(input.manifest);
  const now = canonicalTimestamp(input.now, "now");
  if (!input.workerId.trim()) throw new Error("workerId is required.");
  const deleted = await input.retention.purgeExpired(now);
  await input.retention.markRawDeleted(deleted, now);

  const claims: ClaimedConnectorJob[] = [];
  for (const scope of manifest.scopes) {
    await input.jobs.register({
      sourceScopeKey: scope.key,
      requiredCoverageKeys: [...scope.requiredCoverageKeys],
      dueAt: now,
      expectedParserVersion: manifest.parserVersion,
      maxAttempts: scope.maxAttempts,
    });
    const [claim] = await input.jobs.claimDue({
      workerId: input.workerId,
      now,
      leaseSeconds: scope.leaseSeconds,
      limit: 1,
      sourceScopeKey: scope.key,
    });
    if (!claim) continue;
    if (
      claim.sourceScopeKey !== scope.key ||
      claim.leaseOwner !== input.workerId
    ) {
      throw new Error("CONNECTOR_LEASE_SCOPE_MISMATCH");
    }
    claims.push(claim);
  }
  return { claims, deletedRawCount: deleted.length };
}

export type StoredConnectorRetrieval = Readonly<{
  contentHash: string;
  parserVersion: string;
  etag: string | null;
  lastModified: string | null;
  rawStorageKey: string | null;
  sourceUrl: string;
  retrievedAt: string;
  httpStatus: number;
  rawDeleteAt?: string;
}>;

type ReprocessedResult = Readonly<{
  status: "parsed" | "unchanged" | "quarantined";
  retrieval: Readonly<{
    sourceScopeKey: string;
    sourceUrl: string;
    retrievedAt: string;
    httpStatus: number;
    contentHash: string;
    parserVersion: string;
  }>;
  offers: readonly unknown[];
  quarantines: readonly unknown[];
}>;

export async function reprocessRetainedSnapshot<
  Content,
  Result extends ReprocessedResult,
>(input: {
  manifest: ConnectorManifest;
  scopeKey: string;
  ingestion: Readonly<{
    latestRetainedRetrieval(
      sourceScopeKey: string,
    ): Promise<StoredConnectorRetrieval | null>;
    persist(
      result: Result,
      options: { rawStorageKey: string | null },
    ): Promise<unknown>;
  }>;
  rawSnapshots: Readonly<{
    read(storageKey: string): Promise<Content>;
  }>;
  parse(input: {
    content: Content;
    previous: StoredConnectorRetrieval;
  }): Promise<Result> | Result;
  isSourceUrlAllowed?: (sourceUrl: string) => Promise<boolean> | boolean;
}) {
  const manifest = connectorManifestSchema.parse(input.manifest);
  const scope = manifest.scopes.find(({ key }) => key === input.scopeKey);
  if (!scope) throw new Error("UNKNOWN_CONNECTOR_SCOPE");
  const previous = await input.ingestion.latestRetainedRetrieval(scope.key);
  if (!previous?.rawStorageKey) {
    throw new Error("CONNECTOR_RAW_SNAPSHOT_UNAVAILABLE");
  }
  const sourceAllowed = input.isSourceUrlAllowed
    ? await input.isSourceUrlAllowed(previous.sourceUrl)
    : previous.sourceUrl === scope.entryUrl;
  if (!sourceAllowed) throw new Error("CONNECTOR_RETAINED_SCOPE_MISMATCH");
  const content = await input.rawSnapshots.read(previous.rawStorageKey);
  const result = await input.parse({ content, previous });
  if (
    result.retrieval.sourceScopeKey !== scope.key ||
    result.retrieval.parserVersion !== manifest.parserVersion
  ) {
    throw new Error("CONNECTOR_REPROCESS_CONTRACT_MISMATCH");
  }
  if (result.retrieval.contentHash !== previous.contentHash) {
    throw new Error("CONNECTOR_RETAINED_SNAPSHOT_HASH_MISMATCH");
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

type JobHealth = Readonly<{
  sourceScopeKey: string;
  status: string;
  dueAt: string;
  leaseExpiresAt: string | null;
  rateLimitUntil: string | null;
  lastSuccessAt: string | null;
  lastContentHash: string | null;
  parserVersion: string | null;
  expectedParserVersion: string;
  lastErrorCode: string | null;
  lastCoverageComplete: boolean;
  quarantineCount: number;
  attempts: number;
}>;

type LatestRun = Readonly<{
  status: string;
  coverageManifest: unknown;
  contentHash: string | null;
  parserVersion: string | null;
  completedAt: string;
}>;

type RetrievalHealth = Readonly<{
  sourceUrl: string;
  retrievedAt: string;
  httpStatus: number;
  rawStorageKey?: string | null;
  rawDeleteAt?: string;
}>;

export async function collectConnectorHealth(input: {
  manifest: ConnectorManifest;
  jobs: Readonly<{
    health(sourceScopeKey: string): Promise<JobHealth>;
    latestRun(sourceScopeKey: string): Promise<LatestRun | null>;
  }>;
  ingestion: Readonly<{
    latestRetrieval(sourceScopeKey: string): Promise<RetrievalHealth | null>;
    latestRetainedRetrieval(
      sourceScopeKey: string,
    ): Promise<RetrievalHealth | null>;
  }>;
}) {
  const manifest = connectorManifestSchema.parse(input.manifest);
  const scopes = await Promise.all(
    manifest.scopes.map(async (scope) => {
      const [job, run, latest, retained] = await Promise.all([
        input.jobs.health(scope.key),
        input.jobs.latestRun(scope.key),
        input.ingestion.latestRetrieval(scope.key),
        input.ingestion.latestRetainedRetrieval(scope.key),
      ]);
      const counts = coverageCounts(run?.coverageManifest, scope.key);
      return {
        connectorId: manifest.connectorId,
        sourceScopeKey: scope.key,
        status: job.status,
        dueAt: job.dueAt,
        leaseExpiresAt: job.leaseExpiresAt,
        rateLimitUntil: job.rateLimitUntil,
        attempts: job.attempts,
        lastAttemptAt: run?.completedAt ?? null,
        lastSuccessAt: job.lastSuccessAt,
        lastContentChangeAt:
          retained?.retrievedAt ?? latest?.retrievedAt ?? null,
        sourceUrl: latest?.sourceUrl ?? scope.entryUrl,
        httpStatus: latest?.httpStatus ?? null,
        parserVersion: job.parserVersion,
        expectedParserVersion: job.expectedParserVersion,
        parserCurrent:
          job.parserVersion === null ||
          job.parserVersion === job.expectedParserVersion,
        lastErrorCode: job.lastErrorCode,
        coverageComplete: job.lastCoverageComplete,
        candidateCount: counts.candidateCount,
        offerCount: counts.offerCount,
        quarantineCount: counts.quarantineCount,
        rawSnapshotAvailable: Boolean(retained?.rawStorageKey),
        rawDeleteAt: retained?.rawDeleteAt ?? null,
      };
    }),
  );
  return {
    contractVersion: manifest.contractVersion,
    connectorId: manifest.connectorId,
    displayName: manifest.displayName,
    scopes,
  };
}

export function assertConnectorRegistryConformance(
  manifestsInput: readonly ConnectorManifest[],
): void {
  const manifests = manifestsInput.map((manifest) =>
    connectorManifestSchema.parse(manifest),
  );
  const connectorIds = manifests.map(({ connectorId }) => connectorId);
  if (new Set(connectorIds).size !== connectorIds.length) {
    throw new Error("DUPLICATE_CONNECTOR_ID");
  }
  const scopeKeys = manifests.flatMap(({ scopes }) =>
    scopes.map(({ key }) => key),
  );
  if (new Set(scopeKeys).size !== scopeKeys.length) {
    throw new Error("DUPLICATE_CONNECTOR_SCOPE");
  }
}

export function assertConnectorAdapterConformance(
  adapters: readonly ConnectorRuntimeAdapter[],
): void {
  assertConnectorRegistryConformance(adapters.map(({ manifest }) => manifest));
  for (const adapter of adapters) {
    if (
      typeof adapter.run !== "function" ||
      typeof adapter.reprocess !== "function" ||
      !adapter.manifest.capabilities.retainedSnapshotReprocess
    ) {
      throw new Error("INCOMPLETE_CONNECTOR_ADAPTER");
    }
  }
}

export function nextConnectorDueAt(
  manifestInput: ConnectorManifest,
  sourceScopeKey: string,
  completedAt: string,
): string {
  const scope = connectorScope(manifestInput, sourceScopeKey);
  const completed = Date.parse(canonicalTimestamp(completedAt, "completedAt"));
  return new Date(
    completed + scope.refreshIntervalSeconds * 1_000,
  ).toISOString();
}

export function connectorRateLimitUntil(
  manifestInput: ConnectorManifest,
  sourceScopeKey: string,
  failedAt: string,
  providerRetryAt: string | null,
): string {
  const scope = connectorScope(manifestInput, sourceScopeKey);
  const failed = Date.parse(canonicalTimestamp(failedAt, "failedAt"));
  const provider = providerRetryAt ? Date.parse(providerRetryAt) : 0;
  return new Date(
    Math.max(failed + scope.minimumRateLimitPauseSeconds * 1_000, provider),
  ).toISOString();
}

function connectorScope(
  manifestInput: ConnectorManifest,
  sourceScopeKey: string,
) {
  const manifest = connectorManifestSchema.parse(manifestInput);
  const scope = manifest.scopes.find(({ key }) => key === sourceScopeKey);
  if (!scope) throw new Error("UNKNOWN_CONNECTOR_SCOPE");
  return scope;
}

function coverageCounts(value: unknown, sourceScopeKey: string) {
  if (!value || typeof value !== "object" || !("items" in value)) {
    return { candidateCount: 0, offerCount: 0, quarantineCount: 0 };
  }
  const items = Array.isArray(value.items) ? value.items : [];
  return items.reduce(
    (totals, item) => {
      const parsed = coverageItemSchema.safeParse(item);
      if (!parsed.success || parsed.data.key !== sourceScopeKey) return totals;
      return {
        candidateCount: totals.candidateCount + parsed.data.candidateCount,
        offerCount: totals.offerCount + parsed.data.offerCount,
        quarantineCount: totals.quarantineCount + parsed.data.quarantineCount,
      };
    },
    { candidateCount: 0, offerCount: 0, quarantineCount: 0 },
  );
}

function canonicalTimestamp(value: string, name: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${name} must be a canonical ISO timestamp.`);
  }
  return parsed.toISOString();
}
