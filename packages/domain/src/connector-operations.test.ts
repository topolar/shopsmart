import { describe, expect, it } from "vitest";

import {
  calculateConnectorRetryAt,
  decideStaticContextRefresh,
  summarizeCoverageManifest,
} from "./connector-operations.js";

describe("connector operating policy", () => {
  it("reuses fresh static context but refreshes dynamic facts and explicit early triggers", () => {
    const now = "2026-08-01T12:00:00.000Z";
    const expiresAt = "2026-08-02T12:00:00.000Z";

    expect(
      decideStaticContextRefresh({ kind: "static", now, expiresAt }),
    ).toEqual({ refresh: false, reason: "FRESH_TTL" });
    expect(
      decideStaticContextRefresh({ kind: "dynamic", now, expiresAt }),
    ).toEqual({ refresh: true, reason: "DYNAMIC_FACT" });
    expect(
      decideStaticContextRefresh({
        kind: "static",
        now,
        expiresAt,
        trigger: "broken-url",
      }),
    ).toEqual({ refresh: true, reason: "EARLY_BROKEN_URL" });
  });

  it("uses deterministic capped exponential retry delays", () => {
    const failedAt = "2026-08-01T12:00:00.000Z";
    expect(calculateConnectorRetryAt(failedAt, 1)).toBe(
      "2026-08-01T12:01:00.000Z",
    );
    expect(calculateConnectorRetryAt(failedAt, 3)).toBe(
      "2026-08-01T12:04:00.000Z",
    );
    expect(calculateConnectorRetryAt(failedAt, 20)).toBe(
      "2026-08-01T13:00:00.000Z",
    );
  });

  it("requires an explicit result for every expected coverage item", () => {
    expect(
      summarizeCoverageManifest(
        ["official-feed", "store-registry"],
        [
          { key: "official-feed", status: "unchanged", candidateCount: 0 },
          { key: "store-registry", status: "fetched", candidateCount: 4 },
        ],
      ),
    ).toEqual({
      complete: true,
      successful: true,
      missingKeys: [],
      unexpectedKeys: [],
    });

    expect(
      summarizeCoverageManifest(
        ["official-feed", "store-registry"],
        [{ key: "official-feed", status: "error", candidateCount: 0 }],
      ),
    ).toEqual({
      complete: false,
      successful: false,
      missingKeys: ["store-registry"],
      unexpectedKeys: [],
    });
  });
});
