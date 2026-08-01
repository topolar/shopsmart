import { describe, expect, it } from "vitest";

import { parseAlbertCliArgs } from "./albert-cli.js";

describe("Albert operator CLI", () => {
  it("parses run and scoped mapping commands", () => {
    expect(parseAlbertCliArgs(["run-once"])).toEqual({ kind: "run-once" });
    expect(
      parseAlbertCliArgs(["mappings", "list", "--scope", "supermarket"]),
    ).toEqual({ kind: "list-mappings", scope: "supermarket" });
    expect(parseAlbertCliArgs(["mappings", "classes"])).toEqual({
      kind: "list-canonical-classes",
    });
  });

  it("requires an explicit leaflet class and immutable approval metadata", () => {
    expect(() => parseAlbertCliArgs(["mappings", "list"])).toThrow("Usage");
    expect(() =>
      parseAlbertCliArgs([
        "mappings",
        "approve",
        "--candidate",
        "not-a-uuid",
        "--canonical",
        "018f5f70-7b5d-7a21-9f49-01b7f63a9401",
        "--reviewer",
        "operator",
      ]),
    ).toThrow("Usage");
  });
});
