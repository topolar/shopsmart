import {
  KAUFLAND_PRAHA_VYPICH_SCOPE,
  processKauflandStoreSnapshot,
} from "@shopsmart/connectors";
import {
  buildAiAssistCacheKey,
  validateAiAssistCandidate,
} from "@shopsmart/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { integrationDatabaseUrl } from "../../../tests/integration-database.js";

import {
  AiAssistCacheRecord,
  AiAssistFailureRecord,
  AiAssistProposalRecord,
  AiAssistReviewRecord,
  TypeOrmAiAssistStore,
} from "./ai-assist-store.js";
import { createAppDataSource } from "./data-source.js";
import {
  QuarantinedSourceCandidateRecord,
  RetailerProductMappingCandidateRecord,
  SourceSnapshotRecord,
  TypeOrmSourceIngestionStore,
} from "./source-ingestion-store.js";

const databaseUrl = integrationDatabaseUrl();
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const sourceHash = "a".repeat(64);

describeWithDatabase("AI-assist persistence and review", () => {
  let dataSource: ReturnType<typeof createAppDataSource> | undefined;
  let store: TypeOrmAiAssistStore | undefined;

  beforeAll(async () => {
    dataSource = createAppDataSource(databaseUrl);
    await dataSource.initialize();
    await dataSource.runMigrations();
    store = new TypeOrmAiAssistStore(dataSource);
  });

  beforeEach(async () => {
    if (!dataSource) return;
    await cleanup(dataSource);
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    await cleanup(dataSource);
    await dataSource.destroy();
  });

  it("persists, explicitly approves, caches, and reuses a stable product mapping", async () => {
    if (!dataSource || !store) throw new Error("Store was not initialized.");
    const { snapshot, mappingCandidate } =
      await seedMappingCandidate(dataSource);
    const validation = validateAiAssistCandidate(
      mappingProposal(snapshot.id, mappingCandidate.id),
      validationContext(mappingCandidate.id),
    );

    await store.saveValidation(validation);
    await expect(store.listReviewQueue()).resolves.toEqual([
      expect.objectContaining({
        id: validation.proposal.id,
        reviewStatus: "pending",
        validationStatus: "pending-review",
      }),
    ]);
    await expect(
      store.findApproved(buildAiAssistCacheKey(validation.proposal)),
    ).resolves.toBeNull();

    await store.review({
      proposalId: validation.proposal.id,
      decision: "approved",
      reason: "Synthetic identity and fresh-state evidence verified.",
      reviewerUserId: "synthetic-operator",
      reviewedAt: "2026-08-01T13:00:00.000Z",
    });

    await expect(
      store.findApproved(buildAiAssistCacheKey(validation.proposal)),
    ).resolves.toMatchObject({
      id: validation.proposal.id,
      reviewStatus: "approved",
    });
    await expect(
      new TypeOrmSourceIngestionStore(
        dataSource,
      ).loadApprovedKauflandMappings(),
    ).resolves.toEqual([
      expect.objectContaining({
        externalId: "ai-mapping-1",
        canonicalProductClassId: "a1000000-0000-8000-8000-000000000009",
        variantAttributes: { state: "fresh" },
      }),
    ]);
    await expect(
      store.review({
        proposalId: validation.proposal.id,
        decision: "rejected",
        reason: "A second review must not overwrite the first.",
        reviewerUserId: "synthetic-operator-2",
        reviewedAt: "2026-08-01T14:00:00.000Z",
      }),
    ).rejects.toThrow("AI_PROPOSAL_ALREADY_REVIEWED");
  });

  it("allows rejection but never approval of a quarantined ambiguous proposal", async () => {
    if (!dataSource || !store) throw new Error("Store was not initialized.");
    const { snapshot, mappingCandidate } =
      await seedMappingCandidate(dataSource);
    const validation = validateAiAssistCandidate(
      mappingProposal(snapshot.id, mappingCandidate.id, { confidence: 0.2 }),
      validationContext(mappingCandidate.id),
    );
    expect(validation.status).toBe("quarantined");
    await store.saveValidation(validation);

    await expect(
      store.review({
        proposalId: validation.proposal.id,
        decision: "approved",
        reason: "Must fail.",
        reviewerUserId: "synthetic-operator",
        reviewedAt: "2026-08-01T13:00:00.000Z",
      }),
    ).rejects.toThrow("QUARANTINED_PROPOSAL_CANNOT_BE_APPROVED");
    await store.review({
      proposalId: validation.proposal.id,
      decision: "rejected",
      reason: "Confidence below deterministic threshold.",
      reviewerUserId: "synthetic-operator",
      reviewedAt: "2026-08-01T13:01:00.000Z",
    });
    expect(await dataSource.getRepository(AiAssistCacheRecord).count()).toBe(0);
  });

  it("records bounded runner failures without storing model output", async () => {
    if (!dataSource || !store) throw new Error("Store was not initialized.");
    await store.recordFailure({
      taskKey: "synthetic:oversized-input",
      code: "INPUT_BUDGET_EXCEEDED",
    });
    expect(
      await dataSource.getRepository(AiAssistFailureRecord).findOneByOrFail({
        taskKey: "synthetic:oversized-input",
      }),
    ).toMatchObject({ code: "INPUT_BUDGET_EXCEEDED" });
    expect(await dataSource.getRepository(AiAssistProposalRecord).count()).toBe(
      0,
    );
  });

  it("never overwrites an existing proposal envelope", async () => {
    if (!dataSource || !store) throw new Error("Store was not initialized.");
    const { snapshot, mappingCandidate } =
      await seedMappingCandidate(dataSource);
    const initial = validateAiAssistCandidate(
      mappingProposal(snapshot.id, mappingCandidate.id),
      validationContext(mappingCandidate.id),
    );
    await store.saveValidation(initial);

    const replacement = validateAiAssistCandidate(
      mappingProposal(snapshot.id, mappingCandidate.id, {
        model: {
          provider: "synthetic-provider",
          name: "replacement-model",
          version: "2026-08-02",
        },
      }),
      validationContext(mappingCandidate.id),
    );
    await expect(store.saveValidation(replacement)).rejects.toThrow();
    await expect(
      dataSource
        .getRepository(AiAssistProposalRecord)
        .findOneByOrFail({ id: initial.proposal.id }),
    ).resolves.toMatchObject({ modelName: "synthetic-model" });
  });
});

async function seedMappingCandidate(
  dataSource: NonNullable<ReturnType<typeof createAppDataSource>>,
) {
  const sourceStore = new TypeOrmSourceIngestionStore(dataSource);
  const result = processKauflandStoreSnapshot({
    html: syntheticPage,
    httpStatus: 200,
    retrievedAt: "2026-08-01T12:00:00.000Z",
    productMappings: [],
  });
  const { snapshotId } = await sourceStore.persist(result, {
    rawStorageKey: null,
  });
  return {
    snapshot: await dataSource
      .getRepository(SourceSnapshotRecord)
      .findOneByOrFail({ id: snapshotId }),
    mappingCandidate: await dataSource
      .getRepository(RetailerProductMappingCandidateRecord)
      .findOneByOrFail({ externalId: "ai-mapping-1" }),
  };
}

function validationContext(mappingCandidateId: string) {
  return {
    sourceContentHash: sourceHash,
    sourceLength: 200,
    mappingCandidateId,
    allowedCanonicalProductClassIds: ["a1000000-0000-8000-8000-000000000009"],
    allowedStoreIds: [],
    sourceUrl: KAUFLAND_PRAHA_VYPICH_SCOPE.sourceUrl,
    budget: {
      maxInputTokens: 2_000,
      maxOutputTokens: 500,
      maxCostMicros: 20_000,
    },
    minimumConfidence: 0.8,
    taskKind: "product-mapping" as const,
  };
}

function mappingProposal(
  sourceSnapshotId: string,
  mappingCandidateId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    contractVersion: "1",
    id: "018f5f70-7b5d-7a21-9f49-01b7f63aa102",
    taskKey: "kaufland:mapping:ai-mapping-1",
    sourceSnapshotId,
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
      canonicalProductClassId: "a1000000-0000-8000-8000-000000000009",
      variantAttributes: { state: "fresh" },
    },
    createdAt: "2026-08-01T12:00:00.000Z",
    ...overrides,
  };
}

async function cleanup(
  dataSource: NonNullable<ReturnType<typeof createAppDataSource>>,
) {
  await dataSource
    .getRepository(AiAssistCacheRecord)
    .createQueryBuilder()
    .delete()
    .execute();
  await dataSource
    .getRepository(AiAssistReviewRecord)
    .createQueryBuilder()
    .delete()
    .execute();
  await dataSource
    .getRepository(AiAssistProposalRecord)
    .createQueryBuilder()
    .delete()
    .execute();
  await dataSource
    .getRepository(AiAssistFailureRecord)
    .createQueryBuilder()
    .delete()
    .execute();
  await dataSource
    .getRepository(RetailerProductMappingCandidateRecord)
    .createQueryBuilder()
    .delete()
    .where("source_scope_key = :scope", {
      scope: KAUFLAND_PRAHA_VYPICH_SCOPE.key,
    })
    .execute();
  await dataSource
    .getRepository(QuarantinedSourceCandidateRecord)
    .createQueryBuilder()
    .delete()
    .where("source_scope_key = :scope", {
      scope: KAUFLAND_PRAHA_VYPICH_SCOPE.key,
    })
    .execute();
  await dataSource
    .getRepository(SourceSnapshotRecord)
    .createQueryBuilder()
    .delete()
    .where("source_scope_key = :scope", {
      scope: KAUFLAND_PRAHA_VYPICH_SCOPE.key,
    })
    .execute();
}

const syntheticPage = `<!doctype html><html lang="cs"><body><main>
  <h1>Kaufland Praha-Vypich</h1>
  <section class="t-tiles-slider">
    <h2>Akční nabídka z aktuálního letáku pro tuto prodejnu</h2>
    <h3>Platí od 29.07.2026 do 04.08.2026</h3>
    <a class="k-product-tile" href="/nabidka/prehled.html?kloffer-articleID=ai-mapping-1">
      <div class="k-product-tile__title">Syntetické čerstvé banány</div>
      <div class="k-product-tile__unit-price">1 kg</div>
      <div class="k-product-tile__pricetags-normal"><div class="k-price-tag__price">24,90</div></div>
    </a>
  </section>
</main></body></html>`;
