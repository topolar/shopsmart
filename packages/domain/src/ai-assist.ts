import { createHash } from "node:crypto";

import {
  aiAssistProposalSchema,
  type AiAssistBudget,
  type AiAssistProposal,
  type AiAssistRequest,
} from "@shopsmart/contracts";

export type AiAssistQuarantineReason =
  | "BUDGET_EXCEEDED"
  | "LOW_CONFIDENCE"
  | "EVIDENCE_HASH_MISMATCH"
  | "EVIDENCE_SPAN_OUT_OF_RANGE"
  | "MISSING_FIELD_EVIDENCE"
  | "MAPPING_CANDIDATE_MISMATCH"
  | "CANONICAL_CLASS_NOT_ALLOWED"
  | "SOURCE_URL_MISMATCH"
  | "STORE_NOT_ALLOWED"
  | "TASK_KIND_MISMATCH";

export type AiAssistValidationContext = Readonly<{
  sourceContentHash: string;
  sourceLength: number;
  mappingCandidateId: string | null;
  allowedCanonicalProductClassIds: readonly string[];
  allowedStoreIds: readonly string[];
  sourceUrl: string;
  budget: AiAssistBudget;
  minimumConfidence: number;
  taskKind: AiAssistProposal["payload"]["kind"];
}>;

export type AiAssistValidationResult = Readonly<{
  status: "pending-review" | "quarantined";
  proposal: AiAssistProposal;
  reasonCodes: readonly AiAssistQuarantineReason[];
}>;

export class InvalidAiAssistProposalError extends Error {
  readonly code = "INVALID_AI_ASSIST_PROPOSAL";

  constructor(cause: unknown) {
    super("AI-assist output did not satisfy the versioned schema.", { cause });
    this.name = "InvalidAiAssistProposalError";
  }
}

export function validateAiAssistCandidate(
  input: unknown,
  context: AiAssistValidationContext,
): AiAssistValidationResult {
  const parsed = aiAssistProposalSchema.safeParse(input);
  if (!parsed.success) throw new InvalidAiAssistProposalError(parsed.error);
  const proposal = parsed.data;
  const reasons: AiAssistQuarantineReason[] = [];

  if (
    proposal.usage.inputTokens > context.budget.maxInputTokens ||
    proposal.usage.outputTokens > context.budget.maxOutputTokens ||
    proposal.usage.costMicros > context.budget.maxCostMicros
  ) {
    reasons.push("BUDGET_EXCEEDED");
  }
  if (proposal.confidence < context.minimumConfidence) {
    reasons.push("LOW_CONFIDENCE");
  }
  if (proposal.payload.kind !== context.taskKind) {
    reasons.push("TASK_KIND_MISMATCH");
  }
  if (
    proposal.evidenceSpans.some(
      ({ sourceContentHash }) =>
        sourceContentHash !== context.sourceContentHash,
    )
  ) {
    reasons.push("EVIDENCE_HASH_MISMATCH");
  }
  if (
    proposal.evidenceSpans.some(
      ({ start, end }) =>
        start >= context.sourceLength || end > context.sourceLength,
    )
  ) {
    reasons.push("EVIDENCE_SPAN_OUT_OF_RANGE");
  }
  const evidencedFields = new Set(
    proposal.evidenceSpans.map(({ field }) => field),
  );
  if (
    requiredEvidenceFields(proposal).some(
      (field) => !evidencedFields.has(field),
    )
  ) {
    reasons.push("MISSING_FIELD_EVIDENCE");
  }

  if (proposal.payload.kind === "product-mapping") {
    if (proposal.payload.mappingCandidateId !== context.mappingCandidateId) {
      reasons.push("MAPPING_CANDIDATE_MISMATCH");
    }
    if (
      !context.allowedCanonicalProductClassIds.includes(
        proposal.payload.canonicalProductClassId,
      )
    ) {
      reasons.push("CANONICAL_CLASS_NOT_ALLOWED");
    }
  } else {
    if (proposal.payload.sourceUrl !== context.sourceUrl) {
      reasons.push("SOURCE_URL_MISMATCH");
    }
    if (!context.allowedStoreIds.includes(proposal.payload.storeId)) {
      reasons.push("STORE_NOT_ALLOWED");
    }
  }

  const status = reasons.length === 0 ? "pending-review" : "quarantined";
  return {
    status,
    proposal: {
      ...proposal,
      reviewStatus: status === "pending-review" ? "pending" : "quarantined",
    },
    reasonCodes: reasons,
  };
}

export function buildAiAssistCacheKey(proposal: AiAssistProposal): string {
  return createCacheKey({
    contractVersion: proposal.contractVersion,
    taskKind: proposal.payload.kind,
    taskKey: proposal.taskKey,
    promptVersion: proposal.promptVersion,
    sourceContentHash: proposal.evidenceSpans[0]!.sourceContentHash,
  });
}

export function buildAiAssistRequestCacheKey(request: AiAssistRequest): string {
  return createCacheKey(request);
}

function createCacheKey(input: {
  contractVersion: string;
  taskKind: string;
  taskKey: string;
  promptVersion: string;
  sourceContentHash: string;
}): string {
  const digest = createHash("sha256")
    .update(
      [
        input.contractVersion,
        input.taskKind,
        input.taskKey,
        input.promptVersion,
        input.sourceContentHash,
      ].join("\u0000"),
    )
    .digest("hex");
  return `ai-assist:v1:${digest}`;
}

function requiredEvidenceFields(proposal: AiAssistProposal): string[] {
  if (proposal.payload.kind === "product-mapping") {
    return [
      "canonicalProductClassId",
      ...Object.keys(proposal.payload.variantAttributes).map(
        (key) => `variantAttributes.${key}`,
      ),
    ];
  }
  return [
    "sourceUrl",
    "storeId",
    "exactName",
    "package.declared",
    "price.amount",
    "validity.validFrom",
    "validity.validTo",
  ];
}
