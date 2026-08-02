import { describe, expect, it } from "vitest";

import { parseKauflandCliArgs } from "./kaufland-cli.js";

describe("Kaufland operator CLI", () => {
  it("parses run-once and pending mapping commands", () => {
    expect(parseKauflandCliArgs(["run-once"])).toEqual({ kind: "run-once" });
    expect(parseKauflandCliArgs(["mappings", "list"])).toEqual({
      kind: "list-mappings",
    });
    expect(parseKauflandCliArgs(["mappings", "classes"])).toEqual({
      kind: "list-canonical-classes",
    });
    expect(parseKauflandCliArgs(["mappings", "reprocess"])).toEqual({
      kind: "reprocess-mappings",
    });
  });

  it("requires explicit bounded approval fields and JSON attributes", () => {
    expect(
      parseKauflandCliArgs([
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
    expect(() =>
      parseKauflandCliArgs([
        "mappings",
        "approve",
        "--candidate",
        "not-a-uuid",
      ]),
    ).toThrow("Usage");
  });

  it("accepts repeatable PowerShell-safe key=value attributes", () => {
    expect(
      parseKauflandCliArgs([
        "mappings",
        "approve",
        "--candidate",
        "20fa6e5d-31b0-4fbe-80ee-299504d18d93",
        "--canonical",
        "40c60b15-c214-4603-8862-750c1811460b",
        "--reviewer",
        "local-operator",
        "--attribute",
        "state=fresh",
        "--attribute",
        "cut=breast-fillet",
      ]),
    ).toEqual({
      kind: "approve-mapping",
      candidateId: "20fa6e5d-31b0-4fbe-80ee-299504d18d93",
      canonicalProductClassId: "40c60b15-c214-4603-8862-750c1811460b",
      reviewedBy: "local-operator",
      variantAttributes: { state: "fresh", cut: "breast-fillet" },
    });

    const base = [
      "mappings",
      "approve",
      "--candidate",
      "20fa6e5d-31b0-4fbe-80ee-299504d18d93",
      "--canonical",
      "40c60b15-c214-4603-8862-750c1811460b",
      "--reviewer",
      "local-operator",
    ];
    expect(() =>
      parseKauflandCliArgs([
        ...base,
        "--attribute",
        "state=fresh",
        "--attributes",
        '{"state":"fresh"}',
      ]),
    ).toThrow("Usage");
    expect(() =>
      parseKauflandCliArgs([
        ...base,
        "--attribute",
        "state=fresh",
        "--attribute",
        "state=frozen",
      ]),
    ).toThrow("Usage");
    expect(() =>
      parseKauflandCliArgs([...base, "--attribute", "missing-separator"]),
    ).toThrow("Usage");
  });
});
