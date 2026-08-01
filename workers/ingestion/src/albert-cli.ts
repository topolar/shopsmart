import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  ALBERT_HYPERMARKET_SCOPE,
  ALBERT_SUPERMARKET_SCOPE,
  FileSystemRawSnapshotStore,
} from "@shopsmart/connectors";
import {
  createAppDataSource,
  TypeOrmConnectorJobStore,
  TypeOrmSourceIngestionStore,
} from "@shopsmart/database";

import {
  reprocessStoredAlbertSnapshot,
  runAlbertOperationOnce,
} from "./albert-operation.js";

type AlbertCliCommand =
  | Readonly<{ kind: "run-once" }>
  | Readonly<{
      kind: "list-mappings";
      scope: "supermarket" | "hypermarket";
    }>
  | Readonly<{
      kind: "reprocess-mappings";
      scope: "supermarket" | "hypermarket";
    }>
  | Readonly<{ kind: "list-canonical-classes" }>
  | Readonly<{
      kind: "approve-mapping";
      candidateId: string;
      canonicalProductClassId: string;
      reviewedBy: string;
      variantAttributes: Record<string, string>;
    }>;

const usage =
  "Usage: run-once | mappings list --scope <supermarket|hypermarket> | mappings reprocess --scope <supermarket|hypermarket> | mappings classes | mappings approve --candidate <uuid> --canonical <uuid> --reviewer <id> [--attributes <json>]";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseAlbertCliArgs(args: readonly string[]): AlbertCliCommand {
  if (args.length === 1 && args[0] === "run-once") {
    return { kind: "run-once" };
  }
  if (args[0] !== "mappings") throw new Error(usage);
  if (args.length === 2 && args[1] === "classes") {
    return { kind: "list-canonical-classes" };
  }
  if (args[1] === "list" || args[1] === "reprocess") {
    const values = parseFlags(args.slice(2), ["scope"]);
    const scope = values.get("scope");
    if (scope !== "supermarket" && scope !== "hypermarket") {
      throw new Error(usage);
    }
    return {
      kind: args[1] === "list" ? "list-mappings" : "reprocess-mappings",
      scope,
    };
  }
  if (args[1] !== "approve") throw new Error(usage);
  const values = parseFlags(args.slice(2), [
    "candidate",
    "canonical",
    "reviewer",
    "attributes",
  ]);
  const candidateId = values.get("candidate") ?? "";
  const canonicalProductClassId = values.get("canonical") ?? "";
  const reviewedBy = values.get("reviewer")?.trim() ?? "";
  if (
    !uuidPattern.test(candidateId) ||
    !uuidPattern.test(canonicalProductClassId) ||
    !reviewedBy ||
    reviewedBy.length > 160
  ) {
    throw new Error(usage);
  }
  return {
    kind: "approve-mapping",
    candidateId,
    canonicalProductClassId,
    reviewedBy,
    variantAttributes: parseAttributes(values.get("attributes") ?? "{}"),
  };
}

async function main(): Promise<void> {
  const command = parseAlbertCliArgs(process.argv.slice(2));
  const dataSource = createAppDataSource();
  await dataSource.initialize();
  try {
    await dataSource.runMigrations();
    const ingestion = new TypeOrmSourceIngestionStore(dataSource);
    const rawDirectory = resolve(
      process.env.SHOPSMART_ALBERT_RAW_SNAPSHOT_DIR ??
        "data/raw-snapshots/albert",
    );
    const rawSnapshots = new FileSystemRawSnapshotStore(rawDirectory);
    if (command.kind === "list-mappings") {
      const candidates = await ingestion.listPendingAlbertMappings(
        command.scope,
      );
      writeJson({
        scope: command.scope,
        pendingCount: candidates.length,
        candidates: candidates.map((candidate) => ({
          id: candidate.id,
          externalId: candidate.externalId,
          exactName: candidate.exactName,
          sourceSnapshotId: candidate.sourceSnapshotId,
          firstSeenAt: candidate.createdAt.toISOString(),
        })),
      });
      return;
    }
    if (command.kind === "list-canonical-classes") {
      const classes = await ingestion.listKauflandCanonicalClasses();
      writeJson({ count: classes.length, classes });
      return;
    }
    if (command.kind === "reprocess-mappings") {
      writeJson(
        await reprocessStoredAlbertSnapshot({
          kind: command.scope,
          ingestion,
          rawSnapshots,
        }),
      );
      return;
    }
    if (command.kind === "approve-mapping") {
      const reviewedAt = new Date().toISOString();
      const approved = await ingestion.approveKauflandMapping({
        ...command,
        reviewedAt,
        allowedSourceScopeKeys: [
          ALBERT_SUPERMARKET_SCOPE.key,
          ALBERT_HYPERMARKET_SCOPE.key,
        ],
      });
      const kind =
        approved.sourceScopeKey === ALBERT_SUPERMARKET_SCOPE.key
          ? "supermarket"
          : "hypermarket";
      const reprocessed = await reprocessStoredAlbertSnapshot({
        kind,
        ingestion,
        rawSnapshots,
      });
      writeJson({
        status: "approved",
        candidateId: command.candidateId,
        canonicalProductClassId: command.canonicalProductClassId,
        reviewedAt,
        reprocessed,
      });
      return;
    }
    const result = await runAlbertOperationOnce({
      now: new Date().toISOString(),
      workerId: `local-albert-${process.pid}`,
      jobs: new TypeOrmConnectorJobStore(dataSource),
      ingestion,
      rawSnapshots,
    });
    writeJson(result);
  } finally {
    await dataSource.destroy();
  }
}

function parseFlags(
  args: readonly string[],
  allowed: readonly string[],
): Map<string, string> {
  if (args.length % 2 !== 0) throw new Error(usage);
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (
      !flag?.startsWith("--") ||
      value === undefined ||
      value.startsWith("--")
    ) {
      throw new Error(usage);
    }
    const name = flag.slice(2);
    if (!allowed.includes(name) || values.has(name)) throw new Error(usage);
    values.set(name, value);
  }
  return values;
}

function parseAttributes(value: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(usage, { cause: error });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(usage);
  }
  if (Object.values(parsed).some((item) => typeof item !== "string")) {
    throw new Error(usage);
  }
  return parsed as Record<string, string>;
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown failure";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
