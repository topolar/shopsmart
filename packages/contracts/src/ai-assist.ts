import { z } from "zod/v4";

import {
  membershipConditionSchema,
  moneySchema,
  offerPackageSchema,
  offerValiditySchema,
  productAttributesSchema,
} from "./offer";

const boundedText = z.string().trim().min(1).max(240);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const httpUrlSchema = z
  .url()
  .refine(
    (value) => ["http:", "https:"].includes(new URL(value).protocol),
    "Source URLs must use HTTP(S).",
  );

export const aiAssistModelSchema = z.object({
  provider: boundedText,
  name: boundedText,
  version: boundedText,
});

export const aiAssistEvidenceSpanSchema = z
  .object({
    field: boundedText,
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    sourceContentHash: sha256Schema,
  })
  .refine(({ start, end }) => end > start, {
    message: "Evidence span end must follow its start.",
    path: ["end"],
  });

export const aiAssistUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costMicros: z.number().int().nonnegative(),
});

export const aiAssistProductMappingPayloadSchema = z.object({
  kind: z.literal("product-mapping"),
  mappingCandidateId: z.uuid(),
  canonicalProductClassId: z.uuid(),
  variantAttributes: productAttributesSchema,
});

export const aiAssistFlyerExtractionPayloadSchema = z.object({
  kind: z.literal("flyer-extraction"),
  sourceUrl: httpUrlSchema,
  storeId: z.uuid(),
  exactName: boundedText,
  package: offerPackageSchema,
  price: moneySchema.extend({ currency: z.literal("CZK") }),
  membership: membershipConditionSchema,
  validity: offerValiditySchema.safeExtend({ validTo: z.iso.datetime() }),
});

export const aiAssistPayloadSchema = z.discriminatedUnion("kind", [
  aiAssistProductMappingPayloadSchema,
  aiAssistFlyerExtractionPayloadSchema,
]);

export const aiAssistReviewStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "quarantined",
]);

export const aiAssistProposalSchema = z.object({
  contractVersion: z.literal("1"),
  id: z.uuid(),
  taskKey: boundedText,
  sourceSnapshotId: z.uuid(),
  promptVersion: boundedText,
  model: aiAssistModelSchema,
  confidence: z.number().min(0).max(1),
  evidenceSpans: z.array(aiAssistEvidenceSpanSchema).min(1).max(100),
  usage: aiAssistUsageSchema,
  payload: aiAssistPayloadSchema,
  reviewStatus: aiAssistReviewStatusSchema.default("pending"),
  createdAt: z.iso.datetime(),
});

export const aiAssistBudgetSchema = z.object({
  maxInputTokens: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  maxCostMicros: z.number().int().positive(),
});

export const aiAssistRequestSchema = z
  .object({
    contractVersion: z.literal("1"),
    taskKind: z.enum(["product-mapping", "flyer-extraction"]),
    taskKey: boundedText,
    sourceSnapshotId: z.uuid(),
    promptVersion: boundedText,
    sourceContentHash: sha256Schema,
    sourceText: z.string().min(1).max(200_000),
    sourceLength: z.number().int().positive(),
  })
  .refine(
    ({ sourceText, sourceLength }) => sourceText.length === sourceLength,
    {
      message: "sourceLength must match sourceText length.",
      path: ["sourceLength"],
    },
  );

export const aiAssistReviewRequestSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().min(1).max(1_000),
});

export const aiAssistReviewQueueItemSchema = aiAssistProposalSchema.extend({
  validationStatus: z.enum(["pending-review", "quarantined"]),
  reasonCodes: z.array(boundedText),
});

export const aiAssistReviewQueueResponseSchema = z.object({
  items: z.array(aiAssistReviewQueueItemSchema),
});

export const aiAssistReviewResponseSchema = z.object({
  proposalId: z.uuid(),
  reviewStatus: z.enum(["approved", "rejected"]),
  reviewedAt: z.iso.datetime(),
});

export const aiAssistReviewErrorSchema = z.object({
  code: z.enum([
    "AI_PROPOSAL_ALREADY_REVIEWED",
    "QUARANTINED_PROPOSAL_CANNOT_BE_APPROVED",
    "AI_TASK_ALREADY_APPROVED",
    "MAPPING_ALREADY_REVIEWED",
    "STALE_MAPPING_PROPOSAL",
    "MAPPING_ATTRIBUTE_MISMATCH",
  ]),
  message: boundedText,
});

export const operatorAuthorizationErrorSchema = z.object({
  code: z.enum(["UNAUTHENTICATED", "OPERATOR_REQUIRED"]),
  message: boundedText,
});

export type AiAssistProposal = z.infer<typeof aiAssistProposalSchema>;
export type AiAssistBudget = z.infer<typeof aiAssistBudgetSchema>;
export type AiAssistRequest = z.infer<typeof aiAssistRequestSchema>;
export type AiAssistReviewRequest = z.infer<typeof aiAssistReviewRequestSchema>;
export type AiAssistReviewQueueResponse = z.infer<
  typeof aiAssistReviewQueueResponseSchema
>;
export type AiAssistReviewResponse = z.infer<
  typeof aiAssistReviewResponseSchema
>;
