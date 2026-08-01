import { describe, expect, it } from "vitest";

import { parseDigestCliArgs } from "./digest-cli.js";

describe("digest planning CLI", () => {
  it("requires one explicit stable interval key", () => {
    expect(
      parseDigestCliArgs(["run-once", "--interval", "2026-08-01"]),
    ).toEqual({ intervalKey: "2026-08-01" });
    expect(() => parseDigestCliArgs(["run-once"])).toThrow(
      "Usage: run-once --interval <stable-key>",
    );
  });
});
