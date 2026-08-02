import { describe, expect, it } from "vitest";

import {
  connectorRunExitCode,
  parseConnectorCliArgs,
} from "./connector-cli.js";

describe("shared connector CLI", () => {
  it("parses list, run, health, reprocess, and audited repair commands", () => {
    expect(parseConnectorCliArgs(["list"])).toEqual({ kind: "list" });
    expect(parseConnectorCliArgs(["run", "--connector", "kaufland"])).toEqual({
      kind: "run",
      connectorId: "kaufland",
    });
    expect(parseConnectorCliArgs(["health"])).toEqual({ kind: "health" });
    expect(parseConnectorCliArgs(["health", "--connector", "albert"])).toEqual({
      kind: "health",
      connectorId: "albert",
    });
    expect(
      parseConnectorCliArgs([
        "reprocess",
        "--connector",
        "albert",
        "--scope",
        "albert:cz:supermarket:physical-leaflet",
      ]),
    ).toEqual({
      kind: "reprocess",
      connectorId: "albert",
      sourceScopeKey: "albert:cz:supermarket:physical-leaflet",
    });
    expect(
      parseConnectorCliArgs([
        "repair",
        "--connector",
        "globus",
        "--scope",
        "globus:cz:brno:featured-offers",
        "--reason",
        "explicit-request",
      ]),
    ).toEqual({
      kind: "repair",
      connectorId: "globus",
      sourceScopeKey: "globus:cz:brno:featured-offers",
      reason: "explicit-request",
    });
  });

  it("rejects unknown connectors and scopes outside their manifest", () => {
    expect(() =>
      parseConnectorCliArgs(["run", "--connector", "unknown"]),
    ).toThrow();
    expect(() =>
      parseConnectorCliArgs([
        "reprocess",
        "--connector",
        "kaufland",
        "--scope",
        "globus:cz:brno:featured-offers",
      ]),
    ).toThrow();
  });

  it("fails monitoring on partial or quarantined coverage", () => {
    expect(connectorRunExitCode({ status: "partial" })).toBe(1);
    expect(connectorRunExitCode({ status: "quarantined" })).toBe(1);
    expect(connectorRunExitCode({ status: "parsed" })).toBe(0);
    expect(connectorRunExitCode({ status: "unchanged" })).toBe(0);
    expect(connectorRunExitCode({ status: "completed" })).toBe(0);
    expect(connectorRunExitCode({ status: "not-due" })).toBe(0);
  });
});
