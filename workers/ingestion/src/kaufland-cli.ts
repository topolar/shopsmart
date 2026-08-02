import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  FileSystemRawSnapshotStore,
  KAUFLAND_PRAHA_VYPICH_SCOPE,
} from "@shopsmart/connectors";
import {
  createAppDataSource,
  TypeOrmConnectorJobStore,
  TypeOrmSourceIngestionStore,
} from "@shopsmart/database";

import {
  reprocessStoredKauflandSnapshot,
  runKauflandOperationOnce,
} from "./kaufland-operation.js";

type KauflandCliCommand =
  | Readonly<{ kind: "run-once" }>
  | Readonly<{ kind: "list-mappings" }>
  | Readonly<{ kind: "reprocess-mappings" }>
  | Readonly<{ kind: "list-canonical-classes" }>
  | Readonly<{
      kind: "approve-mapping";
      candidateId: string;
      canonicalProductClassId: string;
      reviewedBy: string;
      variantAttributes: Record<string, string>;
    }>;

const usage =
  "Usage: run-once | mappings list | mappings reprocess | mappings classes | mappings approve --candidate <uuid> --canonical <uuid> --reviewer <id> [--attribute <key=value> ... | --attributes <json>]";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseKauflandCliArgs(
  args: readonly string[],
): KauflandCliCommand {
  if (args.length === 1 && args[0] === "run-once") {
    return { kind: "run-once" };
  }
  if (args.length === 2 && args[0] === "mappings" && args[1] === "list") {
    return { kind: "list-mappings" };
  }
  if (args.length === 2 && args[0] === "mappings" && args[1] === "classes") {
    return { kind: "list-canonical-classes" };
  }
  if (args.length === 2 && args[0] === "mappings" && args[1] === "reprocess") {
    return { kind: "reprocess-mappings" };
  }
  if (args[0] !== "mappings" || args[1] !== "approve") {
    throw new Error(usage);
  }
  const { values, attributeValues } = parseFlags(args.slice(2));
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
  if (attributeValues.length > 0 && values.has("attributes")) {
    throw new Error(usage);
  }
  const variantAttributes =
    attributeValues.length > 0
      ? parseAttributeValues(attributeValues)
      : parseAttributes(values.get("attributes") ?? "{}");
  return {
    kind: "approve-mapping",
    candidateId,
    canonicalProductClassId,
    reviewedBy,
    variantAttributes,
  };
}

async function main(): Promise<void> {
  const command = parseKauflandCliArgs(process.argv.slice(2));
  const dataSource = createAppDataSource();
  await dataSource.initialize();
  try {
    await dataSource.runMigrations();
    const ingestion = new TypeOrmSourceIngestionStore(dataSource);
    const rawDirectory = resolve(
      process.env.SHOPSMART_RAW_SNAPSHOT_DIR ??
        "data/raw-snapshots/kaufland-praha-vypich",
    );
    const rawSnapshots = new FileSystemRawSnapshotStore(rawDirectory);
    if (command.kind === "list-mappings") {
      const candidates = await ingestion.listPendingKauflandMappings();
      writeJson({
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
        await reprocessStoredKauflandSnapshot({ ingestion, rawSnapshots }),
      );
      return;
    }
    if (command.kind === "approve-mapping") {
      const reviewedAt = new Date().toISOString();
      await ingestion.approveKauflandMapping({
        ...command,
        reviewedAt,
        allowedSourceScopeKeys: [KAUFLAND_PRAHA_VYPICH_SCOPE.key],
      });
      const reprocessed = await reprocessStoredKauflandSnapshot({
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
    const result = await runKauflandOperationOnce({
      now: new Date().toISOString(),
      workerId: `local-kaufland-${process.pid}`,
      jobs: new TypeOrmConnectorJobStore(dataSource),
      ingestion,
      rawSnapshots,
    });
    writeJson(result);
  } finally {
    await dataSource.destroy();
  }
}

function parseFlags(args: readonly string[]): Readonly<{
  values: Map<string, string>;
  attributeValues: string[];
}> {
  if (args.length % 2 !== 0) throw new Error(usage);
  const values = new Map<string, string>();
  const attributeValues: string[] = [];
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
    if (name === "attribute") {
      attributeValues.push(value);
      continue;
    }
    if (
      !["candidate", "canonical", "reviewer", "attributes"].includes(name) ||
      values.has(name)
    ) {
      throw new Error(usage);
    }
    values.set(name, value);
  }
  return { values, attributeValues };
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
  const attributes = parsed as Record<string, unknown>;
  if (
    Object.entries(attributes).some(
      ([key, item]) => typeof item !== "string" || !isValidAttribute(key, item),
    )
  ) {
    throw new Error(usage);
  }
  return attributes as Record<string, string>;
}

function parseAttributeValues(
  values: readonly string[],
): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const value of values) {
    const separator = value.indexOf("=");
    if (separator <= 0) throw new Error(usage);
    const key = value.slice(0, separator).trim();
    const attributeValue = value.slice(separator + 1).trim();
    if (
      Object.hasOwn(attributes, key) ||
      !isValidAttribute(key, attributeValue)
    ) {
      throw new Error(usage);
    }
    attributes[key] = attributeValue;
  }
  return attributes;
}

function isValidAttribute(key: string, value: string): boolean {
  return (
    key.length > 0 &&
    key.length <= 120 &&
    value.length > 0 &&
    value.length <= 240
  );
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
