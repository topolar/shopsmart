import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  reprocessStoredKauflandSnapshot,
  runKauflandOperationOnce,
} from "./kaufland-operation.js";

describe("local Kaufland operation", () => {
  it("purges retention, claims only the shared scope, loads approved mappings, and reports aggregates", async () => {
    const claim = {
      id: "20fa6e5d-31b0-4fbe-80ee-299504d18d93",
      sourceScopeKey: "kaufland:cz:praha-vypich:3300:physical-offers",
      leaseOwner: "local-worker",
      previousContentHash: null,
      previousParserVersion: null,
    };
    const jobs = {
      register: vi.fn(),
      claimDue: vi.fn(async () => [claim]),
      complete: vi.fn(),
      fail: vi.fn(),
      recordRateLimit: vi.fn(),
    };
    const ingestion = {
      latestRetrieval: vi.fn(async () => null),
      persist: vi.fn(async () => ({ snapshotId: "snapshot-1" })),
      markRawDeleted: vi.fn(),
      loadApprovedKauflandMappings: vi.fn(async () => [
        {
          externalId: "1001",
          canonicalProductClassId: "40c60b15-c214-4603-8862-750c1811460b",
          comparisonUnit: "kilogram" as const,
          variantAttributes: { preparation: "fresh" },
        },
      ]),
    };
    const rawSnapshots = {
      purgeExpired: vi.fn(async () => []),
      write: vi.fn(async () => ({
        storageKey: `${1785844800000}-${"a".repeat(64)}.html`,
      })),
    };

    const result = await runKauflandOperationOnce({
      now: "2026-08-01T12:00:00.000Z",
      workerId: "local-worker",
      jobs,
      ingestion,
      rawSnapshots,
      fetchPage: vi.fn(async () => ({
        html: syntheticPage,
        httpStatus: 200,
        etag: null,
        lastModified: null,
        notModified: false,
      })),
    });

    expect(jobs.claimDue).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceScopeKey: "kaufland:cz:praha-vypich:3300:physical-offers",
        limit: 1,
      }),
    );
    expect(ingestion.loadApprovedKauflandMappings).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      status: "parsed",
      offerCount: 1,
      quarantineCount: 0,
      deletedRawCount: 0,
    });
  });

  it("reprocesses the newest retained hash-verified HTML without fetching", async () => {
    const contentHash = createHash("sha256")
      .update(syntheticPage)
      .digest("hex");
    const ingestion = {
      latestRetainedRetrieval: vi.fn(async () => ({
        contentHash,
        parserVersion: "kaufland-store-v1",
        etag: '"synthetic"',
        lastModified: null,
        rawStorageKey: `1785844800000-${contentHash}.html`,
        sourceUrl:
          "https://prodejny.kaufland.cz/aktualne/servis/prodejna/praha-vypich-3300.html",
        retrievedAt: "2026-08-01T12:00:00.000Z",
        httpStatus: 200,
      })),
      loadApprovedKauflandMappings: vi.fn(async () => [
        {
          externalId: "1001",
          canonicalProductClassId: "40c60b15-c214-4603-8862-750c1811460b",
          comparisonUnit: "kilogram" as const,
          variantAttributes: { preparation: "fresh" },
        },
      ]),
      persist: vi.fn(async () => ({ snapshotId: "snapshot-2" })),
    };
    const rawSnapshots = { read: vi.fn(async () => syntheticPage) };

    await expect(
      reprocessStoredKauflandSnapshot({ ingestion, rawSnapshots }),
    ).resolves.toEqual({
      status: "reprocessed",
      offerCount: 1,
      quarantineCount: 0,
      contentHash,
    });
    expect(rawSnapshots.read).toHaveBeenCalledWith(
      `1785844800000-${contentHash}.html`,
    );
    expect(ingestion.persist).toHaveBeenCalledWith(
      expect.objectContaining({ offers: [expect.any(Object)] }),
      { rawStorageKey: `1785844800000-${contentHash}.html` },
    );
  });
});

const syntheticPage = `<!doctype html><html lang="cs"><body><main>
  <h1>Kaufland Praha-Vypich</h1>
  <section class="t-tiles-slider">
    <h2>Akční nabídka z aktuálního letáku pro tuto prodejnu</h2>
    <h3>Platí od 29.07.2026 do 04.08.2026</h3>
    <a class="k-product-tile" href="/nabidka/prehled.html?kloffer-articleID=1001">
      <div class="k-product-tile__title">Syntetické banány</div>
      <div class="k-product-tile__unit-price">1 kg</div>
      <div class="k-product-tile__pricetags-normal"><div class="k-price-tag__price">24,90</div></div>
    </a>
  </section>
</main></body></html>`;
