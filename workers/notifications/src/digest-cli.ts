import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  createAppDataSource,
  TypeOrmDigestPlanningStore,
} from "@shopsmart/database";

import { runDigestPlanning } from "./digest-planning.js";

const usage = "Usage: run-once --interval <stable-key>";

export function parseDigestCliArgs(
  args: readonly string[],
): Readonly<{ intervalKey: string }> {
  if (
    args.length !== 3 ||
    args[0] !== "run-once" ||
    args[1] !== "--interval" ||
    !args[2]?.trim() ||
    args[2].trim() !== args[2] ||
    args[2].length > 160
  ) {
    throw new Error(usage);
  }
  return { intervalKey: args[2] };
}

async function main(): Promise<void> {
  const { intervalKey } = parseDigestCliArgs(process.argv.slice(2));
  const dataSource = createAppDataSource();
  await dataSource.initialize();
  try {
    await dataSource.runMigrations();
    const result = await runDigestPlanning(
      new TypeOrmDigestPlanningStore(dataSource),
      intervalKey,
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await dataSource.destroy();
  }
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
