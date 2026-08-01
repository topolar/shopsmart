import type { AiAssistReviewQueueResponse } from "@shopsmart/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AiAssistReviewQueueView } from "./ai-assist-review";

describe("AiAssistReviewQueueView", () => {
  it("renders model provenance, confidence, cost, evidence spans, and review actions", () => {
    const html = renderToStaticMarkup(
      createElement(AiAssistReviewQueueView, { queue }),
    );

    expect(html).toContain("AI návrhy čekající na kontrolu");
    expect(html).toContain("synthetic-model");
    expect(html).toContain("92 %");
    expect(html).toContain("2 500 μKč");
    expect(html).toContain("canonicalProductClassId: 10–30");
    expect(html).toContain("Schválit");
    expect(html).toContain("Odmítnout");
    expect(html).toContain(
      "Schválení pouze uloží ověřený návrh; samo nikdy nepublikuje nabídku ani upozornění.",
    );
  });

  it("disables approval for a deterministically quarantined proposal", () => {
    const quarantined = {
      items: [
        {
          ...queue.items[0]!,
          reviewStatus: "quarantined" as const,
          validationStatus: "quarantined" as const,
          reasonCodes: ["LOW_CONFIDENCE"],
        },
      ],
    };
    const html = renderToStaticMarkup(
      createElement(AiAssistReviewQueueView, { queue: quarantined }),
    );

    expect(html).toContain("LOW_CONFIDENCE");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Schválit<\/button>/);
  });
});

const queue: AiAssistReviewQueueResponse = {
  items: [
    {
      contractVersion: "1",
      id: "018f5f70-7b5d-7a21-9f49-01b7f63ac001",
      taskKey: "kaufland:mapping:synthetic-1001",
      sourceSnapshotId: "018f5f70-7b5d-7a21-9f49-01b7f63ac002",
      promptVersion: "product-mapping-v1",
      model: {
        provider: "synthetic-provider",
        name: "synthetic-model",
        version: "2026-08-01",
      },
      confidence: 0.92,
      evidenceSpans: [
        {
          field: "canonicalProductClassId",
          start: 10,
          end: 30,
          sourceContentHash: "a".repeat(64),
        },
      ],
      usage: { inputTokens: 400, outputTokens: 120, costMicros: 2_500 },
      payload: {
        kind: "product-mapping",
        mappingCandidateId: "018f5f70-7b5d-7a21-9f49-01b7f63ac003",
        canonicalProductClassId: "a1000000-0000-8000-8000-000000000009",
        variantAttributes: { state: "fresh" },
      },
      reviewStatus: "pending",
      validationStatus: "pending-review",
      reasonCodes: [],
      createdAt: "2026-08-01T12:00:00.000Z",
    },
  ],
};
