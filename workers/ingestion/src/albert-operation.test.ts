import { describe, expect, it, vi } from "vitest";

import {
  ALBERT_HYPERMARKET_SCOPE,
  ALBERT_SUPERMARKET_SCOPE,
  type AlbertSnapshotResult,
} from "@shopsmart/connectors";

import { runAlbertOperationOnce } from "./albert-operation.js";

describe("local Albert operation", () => {
  it("fetches the index once and fans it out to both due leaflet scopes", async () => {
    const claims = new Map<string, ReturnType<typeof claim>>([
      [ALBERT_SUPERMARKET_SCOPE.key, claim(ALBERT_SUPERMARKET_SCOPE.key)],
      [ALBERT_HYPERMARKET_SCOPE.key, claim(ALBERT_HYPERMARKET_SCOPE.key)],
    ]);
    const jobs = {
      register: vi.fn(async () => undefined),
      claimDue: vi.fn(
        async ({ sourceScopeKey }: { sourceScopeKey: string }) => {
          const value = claims.get(sourceScopeKey);
          return value ? [value] : [];
        },
      ),
      complete: vi.fn(async () => undefined),
      fail: vi.fn(async () => undefined),
    };
    const ingestion = {
      latestRetrieval: vi.fn(async () => null),
      loadApprovedAlbertMappings: vi.fn(async () => []),
      persistAlbert: vi.fn(async () => ({ snapshotId: "snapshot" })),
      markRawDeleted: vi.fn(async () => undefined),
    };
    const rawSnapshots = {
      purgeExpired: vi.fn(async () => []),
      writeBinary: vi.fn(async () => ({
        storageKey: `1785844800000-${"a".repeat(64)}.pdf`,
        absolutePath: "ignored",
      })),
    };
    const fetchResource = vi.fn(async ({ expected }: { expected: string }) =>
      expected === "html"
        ? {
            body: new TextEncoder().encode(syntheticIndex),
            httpStatus: 200,
            etag: '"index"',
            lastModified: null,
            notModified: false,
          }
        : {
            body: new TextEncoder().encode("synthetic PDF"),
            httpStatus: 200,
            etag: '"pdf"',
            lastModified: null,
            notModified: false,
          },
    );
    const processSnapshot = vi.fn(
      async ({
        manifest,
      }: {
        manifest: { kind: "supermarket" | "hypermarket" };
      }) => result(manifest.kind),
    );

    const outcome = await runAlbertOperationOnce({
      now: "2026-08-01T12:00:00.000Z",
      workerId: "test-albert",
      jobs,
      ingestion,
      rawSnapshots,
      fetchResource,
      processSnapshot,
    });

    expect(outcome).toEqual({
      status: "completed",
      scopeCount: 2,
      offerCount: 0,
      quarantineCount: 0,
      deletedRawCount: 0,
    });
    expect(fetchResource).toHaveBeenCalledTimes(3);
    expect(fetchResource.mock.calls[0]?.[0]).toMatchObject({
      url: "https://www.albert.cz/aktualni-letaky",
      expected: "html",
    });
    expect(processSnapshot).toHaveBeenCalledTimes(2);
    expect(rawSnapshots.writeBinary).toHaveBeenCalledTimes(2);
    expect(ingestion.persistAlbert).toHaveBeenCalledTimes(2);
    expect(jobs.complete).toHaveBeenCalledTimes(2);
    expect(jobs.fail).not.toHaveBeenCalled();
  });

  it("does not fetch the index when neither shared scope is due", async () => {
    const fetchResource = vi.fn();
    const outcome = await runAlbertOperationOnce({
      now: "2026-08-01T12:00:00.000Z",
      workerId: "test-albert",
      jobs: {
        register: vi.fn(async () => undefined),
        claimDue: vi.fn(async () => []),
        complete: vi.fn(async () => undefined),
        fail: vi.fn(async () => undefined),
      },
      ingestion: {
        latestRetrieval: vi.fn(async () => null),
        loadApprovedAlbertMappings: vi.fn(async () => []),
        persistAlbert: vi.fn(async () => ({ snapshotId: "snapshot" })),
        markRawDeleted: vi.fn(async () => undefined),
      },
      rawSnapshots: {
        purgeExpired: vi.fn(async () => []),
        writeBinary: vi.fn(),
      },
      fetchResource,
      processSnapshot: vi.fn(),
    });

    expect(outcome).toEqual({ status: "not-due", deletedRawCount: 0 });
    expect(fetchResource).not.toHaveBeenCalled();
  });
});

function claim(sourceScopeKey: string) {
  return {
    id: `job-${sourceScopeKey}`,
    sourceScopeKey,
    leaseOwner: "test-albert",
    previousContentHash: null,
    previousParserVersion: null,
  };
}

function result(kind: "supermarket" | "hypermarket"): AlbertSnapshotResult {
  const scope =
    kind === "supermarket"
      ? ALBERT_SUPERMARKET_SCOPE
      : ALBERT_HYPERMARKET_SCOPE;
  return {
    status: "parsed",
    retrieval: {
      sourceScopeKey: scope.key,
      sourceUrl: `https://view.publitas.com/90263/${kind === "supermarket" ? "3259903" : "3259898"}/pdfs/synthetic.pdf`,
      retrievedAt: "2026-08-01T12:00:00.000Z",
      httpStatus: 200,
      contentHash: "a".repeat(64),
      parserVersion: "albert-leaflet-v1",
      rawDeleteAt: "2026-08-04T12:00:00.000Z",
      etag: '"pdf"',
      lastModified: null,
    },
    retailerProducts: [],
    offers: [],
    quarantines: [],
  };
}

const syntheticIndex = `<!doctype html><html><body>
<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
  props: {
    pageProps: {
      records: [
        {
          __typename: "Leaflet",
          id: "3259903",
          isDefault: true,
          validityStartDateFormatted: "29.07.2026",
          validityEndDateFormatted: "04.08.2026",
          title: "Albert - supermarket",
          locationType: "SUPERMARKET",
          viewUrl: "https://letaky.albert.cz/synthetic-supermarket/",
          downloadUrl:
            "https://view.publitas.com/90263/3259903/pdfs/supermarket.pdf",
          documentType: "LEAFLET",
        },
        {
          __typename: "Leaflet",
          id: "3259898",
          isDefault: true,
          validityStartDateFormatted: "29.07.2026",
          validityEndDateFormatted: "04.08.2026",
          title: "Albert - hypermarket",
          locationType: "HYPERMARKET",
          viewUrl: "https://letaky.albert.cz/synthetic-hypermarket/",
          downloadUrl:
            "https://view.publitas.com/90263/3259898/pdfs/hypermarket.pdf",
          documentType: "LEAFLET",
        },
      ],
    },
  },
})}</script></body></html>`;
