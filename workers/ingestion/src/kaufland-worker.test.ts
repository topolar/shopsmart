import { describe, expect, it, vi } from "vitest";
import { KauflandAccessError } from "@shopsmart/connectors";

import {
  purgeExpiredKauflandSnapshots,
  runClaimedKauflandJob,
} from "./kaufland-worker.js";

const claim = {
  id: "0f3270ab-620d-4ebf-9f19-8efb1009ef1b",
  sourceScopeKey: "kaufland:cz:praha-vypich:3300:physical-offers",
  leaseOwner: "worker-1",
  previousContentHash: null,
  previousParserVersion: null,
};

describe("claimed Kaufland ingestion job", () => {
  it("fetches once, stores the raw snapshot, persists parsed data, and completes coverage", async () => {
    const calls: string[] = [];
    const fetchPage = vi.fn(async () => ({
      html: syntheticStorePage,
      httpStatus: 200,
      etag: '"synthetic"',
      lastModified: null,
      notModified: false,
    }));
    const rawSnapshots = {
      write: vi.fn(async () => {
        calls.push("raw");
        return { storageKey: `${1786154399999}-${"a".repeat(64)}.html` };
      }),
    };
    const ingestion = {
      latestRetrieval: vi.fn(async () => null),
      persist: vi.fn(async () => {
        calls.push("persist");
        return { snapshotId: "7cd01f29-f5a1-461e-b23f-e4de80c26c43" };
      }),
    };
    const jobs = {
      complete: vi.fn(async () => {
        calls.push("complete");
      }),
      fail: vi.fn(),
      recordRateLimit: vi.fn(),
    };

    const outcome = await runClaimedKauflandJob({
      claim,
      workerId: "worker-1",
      retrievedAt: "2026-08-01T12:00:00.000Z",
      productMappings: [
        {
          externalId: "1001",
          canonicalProductClassId: "40c60b15-c214-4603-8862-750c1811460b",
          comparisonUnit: "kilogram",
          variantAttributes: { state: "fresh" },
        },
      ],
      fetchPage,
      rawSnapshots,
      ingestion,
      jobs,
    });

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(rawSnapshots.write).toHaveBeenCalledWith(
      expect.objectContaining({ html: syntheticStorePage }),
    );
    expect(calls).toEqual(["raw", "persist", "complete"]);
    expect(jobs.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: claim.id,
        workerId: "worker-1",
        nextDueAt: "2026-08-02T00:00:00.000Z",
        coverageItems: [
          {
            key: claim.sourceScopeKey,
            status: "fetched",
            candidateCount: 1,
            offerCount: 1,
            quarantineCount: 0,
            reasonCode: null,
          },
        ],
      }),
    );
    expect(outcome.status).toBe("parsed");
  });

  it("uses HTTP validators and records a 304 without writing or reparsing raw content", async () => {
    const hash = "b".repeat(64);
    const fetchPage = vi.fn(async () => ({
      html: null,
      httpStatus: 304,
      etag: '"stable"',
      lastModified: "Fri, 31 Jul 2026 12:00:00 GMT",
      notModified: true,
    }));
    const rawSnapshots = { write: vi.fn() };
    const ingestion = {
      latestRetrieval: vi.fn(async () => ({
        contentHash: hash,
        parserVersion: "kaufland-store-v1",
        etag: '"stable"',
        lastModified: "Fri, 31 Jul 2026 12:00:00 GMT",
      })),
      persist: vi.fn(async () => ({ snapshotId: "snapshot-2" })),
    };
    const jobs = {
      complete: vi.fn(),
      fail: vi.fn(),
      recordRateLimit: vi.fn(),
    };

    const outcome = await runClaimedKauflandJob({
      claim: {
        ...claim,
        previousContentHash: hash,
        previousParserVersion: "kaufland-store-v1",
      },
      workerId: "worker-1",
      retrievedAt: "2026-08-01T12:00:00.000Z",
      productMappings: [],
      fetchPage,
      rawSnapshots,
      ingestion,
      jobs,
    });

    expect(fetchPage).toHaveBeenCalledWith(
      expect.objectContaining({
        etag: '"stable"',
        lastModified: "Fri, 31 Jul 2026 12:00:00 GMT",
      }),
    );
    expect(rawSnapshots.write).not.toHaveBeenCalled();
    expect(ingestion.persist).toHaveBeenCalledWith(
      expect.objectContaining({ status: "unchanged" }),
      { rawStorageKey: null },
    );
    expect(jobs.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        contentHash: hash,
        coverageItems: [
          {
            key: claim.sourceScopeKey,
            status: "unchanged",
            candidateCount: 0,
            offerCount: 0,
            quarantineCount: 0,
            reasonCode: null,
          },
        ],
      }),
    );
    expect(outcome.status).toBe("unchanged");
  });

  it("fails the lease closed when Kaufland returns an access challenge", async () => {
    const jobs = {
      complete: vi.fn(),
      fail: vi.fn(),
      recordRateLimit: vi.fn(),
    };

    await expect(
      runClaimedKauflandJob({
        claim,
        workerId: "worker-1",
        retrievedAt: "2026-08-01T12:00:00.000Z",
        productMappings: [],
        fetchPage: vi.fn(async () => {
          throw new KauflandAccessError(
            "ACCESS_CHALLENGE",
            "Synthetic challenge",
            403,
          );
        }),
        rawSnapshots: { write: vi.fn() },
        ingestion: {
          latestRetrieval: vi.fn(async () => null),
          persist: vi.fn(),
        },
        jobs,
      }),
    ).rejects.toMatchObject({ code: "ACCESS_CHALLENGE" });

    expect(jobs.fail).toHaveBeenCalledWith(
      claim.id,
      "worker-1",
      "ACCESS_CHALLENGE",
      false,
      "2026-08-01T12:00:00.000Z",
    );
    expect(jobs.complete).not.toHaveBeenCalled();
  });

  it("records rate limiting with the source minimum interval", async () => {
    const jobs = {
      complete: vi.fn(),
      fail: vi.fn(),
      recordRateLimit: vi.fn(),
    };

    await expect(
      runClaimedKauflandJob({
        claim,
        workerId: "worker-1",
        retrievedAt: "2026-08-01T12:00:00.000Z",
        productMappings: [],
        fetchPage: vi.fn(async () => {
          throw new KauflandAccessError(
            "RATE_LIMITED",
            "Synthetic rate limit",
            429,
            "2026-08-01T20:00:00.000Z",
          );
        }),
        rawSnapshots: { write: vi.fn() },
        ingestion: {
          latestRetrieval: vi.fn(async () => null),
          persist: vi.fn(),
        },
        jobs,
      }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });

    expect(jobs.recordRateLimit).toHaveBeenCalledWith(
      claim.id,
      "2026-08-01T20:00:00.000Z",
    );
    expect(jobs.fail).not.toHaveBeenCalled();
  });

  it("reconciles expired raw files with snapshot metadata", async () => {
    const rawSnapshots = {
      purgeExpired: vi.fn(async () => ["first.html", "second.html"]),
    };
    const ingestion = { markRawDeleted: vi.fn() };

    const deleted = await purgeExpiredKauflandSnapshots({
      now: "2026-08-04T12:00:00.000Z",
      rawSnapshots,
      ingestion,
    });

    expect(ingestion.markRawDeleted).toHaveBeenCalledWith(
      ["first.html", "second.html"],
      "2026-08-04T12:00:00.000Z",
    );
    expect(deleted).toBe(2);
  });
});

const syntheticStorePage = `<!doctype html>
<html lang="cs">
  <body>
    <main>
      <h1>Kaufland Praha-Vypich</h1>
      <section class="t-tiles-slider">
        <h2>Akční nabídka z aktuálního letáku pro tuto prodejnu</h2>
        <h3>Platí od 29.07.2026 do 04.08.2026</h3>
        <a class="k-product-tile" href="/nabidka/prehled.html?kloffer-articleID=1001">
          <div class="k-product-tile__title">Testovací banány</div>
          <div class="k-product-tile__subtitle">čerstvé</div>
          <div class="k-product-tile__unit-price">1 kg</div>
          <div class="k-product-tile__pricetags-normal">
            <div class="k-price-tag__price">24,90</div>
          </div>
        </a>
      </section>
    </main>
  </body>
</html>`;
