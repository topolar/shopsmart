import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  earlyRefreshTriggerSchema,
  type EarlyRefreshTrigger,
} from "@shopsmart/contracts";
import {
  CONNECTOR_MANIFESTS,
  FileSystemRawSnapshotStore,
} from "@shopsmart/connectors";
import {
  createAppDataSource,
  TypeOrmConnectorJobStore,
  TypeOrmSourceIngestionStore,
} from "@shopsmart/database";

import { createConnectorAdapters } from "./connector-adapters.js";
import {
  assertConnectorAdapterConformance,
  collectConnectorHealth,
} from "./connector-runtime.js";

type ConnectorId = (typeof CONNECTOR_MANIFESTS)[number]["connectorId"];

export type ConnectorCliCommand =
  | Readonly<{ kind: "list" }>
  | Readonly<{ kind: "health"; connectorId?: ConnectorId }>
  | Readonly<{ kind: "run"; connectorId: ConnectorId }>
  | Readonly<{
      kind: "reprocess";
      connectorId: ConnectorId;
      sourceScopeKey: string;
    }>
  | Readonly<{
      kind: "repair";
      connectorId: ConnectorId;
      sourceScopeKey: string;
      reason: EarlyRefreshTrigger;
    }>;

const usage =
  "Usage: list | health [--connector <id>] | run --connector <id> | reprocess --connector <id> --scope <scope-key> | repair --connector <id> --scope <scope-key> --reason <early-refresh-trigger>";

export function parseConnectorCliArgs(
  args: readonly string[],
): ConnectorCliCommand {
  const [command, ...flagArgs] = args;
  if (command === "list" && flagArgs.length === 0) return { kind: "list" };
  if (!["health", "run", "reprocess", "repair"].includes(command ?? "")) {
    throw new Error(usage);
  }
  const flags = parseFlags(flagArgs);
  const connectorValue = flags.get("connector");
  if (command === "health" && connectorValue === undefined) {
    if (flags.size !== 0) throw new Error(usage);
    return { kind: "health" };
  }
  const manifest = CONNECTOR_MANIFESTS.find(
    ({ connectorId }) => connectorId === connectorValue,
  );
  if (!manifest) throw new Error(usage);
  const connectorId = manifest.connectorId;
  if (command === "health") {
    if (flags.size !== 1) throw new Error(usage);
    return { kind: "health", connectorId };
  }
  if (command === "run") {
    if (flags.size !== 1) throw new Error(usage);
    return { kind: "run", connectorId };
  }
  const sourceScopeKey = flags.get("scope") ?? "";
  if (!manifest.scopes.some(({ key }) => key === sourceScopeKey)) {
    throw new Error(usage);
  }
  if (command === "reprocess") {
    if (flags.size !== 2) throw new Error(usage);
    return { kind: "reprocess", connectorId, sourceScopeKey };
  }
  if (flags.size !== 3) throw new Error(usage);
  const reason = earlyRefreshTriggerSchema.parse(flags.get("reason"));
  return { kind: "repair", connectorId, sourceScopeKey, reason };
}

function parseFlags(args: readonly string[]): Map<string, string> {
  if (args.length % 2 !== 0) throw new Error(usage);
  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index] ?? "";
    const value = args[index + 1] ?? "";
    if (!flag.startsWith("--") || !value || flags.has(flag.slice(2))) {
      throw new Error(usage);
    }
    const name = flag.slice(2);
    if (!["connector", "scope", "reason"].includes(name)) {
      throw new Error(usage);
    }
    flags.set(name, value);
  }
  return flags;
}

async function main(): Promise<void> {
  const command = parseConnectorCliArgs(process.argv.slice(2));
  if (command.kind === "list") {
    writeJson({
      contractVersion: "1",
      connectors: CONNECTOR_MANIFESTS,
    });
    return;
  }

  const dataSource = createAppDataSource();
  await dataSource.initialize();
  try {
    await dataSource.runMigrations();
    const jobs = new TypeOrmConnectorJobStore(dataSource);
    const ingestion = new TypeOrmSourceIngestionStore(dataSource);
    if (command.kind === "health") {
      const manifests = command.connectorId
        ? CONNECTOR_MANIFESTS.filter(
            ({ connectorId }) => connectorId === command.connectorId,
          )
        : CONNECTOR_MANIFESTS;
      writeJson({
        checkedAt: new Date().toISOString(),
        connectors: await Promise.all(
          manifests.map((manifest) =>
            collectConnectorHealth({ manifest, jobs, ingestion }),
          ),
        ),
      });
      return;
    }
    if (command.kind === "repair") {
      const requestedAt = new Date().toISOString();
      await jobs.requestEarlyRefreshByScope(
        command.sourceScopeKey,
        command.reason,
        requestedAt,
      );
      writeJson({
        status: "repair-requested",
        connectorId: command.connectorId,
        sourceScopeKey: command.sourceScopeKey,
        reason: command.reason,
        requestedAt,
      });
      return;
    }

    const adapters = createConnectorAdapters({
      jobs,
      ingestion,
      rawSnapshotStore,
    });
    assertConnectorAdapterConformance(adapters);
    const adapter = adapters.find(
      ({ manifest }) => manifest.connectorId === command.connectorId,
    );
    if (!adapter) throw new Error("UNKNOWN_CONNECTOR");
    if (command.kind === "run") {
      const now = new Date().toISOString();
      const workerId = `local-${command.connectorId}-${process.pid}`;
      const result = await adapter.run({ now, workerId });
      writeJson({ connectorId: command.connectorId, result });
      process.exitCode = connectorRunExitCode(result);
      return;
    }
    const result = await adapter.reprocess(command.sourceScopeKey);
    writeJson({ connectorId: command.connectorId, result });
  } finally {
    await dataSource.destroy();
  }
}

function rawSnapshotStore(connectorId: ConnectorId) {
  const directory =
    connectorId === "kaufland"
      ? (process.env.SHOPSMART_RAW_SNAPSHOT_DIR ??
        "data/raw-snapshots/kaufland-praha-vypich")
      : connectorId === "albert"
        ? (process.env.SHOPSMART_ALBERT_RAW_SNAPSHOT_DIR ??
          "data/raw-snapshots/albert")
        : (process.env.SHOPSMART_GLOBUS_RAW_SNAPSHOT_DIR ??
          "data/raw-snapshots/globus-brno");
  return new FileSystemRawSnapshotStore(resolve(directory));
}

export function connectorRunExitCode(result: unknown): 0 | 1 {
  if (!result || typeof result !== "object" || !("status" in result)) return 1;
  const successfulStatuses = new Set([
    "completed",
    "not-due",
    "parsed",
    "unchanged",
  ]);
  return typeof result.status === "string" &&
    successfulStatuses.has(result.status)
    ? 0
    : 1;
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;
if (invokedPath === import.meta.url) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Unknown failure"}\n`,
    );
    process.exitCode = 1;
  });
}
