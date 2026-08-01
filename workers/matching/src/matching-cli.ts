import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  createAppDataSource,
  TypeOrmMatchingFanOutStore,
} from "@shopsmart/database";

import { runMatchingFanOut } from "./matching-operation.js";

export function parseMatchingCliArgs(args: readonly string[]): "run-once" {
  if (args.length === 1 && args[0] === "run-once") return "run-once";
  throw new Error("Usage: run-once");
}

async function main(): Promise<void> {
  parseMatchingCliArgs(process.argv.slice(2));
  const dataSource = createAppDataSource();
  await dataSource.initialize();
  try {
    await dataSource.runMigrations();
    const result = await runMatchingFanOut(
      new TypeOrmMatchingFanOutStore(dataSource),
      new Date().toISOString(),
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
