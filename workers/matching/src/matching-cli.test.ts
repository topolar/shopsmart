import { describe, expect, it } from "vitest";

import { parseMatchingCliArgs } from "./matching-cli.js";

describe("matching CLI", () => {
  it("accepts only the aggregate run-once command", () => {
    expect(parseMatchingCliArgs(["run-once"])).toBe("run-once");
    expect(() => parseMatchingCliArgs([])).toThrow("Usage: run-once");
    expect(() => parseMatchingCliArgs(["tenant", "abc"])).toThrow(
      "Usage: run-once",
    );
  });
});
