import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const repositoryRoot = resolve(import.meta.dirname, "..");
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for the local smoke test.");
}

const processes: RunningProcess[] = [];

try {
  const api = startProcess(
    "api",
    ["--import", "tsx", "apps/api/src/start.ts"],
    {
      DATABASE_URL: databaseUrl,
      SHOPSMART_API_HOST: "127.0.0.1",
      SHOPSMART_API_PORT: "8310",
    },
  );
  await waitForUrl("http://127.0.0.1:8310/health", api);

  const openApiResponse = await fetch(
    "http://127.0.0.1:8310/api/v1/openapi.json",
  );
  const openApi = (await openApiResponse.json()) as {
    paths?: Record<string, unknown>;
  };
  if (!openApi.paths?.["/api/v1/normalizations"]) {
    throw new Error("Generated OpenAPI is missing the normalization route.");
  }

  const nextBin = resolve(
    repositoryRoot,
    "apps/web/node_modules/next/dist/bin/next",
  );
  const web = startProcess(
    "web",
    [nextBin, "start", "--hostname", "127.0.0.1", "--port", "3310"],
    { SHOPSMART_API_URL: "http://127.0.0.1:8310" },
    resolve(repositoryRoot, "apps/web"),
  );
  const webResponse = await waitForUrl("http://127.0.0.1:3310/", web);

  const normalizationResponse = await fetch(
    "http://127.0.0.1:3310/api/v1/normalizations",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        packagePrice: "49.90",
        currency: "CZK",
        packageQuantity: { amount: "250", unit: "gram" },
        comparisonUnit: "100-gram",
      }),
    },
  );
  const normalization = (await normalizationResponse.json()) as {
    normalizedUnitPrice?: { amount?: string };
  };
  if (
    normalizationResponse.status !== 201 ||
    normalization.normalizedUnitPrice?.amount !== "19.96"
  ) {
    throw new Error("BFF normalization smoke response was invalid.");
  }

  console.log("API_HEALTH=ok");
  console.log("OPENAPI_ROUTE=present");
  console.log(`WEB_STATUS=${webResponse.status}`);
  console.log(
    `BFF_NORMALIZED_AMOUNT=${normalization.normalizedUnitPrice.amount}`,
  );
} finally {
  await Promise.all(processes.map(stopProcess));
}

type RunningProcess = Readonly<{
  name: string;
  process: ChildProcessWithoutNullStreams;
  output: string[];
}>;

function startProcess(
  name: string,
  args: string[],
  extraEnvironment: NodeJS.ProcessEnv,
  workingDirectory = repositoryRoot,
): RunningProcess {
  const child = spawn(process.execPath, args, {
    cwd: workingDirectory,
    env: { ...process.env, ...extraEnvironment },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const output: string[] = [];
  child.stdout.on("data", (chunk: Buffer) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => output.push(chunk.toString()));

  const running = { name, process: child, output };
  processes.push(running);
  return running;
}

async function waitForUrl(
  url: string,
  running: RunningProcess,
): Promise<Response> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (running.process.exitCode !== null) {
      throw new Error(
        `${running.name} exited before becoming ready:\n${running.output.join("")}`,
      );
    }

    try {
      const response = await fetch(url);
      if (response.ok) {
        return response;
      }
    } catch {
      // The process is still starting.
    }

    await delay(500);
  }

  throw new Error(
    `${running.name} did not become ready:\n${running.output.join("")}`,
  );
}

async function stopProcess(running: RunningProcess): Promise<void> {
  if (running.process.exitCode !== null) {
    return;
  }

  running.process.kill();
  await Promise.race([
    new Promise<void>((resolveExit) => {
      running.process.once("exit", () => resolveExit());
    }),
    delay(5_000).then(() => {
      if (running.process.exitCode === null) {
        running.process.kill("SIGKILL");
      }
    }),
  ]);
}
