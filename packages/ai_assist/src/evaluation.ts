import type { AiAssistProposal } from "@shopsmart/contracts";
import {
  validateAiAssistCandidate,
  type AiAssistQuarantineReason,
  type AiAssistValidationContext,
} from "@shopsmart/domain";

type EvaluationFixture = Readonly<{
  name: string;
  proposal: AiAssistProposal;
  context: AiAssistValidationContext;
  expectedStatus: "pending-review" | "quarantined";
  expectedReasonCodes: readonly AiAssistQuarantineReason[];
}>;

const sourceHash = "d".repeat(64);
const mappingCandidateId = "018f5f70-7b5d-7a21-9f49-01b7f63ad001";
const canonicalId = "a1000000-0000-8000-8000-000000000009";

const mappingContext: AiAssistValidationContext = {
  sourceContentHash: sourceHash,
  sourceLength: 200,
  mappingCandidateId,
  allowedCanonicalProductClassIds: [canonicalId],
  allowedStoreIds: [],
  sourceUrl: "https://retailer.example.invalid/source",
  budget: {
    maxInputTokens: 2_000,
    maxOutputTokens: 500,
    maxCostMicros: 20_000,
  },
  minimumConfidence: 0.8,
  taskKind: "product-mapping",
};

export const aiAssistEvaluationFixtures: readonly EvaluationFixture[] = [
  {
    name: "valid-product-mapping",
    proposal: mappingProposal(),
    context: mappingContext,
    expectedStatus: "pending-review",
    expectedReasonCodes: [],
  },
  {
    name: "low-confidence",
    proposal: mappingProposal({ confidence: 0.2 }),
    context: mappingContext,
    expectedStatus: "quarantined",
    expectedReasonCodes: ["LOW_CONFIDENCE"],
  },
  {
    name: "cost-budget-exceeded",
    proposal: mappingProposal({
      usage: { inputTokens: 400, outputTokens: 120, costMicros: 20_001 },
    }),
    context: mappingContext,
    expectedStatus: "quarantined",
    expectedReasonCodes: ["BUDGET_EXCEEDED"],
  },
  {
    name: "invalid-evidence",
    proposal: mappingProposal({
      evidenceSpans: [
        {
          field: "canonicalProductClassId",
          start: 190,
          end: 210,
          sourceContentHash: "e".repeat(64),
        },
      ],
    }),
    context: mappingContext,
    expectedStatus: "quarantined",
    expectedReasonCodes: [
      "EVIDENCE_HASH_MISMATCH",
      "EVIDENCE_SPAN_OUT_OF_RANGE",
      "MISSING_FIELD_EVIDENCE",
    ],
  },
  {
    name: "wrong-source-and-store",
    proposal: flyerProposal(),
    context: {
      ...mappingContext,
      taskKind: "flyer-extraction",
      mappingCandidateId: null,
      allowedCanonicalProductClassIds: [],
      allowedStoreIds: ["018f5f70-7b5d-7a21-9f49-01b7f63ad006"],
      sourceUrl: "https://retailer.example.invalid/flyer/approved",
      sourceLength: 500,
    },
    expectedStatus: "quarantined",
    expectedReasonCodes: ["SOURCE_URL_MISMATCH", "STORE_NOT_ALLOWED"],
  },
];

export function evaluateAiAssistFixtures() {
  const failures: string[] = [];
  for (const fixture of aiAssistEvaluationFixtures) {
    const result = validateAiAssistCandidate(fixture.proposal, fixture.context);
    if (
      result.status !== fixture.expectedStatus ||
      JSON.stringify(result.reasonCodes) !==
        JSON.stringify(fixture.expectedReasonCodes)
    ) {
      failures.push(fixture.name);
    }
  }
  return {
    total: aiAssistEvaluationFixtures.length,
    passed: aiAssistEvaluationFixtures.length - failures.length,
    failures,
  };
}

function mappingProposal(
  overrides: Partial<AiAssistProposal> = {},
): AiAssistProposal {
  return {
    contractVersion: "1",
    id: "018f5f70-7b5d-7a21-9f49-01b7f63ad002",
    taskKey: "kaufland:mapping:synthetic-eval",
    sourceSnapshotId: "018f5f70-7b5d-7a21-9f49-01b7f63ad003",
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
        start: 0,
        end: 10,
        sourceContentHash: sourceHash,
      },
      {
        field: "variantAttributes.state",
        start: 10,
        end: 20,
        sourceContentHash: sourceHash,
      },
    ],
    usage: { inputTokens: 400, outputTokens: 120, costMicros: 2_500 },
    payload: {
      kind: "product-mapping",
      mappingCandidateId,
      canonicalProductClassId: canonicalId,
      variantAttributes: { state: "fresh" },
    },
    reviewStatus: "pending",
    createdAt: "2026-08-01T12:00:00.000Z",
    ...overrides,
  };
}

function flyerProposal(): AiAssistProposal {
  const fields = [
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
    id: "018f5f70-7b5d-7a21-9f49-01b7f63ad004",
    taskKey: "synthetic:flyer:evaluation",
    sourceSnapshotId: "018f5f70-7b5d-7a21-9f49-01b7f63ad003",
    promptVersion: "flyer-extraction-v1",
    model: {
      provider: "synthetic-provider",
      name: "synthetic-model",
      version: "2026-08-01",
    },
    confidence: 0.9,
    evidenceSpans: fields.map((field, index) => ({
      field,
      start: index * 10,
      end: index * 10 + 8,
      sourceContentHash: sourceHash,
    })),
    usage: { inputTokens: 500, outputTokens: 150, costMicros: 3_500 },
    payload: {
      kind: "flyer-extraction",
      sourceUrl: "https://retailer.example.invalid/flyer/wrong",
      storeId: "018f5f70-7b5d-7a21-9f49-01b7f63ad005",
      exactName: "Synthetic bananas",
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
    reviewStatus: "pending",
    createdAt: "2026-08-01T12:00:00.000Z",
  };
}
