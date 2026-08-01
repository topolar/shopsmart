import {
  coverageManifestSchema,
  earlyRefreshTriggerSchema,
  serviceAreaContextSchema,
  type CoverageItemInput,
  type EarlyRefreshTrigger,
  type ServiceAreaContext,
} from "@shopsmart/contracts";
import {
  calculateConnectorRetryAt,
  decideStaticContextRefresh,
  isServiceAreaContextUsable,
  summarizeCoverageManifest,
} from "@shopsmart/domain";
import { EntitySchema, type DataSource } from "typeorm";

type ConnectorJobStatus =
  "idle" | "leased" | "retry" | "rate-limited" | "quarantined" | "dead-letter";

export class ConnectorJobRecord {
  id!: string;
  sourceScopeKey!: string;
  requiredCoverageKeys!: string[];
  status!: ConnectorJobStatus;
  dueAt!: Date;
  leaseOwner!: string | null;
  leaseExpiresAt!: Date | null;
  attempts!: number;
  maxAttempts!: number;
  rateLimitUntil!: Date | null;
  expectedParserVersion!: string;
  parserVersion!: string | null;
  lastContentHash!: string | null;
  lastSuccessAt!: Date | null;
  lastErrorCode!: string | null;
  lastCoverageComplete!: boolean;
  quarantineCount!: number;
  createdAt!: Date;
  updatedAt!: Date;
}

export class ConnectorRunRecord {
  id!: string;
  jobId!: string;
  workerId!: string;
  status!: "success" | "quarantined" | "failed";
  coverageManifest!: unknown;
  contentHash!: string | null;
  parserVersion!: string | null;
  completedAt!: Date;
  createdAt!: Date;
}

export class StaticContextRecord {
  id!: string;
  sourceScopeKey!: string;
  contextKey!: string;
  payload!: Record<string, unknown>;
  sourceUrl!: string;
  verifiedAt!: Date;
  expiresAt!: Date;
  createdAt!: Date;
  updatedAt!: Date;
}

export class ConnectorRefreshEventRecord {
  id!: string;
  jobId!: string;
  trigger!: EarlyRefreshTrigger;
  requestedAt!: Date;
}

export const connectorJobRecordSchema = new EntitySchema<ConnectorJobRecord>({
  name: "ConnectorJobRecord",
  tableName: "connector_jobs",
  target: ConnectorJobRecord,
  columns: {
    id: { type: "uuid", primary: true, generated: "uuid" },
    sourceScopeKey: {
      name: "source_scope_key",
      type: "varchar",
      length: 240,
      unique: true,
    },
    requiredCoverageKeys: { name: "required_coverage_keys", type: "jsonb" },
    status: { type: "varchar", length: 24 },
    dueAt: { name: "due_at", type: "timestamptz" },
    leaseOwner: {
      name: "lease_owner",
      type: "varchar",
      length: 160,
      nullable: true,
    },
    leaseExpiresAt: {
      name: "lease_expires_at",
      type: "timestamptz",
      nullable: true,
    },
    attempts: { type: "integer", default: 0 },
    maxAttempts: { name: "max_attempts", type: "integer", default: 3 },
    rateLimitUntil: {
      name: "rate_limit_until",
      type: "timestamptz",
      nullable: true,
    },
    expectedParserVersion: {
      name: "expected_parser_version",
      type: "varchar",
      length: 120,
    },
    parserVersion: {
      name: "parser_version",
      type: "varchar",
      length: 120,
      nullable: true,
    },
    lastContentHash: {
      name: "last_content_hash",
      type: "char",
      length: 64,
      nullable: true,
    },
    lastSuccessAt: {
      name: "last_success_at",
      type: "timestamptz",
      nullable: true,
    },
    lastErrorCode: {
      name: "last_error_code",
      type: "varchar",
      length: 120,
      nullable: true,
    },
    lastCoverageComplete: {
      name: "last_coverage_complete",
      type: "boolean",
      default: false,
    },
    quarantineCount: { name: "quarantine_count", type: "integer", default: 0 },
    createdAt: { name: "created_at", type: "timestamptz", createDate: true },
    updatedAt: { name: "updated_at", type: "timestamptz", updateDate: true },
  },
});

export const connectorRunRecordSchema = new EntitySchema<ConnectorRunRecord>({
  name: "ConnectorRunRecord",
  tableName: "connector_runs",
  target: ConnectorRunRecord,
  columns: {
    id: { type: "uuid", primary: true, generated: "uuid" },
    jobId: { name: "job_id", type: "uuid" },
    workerId: { name: "worker_id", type: "varchar", length: 160 },
    status: { type: "varchar", length: 24 },
    coverageManifest: { name: "coverage_manifest", type: "jsonb" },
    contentHash: {
      name: "content_hash",
      type: "char",
      length: 64,
      nullable: true,
    },
    parserVersion: {
      name: "parser_version",
      type: "varchar",
      length: 120,
      nullable: true,
    },
    completedAt: { name: "completed_at", type: "timestamptz" },
    createdAt: { name: "created_at", type: "timestamptz", createDate: true },
  },
});

export const staticContextRecordSchema = new EntitySchema<StaticContextRecord>({
  name: "StaticContextRecord",
  tableName: "static_context_cache",
  target: StaticContextRecord,
  columns: {
    id: { type: "uuid", primary: true, generated: "uuid" },
    sourceScopeKey: { name: "source_scope_key", type: "varchar", length: 240 },
    contextKey: { name: "context_key", type: "varchar", length: 160 },
    payload: { type: "jsonb" },
    sourceUrl: { name: "source_url", type: "varchar", length: 2048 },
    verifiedAt: { name: "verified_at", type: "timestamptz" },
    expiresAt: { name: "expires_at", type: "timestamptz" },
    createdAt: { name: "created_at", type: "timestamptz", createDate: true },
    updatedAt: { name: "updated_at", type: "timestamptz", updateDate: true },
  },
  uniques: [
    {
      name: "uq_static_context_scope_key",
      columns: ["sourceScopeKey", "contextKey"],
    },
  ],
});

export const connectorRefreshEventRecordSchema =
  new EntitySchema<ConnectorRefreshEventRecord>({
    name: "ConnectorRefreshEventRecord",
    tableName: "connector_refresh_events",
    target: ConnectorRefreshEventRecord,
    columns: {
      id: { type: "uuid", primary: true, generated: "uuid" },
      jobId: { name: "job_id", type: "uuid" },
      trigger: { type: "varchar", length: 40 },
      requestedAt: { name: "requested_at", type: "timestamptz" },
    },
  });

export class IncompleteCoverageError extends Error {
  readonly code = "INCOMPLETE_COVERAGE";
  constructor() {
    super("Every required coverage key must have an explicit result.");
    this.name = "IncompleteCoverageError";
  }
}

type ClaimedConnectorJob = Readonly<{
  id: string;
  sourceScopeKey: string;
  leaseOwner: string;
  requiredCoverageKeys: readonly string[];
  attempts: number;
  expectedParserVersion: string;
  previousContentHash: string | null;
  previousParserVersion: string | null;
}>;

export class TypeOrmConnectorJobStore {
  constructor(private readonly dataSource: DataSource) {}

  async register(input: {
    sourceScopeKey: string;
    requiredCoverageKeys: string[];
    dueAt: string;
    expectedParserVersion: string;
    maxAttempts: number;
  }): Promise<ConnectorJobRecord> {
    if (input.requiredCoverageKeys.length === 0)
      throw new Error("Coverage keys are required.");
    if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1)
      throw new Error("maxAttempts must be a positive integer.");
    const coverageKeys = [...new Set(input.requiredCoverageKeys)].toSorted();
    const repository = this.dataSource.getRepository(ConnectorJobRecord);
    await this.dataSource.query(
      `INSERT INTO "connector_jobs" (
        "source_scope_key", "required_coverage_keys", "status", "due_at",
        "max_attempts", "expected_parser_version"
      ) VALUES ($1, $2::jsonb, 'idle', $3, $4, $5)
      ON CONFLICT ("source_scope_key") DO UPDATE SET
        "required_coverage_keys" = EXCLUDED."required_coverage_keys",
        "max_attempts" = EXCLUDED."max_attempts",
        "expected_parser_version" = EXCLUDED."expected_parser_version",
        "updated_at" = CURRENT_TIMESTAMP`,
      [
        input.sourceScopeKey,
        JSON.stringify(coverageKeys),
        new Date(input.dueAt),
        input.maxAttempts,
        input.expectedParserVersion,
      ],
    );
    return repository.findOneByOrFail({ sourceScopeKey: input.sourceScopeKey });
  }

  async claimDue(input: {
    workerId: string;
    now: string;
    leaseSeconds: number;
    limit: number;
    sourceScopeKey?: string;
  }): Promise<ClaimedConnectorJob[]> {
    const now = new Date(input.now);
    const leaseExpiresAt = new Date(now.getTime() + input.leaseSeconds * 1000);
    return this.dataSource.transaction(async (manager) => {
      const queryResult = (await manager.query(
        `WITH candidates AS (
          SELECT "id" FROM "connector_jobs"
          WHERE "due_at" <= $1 AND (
            ("status" IN ('idle','retry','rate-limited')
              AND ("rate_limit_until" IS NULL OR "rate_limit_until" <= $1))
            OR ("status" = 'leased' AND "lease_expires_at" <= $1)
          )
          AND ($5::varchar IS NULL OR "source_scope_key" = $5)
          ORDER BY "due_at", "source_scope_key"
          LIMIT $2
          FOR UPDATE SKIP LOCKED
        )
        UPDATE "connector_jobs" AS job
        SET "status" = 'leased', "lease_owner" = $3,
            "lease_expires_at" = $4, "attempts" = job."attempts" + 1,
            "updated_at" = CURRENT_TIMESTAMP
        FROM candidates
        WHERE job."id" = candidates."id"
        RETURNING job.*`,
        [
          now,
          input.limit,
          input.workerId,
          leaseExpiresAt,
          input.sourceScopeKey ?? null,
        ],
      )) as unknown;
      const rows = normalizeQueryRows(queryResult);
      return rows.map((row) => ({
        id: row.id as string,
        sourceScopeKey: row.source_scope_key as string,
        leaseOwner: row.lease_owner as string,
        requiredCoverageKeys: row.required_coverage_keys as string[],
        attempts: row.attempts as number,
        expectedParserVersion: row.expected_parser_version as string,
        previousContentHash: row.last_content_hash as string | null,
        previousParserVersion: row.parser_version as string | null,
      }));
    });
  }

  async complete(input: {
    jobId: string;
    workerId: string;
    completedAt: string;
    nextDueAt: string;
    parserVersion: string;
    contentHash: string;
    coverageItems: CoverageItemInput[];
  }): Promise<void> {
    const completionError = await this.dataSource.transaction(
      async (manager) => {
        const repository = manager.getRepository(ConnectorJobRecord);
        const job = await repository.findOne({
          where: { id: input.jobId },
          lock: { mode: "pessimistic_write" },
        });
        if (
          !job ||
          job.status !== "leased" ||
          job.leaseOwner !== input.workerId
        )
          throw new Error("INVALID_CONNECTOR_LEASE");
        const summary = summarizeCoverageManifest(
          job.requiredCoverageKeys,
          input.coverageItems,
        );
        if (!summary.complete) {
          await manager.getRepository(ConnectorRunRecord).save({
            jobId: job.id,
            workerId: input.workerId,
            status: "failed",
            coverageManifest: {
              expectedKeys: job.requiredCoverageKeys,
              items: input.coverageItems,
              summary,
            },
            contentHash: input.contentHash,
            parserVersion: input.parserVersion,
            completedAt: new Date(input.completedAt),
          });
          await repository.update(
            { id: job.id },
            {
              status: "quarantined",
              leaseOwner: null,
              leaseExpiresAt: null,
              lastErrorCode: "INCOMPLETE_COVERAGE",
              lastCoverageComplete: false,
              quarantineCount: job.quarantineCount + 1,
            },
          );
          return new IncompleteCoverageError();
        }
        const manifest = coverageManifestSchema.parse({
          expectedKeys: job.requiredCoverageKeys,
          items: input.coverageItems,
        });
        const parserDrift = input.parserVersion !== job.expectedParserVersion;
        await manager.getRepository(ConnectorRunRecord).save({
          jobId: job.id,
          workerId: input.workerId,
          status: parserDrift
            ? "quarantined"
            : summary.successful
              ? "success"
              : "failed",
          coverageManifest: { ...manifest, summary },
          contentHash: input.contentHash,
          parserVersion: input.parserVersion,
          completedAt: new Date(input.completedAt),
        });
        if (parserDrift || !summary.successful) {
          await repository.update(
            { id: job.id },
            {
              status: "quarantined",
              leaseOwner: null,
              leaseExpiresAt: null,
              lastErrorCode: parserDrift ? "PARSER_DRIFT" : "COVERAGE_ERROR",
              lastCoverageComplete: summary.complete,
              quarantineCount: job.quarantineCount + 1,
            },
          );
          return null;
        }
        await repository.update(
          { id: job.id },
          {
            status: "idle",
            dueAt: new Date(input.nextDueAt),
            leaseOwner: null,
            leaseExpiresAt: null,
            attempts: 0,
            rateLimitUntil: null,
            parserVersion: input.parserVersion,
            lastContentHash: input.contentHash,
            lastSuccessAt: new Date(input.completedAt),
            lastErrorCode: null,
            lastCoverageComplete: true,
          },
        );
        return null;
      },
    );
    if (completionError) throw completionError;
  }

  async fail(
    jobId: string,
    workerId: string,
    errorCode: string,
    retryable: boolean,
    failedAt: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(ConnectorJobRecord);
      const job = await repository.findOne({
        where: { id: jobId },
        lock: { mode: "pessimistic_write" },
      });
      if (!job || job.status !== "leased" || job.leaseOwner !== workerId)
        throw new Error("INVALID_CONNECTOR_LEASE");
      const retry = retryable && job.attempts < job.maxAttempts;
      await repository.update(
        { id: job.id },
        {
          status: retry ? "retry" : "dead-letter",
          dueAt: retry
            ? new Date(calculateConnectorRetryAt(failedAt, job.attempts))
            : job.dueAt,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: errorCode,
        },
      );
      await manager.getRepository(ConnectorRunRecord).save({
        jobId: job.id,
        workerId,
        status: "failed",
        coverageManifest: { expectedKeys: job.requiredCoverageKeys, items: [] },
        contentHash: null,
        parserVersion: null,
        completedAt: new Date(failedAt),
      });
    });
  }

  async recordRateLimit(jobId: string, until: string): Promise<void> {
    await this.dataSource.getRepository(ConnectorJobRecord).update(
      { id: jobId },
      {
        status: "rate-limited",
        dueAt: new Date(until),
        rateLimitUntil: new Date(until),
        lastErrorCode: "RATE_LIMITED",
      },
    );
  }

  async requestEarlyRefresh(
    jobId: string,
    triggerInput: EarlyRefreshTrigger,
    requestedAt: string,
  ): Promise<void> {
    const trigger = earlyRefreshTriggerSchema.parse(triggerInput);
    await this.dataSource.transaction(async (manager) => {
      const job = await manager
        .getRepository(ConnectorJobRecord)
        .findOne({ where: { id: jobId }, lock: { mode: "pessimistic_write" } });
      if (!job) throw new Error("UNKNOWN_CONNECTOR_JOB");
      await manager
        .getRepository(ConnectorRefreshEventRecord)
        .save({ jobId, trigger, requestedAt: new Date(requestedAt) });
      if (job.status !== "leased") {
        await manager.getRepository(ConnectorJobRecord).update(
          { id: jobId },
          {
            status: "idle",
            dueAt: new Date(requestedAt),
            rateLimitUntil: null,
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        );
      }
    });
  }

  async saveStaticContext(input: {
    sourceScopeKey: string;
    contextKey: string;
    payload: Record<string, unknown>;
    sourceUrl: string;
    verifiedAt: string;
    expiresAt: string;
  }): Promise<void> {
    const sourceUrl = new URL(input.sourceUrl);
    if (!["http:", "https:"].includes(sourceUrl.protocol)) {
      throw new Error("Static context source URL must use HTTP(S).");
    }
    await this.dataSource.getRepository(StaticContextRecord).upsert(
      {
        ...input,
        payload: input.payload as never,
        verifiedAt: new Date(input.verifiedAt),
        expiresAt: new Date(input.expiresAt),
      },
      ["sourceScopeKey", "contextKey"],
    );
  }

  async readStaticContext(
    sourceScopeKey: string,
    contextKey: string,
    now: string,
    trigger?: EarlyRefreshTrigger,
  ): Promise<StaticContextRecord | null> {
    const record = await this.dataSource
      .getRepository(StaticContextRecord)
      .findOneBy({ sourceScopeKey, contextKey });
    if (!record) return null;
    const decision = decideStaticContextRefresh({
      kind: "static",
      now,
      expiresAt: record.expiresAt.toISOString(),
      ...(trigger ? { trigger } : {}),
    });
    return decision.refresh ? null : record;
  }

  async saveServiceAreaContext(
    sourceScopeKey: string,
    contextInput: unknown,
  ): Promise<void> {
    const context = serviceAreaContextSchema.parse(contextInput);
    await this.saveStaticContext({
      sourceScopeKey,
      contextKey: serviceAreaContextKey(context.serviceAreaId),
      payload: { ...context },
      sourceUrl: context.sourceUrl,
      verifiedAt: context.verifiedAt,
      expiresAt: context.expiresAt,
    });
  }

  async readServiceAreaContext(
    sourceScopeKey: string,
    serviceAreaId: string,
    tenantLocalityInput: unknown,
    now: string,
  ): Promise<ServiceAreaContext | null> {
    const record = await this.readStaticContext(
      sourceScopeKey,
      serviceAreaContextKey(serviceAreaId),
      now,
    );
    if (!record) return null;
    const context = serviceAreaContextSchema.safeParse(record.payload);
    if (
      !context.success ||
      context.data.serviceAreaId !== serviceAreaId ||
      !isServiceAreaContextUsable(context.data, tenantLocalityInput, now)
    ) {
      return null;
    }
    return context.data;
  }

  async health(sourceScopeKey: string) {
    const job = await this.dataSource
      .getRepository(ConnectorJobRecord)
      .findOneByOrFail({ sourceScopeKey });
    return {
      sourceScopeKey,
      status: job.status,
      dueAt: job.dueAt.toISOString(),
      leaseExpiresAt: job.leaseExpiresAt?.toISOString() ?? null,
      rateLimitUntil: job.rateLimitUntil?.toISOString() ?? null,
      lastSuccessAt: job.lastSuccessAt?.toISOString() ?? null,
      lastContentHash: job.lastContentHash?.trim() ?? null,
      parserVersion: job.parserVersion,
      expectedParserVersion: job.expectedParserVersion,
      lastErrorCode: job.lastErrorCode,
      lastCoverageComplete: job.lastCoverageComplete,
      quarantineCount: job.quarantineCount,
      attempts: job.attempts,
    };
  }

  async latestRun(sourceScopeKey: string) {
    const job = await this.dataSource
      .getRepository(ConnectorJobRecord)
      .findOneByOrFail({ sourceScopeKey });
    const run = await this.dataSource
      .getRepository(ConnectorRunRecord)
      .findOne({
        where: { jobId: job.id },
        order: { completedAt: "DESC", createdAt: "DESC" },
      });
    return run
      ? {
          status: run.status,
          coverageManifest: run.coverageManifest,
          contentHash: run.contentHash?.trim() ?? null,
          parserVersion: run.parserVersion,
          completedAt: run.completedAt.toISOString(),
        }
      : null;
  }
}

function serviceAreaContextKey(serviceAreaId: string): string {
  return `service-area:${serviceAreaId}`;
}

function normalizeQueryRows(result: unknown): Record<string, unknown>[] {
  if (!Array.isArray(result)) return [];
  if (Array.isArray(result[0])) return result[0] as Record<string, unknown>[];
  return result as Record<string, unknown>[];
}
