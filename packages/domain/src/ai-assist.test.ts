import { describe, expect, it } from "vitest";

import {
  buildAiAssistCacheKey,
  InvalidAiAssistProposalError,
  validateAiAssistCandidate,
} from "./ai-assist.js";

const sourceHash = "a".repeat(64);
const mappingCandidateId = "018f5f70-7b5d-7a21-9f49-01b7f63aa001";
const canonicalProductClassId = "a1000000-0000-8000-8000-000000000009";

describe("bounded AI-assist validation", () => {
  it("accepts a schema-valid evidenced product mapping only as pending review", () => {
    const result = validateAiAssistCandidate(mappingProposal(), {
      sourceContentHash: sourceHash,
      sourceLength: 200,
      mappingCandidateId,
      allowedCanonicalProductClassIds: [canonicalProductClassId],
      allowedStoreIds: [],
      sourceUrl:
        "https://prodejny.kaufland.cz/aktualne/servis/prodejna/praha-vypich-3300.html",
      budget: {
        maxInputTokens: 2_000,
        maxOutputTokens: 500,
        maxCostMicros: 20_000,
      },
      minimumConfidence: 0.8,
      taskKind: "product-mapping",
    });

    expect(result).toEqual({
      status: "pending-review",
      proposal: expect.objectContaining({
        contractVersion: "1",
        reviewStatus: "pending",
        payload: expect.objectContaining({ kind: "product-mapping" }),
      }),
      reasonCodes: [],
    });
    expect(buildAiAssistCacheKey(result.proposal)).toMatch(
      /^ai-assist:v1:[a-f0-9]{64}$/,
    );
  });

  it("quarantines low-confidence, over-budget, or unsupported mappings", () => {
    const proposal = mappingProposal({
      confidence: 0.4,
      usage: { inputTokens: 2_500, outputTokens: 600, costMicros: 30_000 },
      payload: {
        kind: "product-mapping",
        mappingCandidateId,
        canonicalProductClassId: "a1000000-0000-8000-8000-000000000008",
        variantAttributes: { state: "fresh" },
      },
    });
    const result = validateAiAssistCandidate(proposal, {
      sourceContentHash: sourceHash,
      sourceLength: 200,
      mappingCandidateId,
      allowedCanonicalProductClassIds: [canonicalProductClassId],
      allowedStoreIds: [],
      sourceUrl:
        "https://prodejny.kaufland.cz/aktualne/servis/prodejna/praha-vypich-3300.html",
      budget: {
        maxInputTokens: 2_000,
        maxOutputTokens: 500,
        maxCostMicros: 20_000,
      },
      minimumConfidence: 0.8,
      taskKind: "product-mapping",
    });

    expect(result.status).toBe("quarantined");
    expect(result.reasonCodes).toEqual([
      "BUDGET_EXCEEDED",
      "LOW_CONFIDENCE",
      "CANONICAL_CLASS_NOT_ALLOWED",
    ]);
  });

  it("quarantines evidence spans that do not prove the proposed fields", () => {
    const proposal = mappingProposal({
      evidenceSpans: [
        {
          field: "canonicalProductClassId",
          start: 150,
          end: 250,
          sourceContentHash: "b".repeat(64),
        },
      ],
    });
    const result = validateAiAssistCandidate(proposal, {
      sourceContentHash: sourceHash,
      sourceLength: 200,
      mappingCandidateId,
      allowedCanonicalProductClassIds: [canonicalProductClassId],
      allowedStoreIds: [],
      sourceUrl:
        "https://prodejny.kaufland.cz/aktualne/servis/prodejna/praha-vypich-3300.html",
      budget: {
        maxInputTokens: 2_000,
        maxOutputTokens: 500,
        maxCostMicros: 20_000,
      },
      minimumConfidence: 0.8,
      taskKind: "product-mapping",
    });

    expect(result.status).toBe("quarantined");
    expect(result.reasonCodes).toEqual([
      "EVIDENCE_HASH_MISMATCH",
      "EVIDENCE_SPAN_OUT_OF_RANGE",
      "MISSING_FIELD_EVIDENCE",
    ]);
  });

  it("keeps extracted flyer facts candidate-only and rejects wrong source locality", () => {
    const result = validateAiAssistCandidate(flyerProposal(), {
      sourceContentHash: sourceHash,
      sourceLength: 500,
      mappingCandidateId: null,
      allowedCanonicalProductClassIds: [],
      allowedStoreIds: ["018f5f70-7b5d-7a21-9f49-01b7f63aa004"],
      sourceUrl: "https://retailer.example.invalid/flyer/approved",
      budget: {
        maxInputTokens: 2_000,
        maxOutputTokens: 500,
        maxCostMicros: 20_000,
      },
      minimumConfidence: 0.8,
      taskKind: "flyer-extraction",
    });

    expect(result.status).toBe("quarantined");
    expect(result.reasonCodes).toEqual([
      "SOURCE_URL_MISMATCH",
      "STORE_NOT_ALLOWED",
    ]);
    expect(result.proposal.reviewStatus).toBe("quarantined");
  });

  it("rejects an extracted flyer price that cannot be normalized", () => {
    const proposal = flyerProposal({
      payload: {
        ...flyerProposal().payload,
        sourceUrl: "https://retailer.example.invalid/flyer/approved",
        storeId: "018f5f70-7b5d-7a21-9f49-01b7f63aa004",
        price: { amount: "0.00", currency: "CZK" },
      },
    });
    expect(() =>
      validateAiAssistCandidate(proposal, {
        sourceContentHash: sourceHash,
        sourceLength: 500,
        mappingCandidateId: null,
        allowedCanonicalProductClassIds: [],
        allowedStoreIds: ["018f5f70-7b5d-7a21-9f49-01b7f63aa004"],
        sourceUrl: "https://retailer.example.invalid/flyer/approved",
        budget: {
          maxInputTokens: 2_000,
          maxOutputTokens: 500,
          maxCostMicros: 20_000,
        },
        minimumConfidence: 0.8,
        taskKind: "flyer-extraction",
      }),
    ).toThrow(InvalidAiAssistProposalError);
  });

  it("quarantines output from a different task kind", () => {
    const proposal = flyerProposal({
      payload: {
        ...flyerProposal().payload,
        sourceUrl: "https://retailer.example.invalid/flyer/approved",
        storeId: "018f5f70-7b5d-7a21-9f49-01b7f63aa004",
      },
    });
    const result = validateAiAssistCandidate(proposal, {
      sourceContentHash: sourceHash,
      sourceLength: 500,
      mappingCandidateId,
      allowedCanonicalProductClassIds: [canonicalProductClassId],
      allowedStoreIds: ["018f5f70-7b5d-7a21-9f49-01b7f63aa004"],
      sourceUrl: "https://retailer.example.invalid/flyer/approved",
      budget: {
        maxInputTokens: 2_000,
        maxOutputTokens: 500,
        maxCostMicros: 20_000,
      },
      minimumConfidence: 0.8,
      taskKind: "product-mapping",
    });

    expect(result.status).toBe("quarantined");
    expect(result.reasonCodes).toEqual(["TASK_KIND_MISMATCH"]);
  });
});

function mappingProposal(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: "1",
    id: "018f5f70-7b5d-7a21-9f49-01b7f63aa002",
    taskKey: "kaufland:mapping:synthetic-1001",
    sourceSnapshotId: "018f5f70-7b5d-7a21-9f49-01b7f63aa003",
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
        sourceContentHash: sourceHash,
      },
      {
        field: "variantAttributes.state",
        start: 31,
        end: 45,
        sourceContentHash: sourceHash,
      },
    ],
    usage: { inputTokens: 400, outputTokens: 120, costMicros: 2_500 },
    payload: {
      kind: "product-mapping",
      mappingCandidateId,
      canonicalProductClassId,
      variantAttributes: { state: "fresh" },
    },
    createdAt: "2026-08-01T12:00:00.000Z",
    ...overrides,
  };
}

function flyerProposal(overrides: Record<string, unknown> = {}) {
  const requiredFields = [
    "sourceUrl",
    "storeId",
    "exactName",
    "package.declared",
    "price.amount",
    "validity.validFrom",
    "validity.validTo",
  ];
  return {
    contractVersion: "1",
    id: "018f5f70-7b5d-7a21-9f49-01b7f63aa005",
    taskKey: "synthetic:flyer:offer-1",
    sourceSnapshotId: "018f5f70-7b5d-7a21-9f49-01b7f63aa003",
    promptVersion: "flyer-extraction-v1",
    model: {
      provider: "synthetic-provider",
      name: "synthetic-model",
      version: "2026-08-01",
    },
    confidence: 0.9,
    evidenceSpans: requiredFields.map((field, index) => ({
      field,
      start: index * 10,
      end: index * 10 + 8,
      sourceContentHash: sourceHash,
    })),
    usage: { inputTokens: 600, outputTokens: 180, costMicros: 4_000 },
    payload: {
      kind: "flyer-extraction",
      sourceUrl: "https://retailer.example.invalid/flyer/wrong",
      storeId: "018f5f70-7b5d-7a21-9f49-01b7f63aa006",
      exactName: "Synthetic fresh bananas",
      package: {
        declared: "1 kg",
        quantity: { amount: "1", unit: "kilogram" },
        count: 1,
      },
      price: { amount: "24.90", currency: "CZK" },
      membership: { kind: "none" },
      validity: {
        validFrom: "2026-08-01T00:00:00.000Z",
        validTo: "2026-08-07T23:59:59.999Z",
      },
    },
    createdAt: "2026-08-01T12:00:00.000Z",
    ...overrides,
  };
}
