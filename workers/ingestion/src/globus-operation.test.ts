import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  reprocessStoredGlobusSnapshot,
  runGlobusOperationOnce,
} from "./globus-operation.js";

describe("local Globus operation", () => {
  it("claims one shared scope, persists raw HTML and schedules the next fetch after 12 hours", async () => {
    const jobs = {
      register: vi.fn(),
      claimDue: vi.fn(async () => [claim]),
      complete: vi.fn(),
      fail: vi.fn(),
      recordRateLimit: vi.fn(),
    };
    const ingestion = {
      latestRetrieval: vi.fn(async () => null),
      latestRetainedRetrieval: vi.fn(async () => null),
      loadApprovedGlobusMappings: vi.fn(async () => []),
      persistGlobus: vi.fn(async () => ({ snapshotId: "snapshot-1" })),
      markRawDeleted: vi.fn(),
    };
    const rawSnapshots = {
      purgeExpired: vi.fn(async () => []),
      write: vi.fn(async () => ({
        storageKey: `${1785844800000}-${"a".repeat(64)}.html`,
      })),
      read: vi.fn(),
    };

    const result = await runGlobusOperationOnce({
      now: "2026-08-01T12:00:00.000Z",
      workerId: "local-globus",
      jobs,
      ingestion,
      rawSnapshots,
      fetchPage: vi.fn(async () => ({
        html: syntheticPage,
        httpStatus: 200,
        etag: '"synthetic"',
        lastModified: null,
        notModified: false,
      })),
    });

    expect(result).toEqual({
      status: "parsed",
      offerCount: 0,
      quarantineCount: 1,
      deletedRawCount: 0,
    });
    expect(jobs.claimDue).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceScopeKey: "globus:cz:brno:featured-offers",
        limit: 1,
      }),
    );
    expect(jobs.complete).toHaveBeenCalledWith(
      expect.objectContaining({ nextDueAt: "2026-08-02T00:00:00.000Z" }),
    );
    expect(ingestion.persistGlobus).toHaveBeenCalledTimes(1);
  });

  it("reprocesses a retained hash-verified HTML snapshot without fetching", async () => {
    const hash = createHash("sha256").update(syntheticPage).digest("hex");
    const ingestion = {
      latestRetrieval: vi.fn(async () => null),
      latestRetainedRetrieval: vi.fn(async () => ({
        contentHash: hash,
        parserVersion: "globus-featured-v1",
        etag: null,
        lastModified: null,
        rawStorageKey: `1785844800000-${hash}.html`,
        sourceUrl: "https://www.globus.cz/brno/letaky",
        retrievedAt: "2026-08-01T12:00:00.000Z",
        httpStatus: 200,
      })),
      loadApprovedGlobusMappings: vi.fn(async () => []),
      persistGlobus: vi.fn(async () => ({ snapshotId: "snapshot-2" })),
    };
    const rawSnapshots = { read: vi.fn(async () => syntheticPage) };

    await expect(
      reprocessStoredGlobusSnapshot({ ingestion, rawSnapshots }),
    ).resolves.toEqual({
      status: "reprocessed",
      offerCount: 0,
      quarantineCount: 1,
      contentHash: hash,
    });
    expect(rawSnapshots.read).toHaveBeenCalledTimes(1);
    expect(ingestion.latestRetainedRetrieval).toHaveBeenCalledTimes(1);
    expect(ingestion.persistGlobus).toHaveBeenCalledTimes(1);
  });
});

const claim = {
  id: "20fa6e5d-31b0-4fbe-80ee-299504d18d93",
  sourceScopeKey: "globus:cz:brno:featured-offers",
  leaseOwner: "local-globus",
  previousContentHash: null,
  previousParserVersion: null,
};

const syntheticPage = `<!doctype html><main><section data-featured-offers>
  <h2>Akční nabídka Brno</h2>
  <article data-featured-offer>
    <h3>Testovací mléko</h3><p data-package>1 l</p>
    <p data-unit-price data-price-kind="public">10,00 Kč / l</p>
    <p data-price-kind="public">10,00 Kč</p>
    <p data-validity>Platné do: 4. 8.</p>
  </article>
</section></main>`;
