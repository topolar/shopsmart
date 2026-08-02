import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("Next.js root environment loading", () => {
  it("loads the root .env during build so NEXT_PUBLIC Firebase config is embedded", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("./package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.build).toBe("node load-root-env.mjs build");
  });
});
