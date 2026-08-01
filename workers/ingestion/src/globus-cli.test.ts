import { describe, expect, it } from "vitest";

import { parseGlobusCliArgs } from "./globus-cli.js";

describe("Globus operator CLI", () => {
  it("parses run, review and retained-snapshot commands", () => {
    expect(parseGlobusCliArgs(["run-once"])).toEqual({ kind: "run-once" });
    expect(parseGlobusCliArgs(["mappings", "list"])).toEqual({
      kind: "list-mappings",
    });
    expect(parseGlobusCliArgs(["mappings", "reprocess"])).toEqual({
      kind: "reprocess-mappings",
    });
    expect(parseGlobusCliArgs(["mappings", "classes"])).toEqual({
      kind: "list-canonical-classes",
    });
  });

  it("requires explicit mapping approval metadata", () => {
    expect(
      parseGlobusCliArgs([
        "mappings",
        "approve",
        "--candidate",
        "20fa6e5d-31b0-4fbe-80ee-299504d18d93",
        "--canonical",
        "40c60b15-c214-4603-8862-750c1811460b",
        "--reviewer",
        "local-operator",
        "--attributes",
        '{"preparation":"fresh"}',
      ]),
    ).toEqual({
      kind: "approve-mapping",
      candidateId: "20fa6e5d-31b0-4fbe-80ee-299504d18d93",
      canonicalProductClassId: "40c60b15-c214-4603-8862-750c1811460b",
      reviewedBy: "local-operator",
      variantAttributes: { preparation: "fresh" },
    });
  });
});
