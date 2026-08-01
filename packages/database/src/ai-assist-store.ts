import {
  aiAssistProposalSchema,
  aiAssistReviewRequestSchema,
  type AiAssistProposal,
} from "@shopsmart/contracts";
import type { AiAssistValidationResult } from "@shopsmart/domain";
import { buildAiAssistCacheKey } from "@shopsmart/domain";
import { EntitySchema, type DataSource, type EntityManager } from "typeorm";

import { CanonicalProductClassRecord } from "./offer-record.js";
import { RetailerProductMappingCandidateRecord } from "./source-ingestion-store.js";

export class AiAssistProposalRecord {
  id!: string;
  contractVersion!: "1";
  taskKey!: string;
  sourceSnapshotId!: string;
  promptVersion!: string;
  modelProvider!: string;
  modelName!: string;
  modelVersion!: string;
  confidence!: number;
  evidenceSpans!: AiAssistProposal["evidenceSpans"];
  usage!: AiAssistProposal["usage"];
  payload!: AiAssistProposal["payload"];
  validationStatus!: AiAssistValidationResult["status"];
  reasonCodes!: string[];
  reviewStatus!: AiAssistProposal["reviewStatus"];
  createdAt!: Date;
  updatedAt!: Date;
}

export class AiAssistReviewRecord {
  id!: string;
  proposalId!: string;
  decision!: "approved" | "rejected";
  reason!: string;
  reviewerUserId!: string;
  reviewedAt!: Date;
}

export class AiAssistCacheRecord {
  cacheKey!: string;
  proposalId!: string;
  createdAt!: Date;
}

export class AiAssistFailureRecord {
  id!: string;
  taskKey!: string;
  code!: string;
  createdAt!: Date;
}

export const aiAssistProposalRecordSchema =
  new EntitySchema<AiAssistProposalRecord>({
    name: "AiAssistProposalRecord",
    tableName: "ai_assist_proposals",
    target: AiAssistProposalRecord,
    columns: {
      id: { type: "uuid", primary: true },
      contractVersion: {
        name: "contract_version",
        type: "varchar",
        length: 8,
      },
      taskKey: { name: "task_key", type: "varchar", length: 240 },
      sourceSnapshotId: { name: "source_snapshot_id", type: "uuid" },
      promptVersion: {
        name: "prompt_version",
        type: "varchar",
        length: 240,
      },
      modelProvider: {
        name: "model_provider",
        type: "varchar",
        length: 240,
      },
      modelName: { name: "model_name", type: "varchar", length: 240 },
      modelVersion: {
        name: "model_version",
        type: "varchar",
        length: 240,
      },
      confidence: { type: "double precision" },
      evidenceSpans: { name: "evidence_spans", type: "jsonb" },
      usage: { type: "jsonb" },
      payload: { type: "jsonb" },
      validationStatus: {
        name: "validation_status",
        type: "varchar",
        length: 24,
      },
      reasonCodes: { name: "reason_codes", type: "varchar", array: true },
      reviewStatus: {
        name: "review_status",
        type: "varchar",
        length: 24,
      },
      createdAt: { name: "created_at", type: "timestamptz" },
      updatedAt: { name: "updated_at", type: "timestamptz", updateDate: true },
    },
  });

export const aiAssistReviewRecordSchema =
  new EntitySchema<AiAssistReviewRecord>({
    name: "AiAssistReviewRecord",
    tableName: "ai_assist_reviews",
    target: AiAssistReviewRecord,
    columns: {
      id: { type: "uuid", primary: true, generated: "uuid" },
      proposalId: { name: "proposal_id", type: "uuid", unique: true },
      decision: { type: "varchar", length: 16 },
      reason: { type: "varchar", length: 1_000 },
      reviewerUserId: {
        name: "reviewer_user_id",
        type: "varchar",
        length: 240,
      },
      reviewedAt: { name: "reviewed_at", type: "timestamptz" },
    },
  });

export const aiAssistCacheRecordSchema = new EntitySchema<AiAssistCacheRecord>({
  name: "AiAssistCacheRecord",
  tableName: "ai_assist_cache",
  target: AiAssistCacheRecord,
  columns: {
    cacheKey: { name: "cache_key", type: "varchar", length: 80, primary: true },
    proposalId: {
      name: "proposal_id",
      type: "uuid",
      unique: true,
    },
    createdAt: { name: "created_at", type: "timestamptz", createDate: true },
  },
});

export const aiAssistFailureRecordSchema =
  new EntitySchema<AiAssistFailureRecord>({
    name: "AiAssistFailureRecord",
    tableName: "ai_assist_failures",
    target: AiAssistFailureRecord,
    columns: {
      id: { type: "uuid", primary: true, generated: "uuid" },
      taskKey: { name: "task_key", type: "varchar", length: 240 },
      code: { type: "varchar", length: 120 },
      createdAt: { name: "created_at", type: "timestamptz", createDate: true },
    },
  });

export class TypeOrmAiAssistStore {
  constructor(private readonly dataSource: DataSource) {}

  async findApproved(cacheKey: string): Promise<AiAssistProposal | null> {
    const cached = await this.dataSource
      .getRepository(AiAssistCacheRecord)
      .findOneBy({ cacheKey });
    if (!cached) return null;
    const proposal = await this.dataSource
      .getRepository(AiAssistProposalRecord)
      .findOneByOrFail({ id: cached.proposalId, reviewStatus: "approved" });
    return toProposal(proposal);
  }

  async saveValidation(validation: AiAssistValidationResult): Promise<void> {
    const proposal = aiAssistProposalSchema.parse(validation.proposal);
    await this.dataSource.getRepository(AiAssistProposalRecord).insert({
      id: proposal.id,
      contractVersion: proposal.contractVersion,
      taskKey: proposal.taskKey,
      sourceSnapshotId: proposal.sourceSnapshotId,
      promptVersion: proposal.promptVersion,
      modelProvider: proposal.model.provider,
      modelName: proposal.model.name,
      modelVersion: proposal.model.version,
      confidence: proposal.confidence,
      evidenceSpans: proposal.evidenceSpans,
      usage: proposal.usage,
      payload: proposal.payload,
      validationStatus: validation.status,
      reasonCodes: [...validation.reasonCodes],
      reviewStatus: proposal.reviewStatus,
      createdAt: new Date(proposal.createdAt),
    });
  }

  async recordFailure(input: { taskKey: string; code: string }): Promise<void> {
    if (!input.taskKey.trim() || !/^[A-Z0-9_:-]{3,120}$/.test(input.code)) {
      throw new Error("Invalid AI-assist failure metadata.");
    }
    await this.dataSource.getRepository(AiAssistFailureRecord).save(input);
  }

  async listReviewQueue() {
    const records = await this.dataSource
      .getRepository(AiAssistProposalRecord)
      .createQueryBuilder("proposal")
      .where("proposal.review_status IN (:...statuses)", {
        statuses: ["pending", "quarantined"],
      })
      .orderBy("proposal.created_at", "ASC")
      .addOrderBy("proposal.id", "ASC")
      .getMany();
    return records.map((record) => ({
      ...toProposal(record),
      validationStatus: record.validationStatus,
      reasonCodes: record.reasonCodes,
    }));
  }

  async review(input: {
    proposalId: string;
    decision: "approved" | "rejected";
    reason: string;
    reviewerUserId: string;
    reviewedAt: string;
  }): Promise<void> {
    const review = aiAssistReviewRequestSchema.parse(input);
    const reviewerUserId = input.reviewerUserId.trim();
    if (!reviewerUserId || reviewerUserId.length > 240) {
      throw new Error("reviewerUserId is required.");
    }
    const reviewedAt = parseTimestamp(input.reviewedAt);
    await this.dataSource.transaction(async (manager) => {
      const proposals = manager.getRepository(AiAssistProposalRecord);
      const proposal = await proposals.findOne({
        where: { id: input.proposalId },
        lock: { mode: "pessimistic_write" },
      });
      if (!proposal) throw new Error("UNKNOWN_AI_PROPOSAL");
      if (!["pending", "quarantined"].includes(proposal.reviewStatus)) {
        throw new Error("AI_PROPOSAL_ALREADY_REVIEWED");
      }
      if (
        review.decision === "approved" &&
        proposal.validationStatus !== "pending-review"
      ) {
        throw new Error("QUARANTINED_PROPOSAL_CANNOT_BE_APPROVED");
      }
      if (review.decision === "approved") {
        const existing = await manager
          .getRepository(AiAssistCacheRecord)
          .findOneBy({ cacheKey: buildAiAssistCacheKey(toProposal(proposal)) });
        if (existing) throw new Error("AI_TASK_ALREADY_APPROVED");
        if (proposal.payload.kind === "product-mapping") {
          await approveProductMapping(
            manager,
            proposal,
            reviewerUserId,
            reviewedAt,
          );
        }
      }
      await manager.getRepository(AiAssistReviewRecord).save({
        proposalId: proposal.id,
        decision: review.decision,
        reason: review.reason,
        reviewerUserId,
        reviewedAt,
      });
      await proposals.update(
        { id: proposal.id },
        { reviewStatus: review.decision },
      );
      if (review.decision === "approved") {
        await manager.getRepository(AiAssistCacheRecord).save({
          cacheKey: buildAiAssistCacheKey(toProposal(proposal)),
          proposalId: proposal.id,
        });
      }
    });
  }
}

async function approveProductMapping(
  manager: EntityManager,
  proposal: AiAssistProposalRecord,
  reviewerUserId: string,
  reviewedAt: Date,
): Promise<void> {
  if (proposal.payload.kind !== "product-mapping") return;
  const mappings = manager.getRepository(RetailerProductMappingCandidateRecord);
  const mapping = await mappings.findOne({
    where: { id: proposal.payload.mappingCandidateId },
    lock: { mode: "pessimistic_write" },
  });
  if (!mapping) throw new Error("UNKNOWN_MAPPING_CANDIDATE");
  if (mapping.status !== "pending") throw new Error("MAPPING_ALREADY_REVIEWED");
  if (mapping.sourceSnapshotId !== proposal.sourceSnapshotId) {
    throw new Error("STALE_MAPPING_PROPOSAL");
  }
  const canonical = await manager
    .getRepository(CanonicalProductClassRecord)
    .findOneBy({ id: proposal.payload.canonicalProductClassId });
  if (!canonical) throw new Error("UNKNOWN_CANONICAL_PRODUCT_CLASS");
  const attributes = proposal.payload.variantAttributes;
  const missingRequired = Object.entries(canonical.requiredAttributes).some(
    ([key, expected]) => attributes[key] !== expected,
  );
  const excluded = Object.entries(canonical.excludedAttributes).some(
    ([key, value]) => attributes[key] === value,
  );
  if (missingRequired || excluded)
    throw new Error("MAPPING_ATTRIBUTE_MISMATCH");
  await mappings.update(
    { id: mapping.id, status: "pending" },
    {
      status: "approved",
      canonicalProductClassId: canonical.id,
      variantAttributes: { ...attributes },
      reviewedBy: reviewerUserId,
      reviewedAt,
    },
  );
}

function toProposal(record: AiAssistProposalRecord): AiAssistProposal {
  return aiAssistProposalSchema.parse({
    contractVersion: record.contractVersion,
    id: record.id,
    taskKey: record.taskKey,
    sourceSnapshotId: record.sourceSnapshotId,
    promptVersion: record.promptVersion,
    model: {
      provider: record.modelProvider,
      name: record.modelName,
      version: record.modelVersion,
    },
    confidence: record.confidence,
    evidenceSpans: record.evidenceSpans,
    usage: record.usage,
    payload: record.payload,
    reviewStatus: record.reviewStatus,
    createdAt: record.createdAt.toISOString(),
  });
}

function parseTimestamp(value: string): Date {
  const timestamp = new Date(value);
  if (
    !Number.isFinite(timestamp.getTime()) ||
    timestamp.toISOString() !== value
  ) {
    throw new Error("reviewedAt must be a canonical ISO timestamp.");
  }
  return timestamp;
}
