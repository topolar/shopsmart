import type { NotificationDigestPayload } from "@shopsmart/contracts";
import { InvalidDigestFactsError } from "@shopsmart/domain";
import { describe, expect, it, vi } from "vitest";

import {
  runDigestPlanning,
  type DigestPlanningStore,
} from "./digest-planning.js";

const tenants = {
  eligible: "018f5f70-7b5d-7a21-9f49-01b7f63a9701",
  missing: "018f5f70-7b5d-7a21-9f49-01b7f63a9702",
  ambiguous: "018f5f70-7b5d-7a21-9f49-01b7f63a9703",
};

describe("runDigestPlanning", () => {
  it("renders and enqueues one aggregate while counting ambiguous recipients", async () => {
    const store: DigestPlanningStore = {
      listCandidates: vi
        .fn()
        .mockResolvedValue([
          candidate(tenants.eligible, ["eligible@example.invalid"]),
          candidate(tenants.missing, []),
          candidate(tenants.ambiguous, [
            "first@example.invalid",
            "second@example.invalid",
          ]),
        ]),
      enqueue: vi.fn().mockResolvedValue(true),
    };
    const payload = digest(tenants.eligible);
    const render = vi.fn().mockReturnValue(payload);

    await expect(
      runDigestPlanning(store, "2026-08-01", render),
    ).resolves.toEqual({
      intervalKey: "2026-08-01",
      candidateTenantCount: 3,
      candidateFactCount: 3,
      enqueuedCount: 1,
      silentCount: 0,
      skippedCounts: { MISSING_RECIPIENT: 1, AMBIGUOUS_RECIPIENT: 1 },
    });
    expect(render).toHaveBeenCalledOnce();
    expect(store.enqueue).toHaveBeenCalledWith(
      "eligible@example.invalid",
      payload,
    );
  });

  it("fails closed and counts invalid persisted facts", async () => {
    const store: DigestPlanningStore = {
      listCandidates: vi
        .fn()
        .mockResolvedValue([
          candidate(tenants.eligible, ["a@example.invalid"]),
        ]),
      enqueue: vi.fn(),
    };
    const render = vi.fn(() => {
      throw new InvalidDigestFactsError("invalid synthetic facts");
    });

    await expect(
      runDigestPlanning(store, "2026-08-01", render),
    ).resolves.toMatchObject({
      enqueuedCount: 0,
      skippedCounts: { INVALID_FACTS: 1 },
    });
    expect(store.enqueue).not.toHaveBeenCalled();
  });

  it("reports a valid but already-covered interval as silent", async () => {
    const store: DigestPlanningStore = {
      listCandidates: vi
        .fn()
        .mockResolvedValue([
          candidate(tenants.eligible, ["a@example.invalid"]),
        ]),
      enqueue: vi.fn().mockResolvedValue(false),
    };

    await expect(
      runDigestPlanning(store, "2026-08-01", () => digest(tenants.eligible)),
    ).resolves.toMatchObject({ enqueuedCount: 0, silentCount: 1 });
  });
});

function candidate(tenantId: string, recipientEmails: readonly string[]) {
  return { tenantId, recipientEmails, facts: [{ match: {}, offer: {} }] };
}

function digest(tenantId: string): NotificationDigestPayload {
  return {
    contractVersion: "1",
    tenantId,
    intervalKey: "2026-08-01",
    locale: "cs",
    groups: [
      {
        canonicalProductClassId: "018f5f70-7b5d-7a21-9f49-01b7f63a9710",
        currency: "CZK",
        comparisonUnit: "piece",
        offers: [
          {
            matchId: "a".repeat(64),
            watchRuleId: "018f5f70-7b5d-7a21-9f49-01b7f63a9711",
            offerId: "018f5f70-7b5d-7a21-9f49-01b7f63a9712",
            noveltyKey: `offer-novelty:v1:${"b".repeat(64)}`,
            retailer: {
              id: "018f5f70-7b5d-7a21-9f49-01b7f63a9713",
              name: "Synthetic Retailer",
            },
            exactName: "Synthetic cucumber",
            variantAttributes: { state: "fresh" },
            package: {
              declared: "1 pc",
              quantity: { amount: "1", unit: "piece" },
              count: 1,
            },
            price: { amount: "19.90", currency: "CZK" },
            regularPrice: null,
            discountPercent: null,
            normalizedUnitPrice: {
              amount: "19.90",
              currency: "CZK",
              unit: "piece",
            },
            membership: { kind: "none" },
            locality: {
              kind: "physical",
              storeId: "018f5f70-7b5d-7a21-9f49-01b7f63a9714",
              applicability: "national",
            },
            availability: {
              kind: "physical",
              evidence: "flyer-applicability",
              stockStatus: "not-asserted",
            },
            validity: {
              validFrom: "2026-07-29T00:00:00.000Z",
              validTo: "2026-08-04T21:59:59.999Z",
            },
            thresholdReason: {
              scope: "fallback",
              predicate: "max-unit-price",
              actual: "19.90",
              limit: "25.00",
            },
            sourceUrl: "https://retailer.example.invalid/offers/cucumber",
            retrievedAt: "2026-08-01T10:00:00.000Z",
            evidenceLevel: "official",
          },
        ],
      },
    ],
  };
}
