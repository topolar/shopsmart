import { describe, expect, it, vi } from "vitest";

import {
  AiAssistPreflightBudgetError,
  runAiAssist,
  type AiAssistRepository,
} from "./runner.js";

const sourceHash = "a".repeat(64);

describe("AI-assist runner", () => {
  it("reuses an approved stable proposal without buying another model call", async () => {
    const approved = proposal({ reviewStatus: "approved" });
    const repository = fakeRepository(approved);
    const adapter = { generate: vi.fn() };

    const result = await runAiAssist(runInput({ repository, adapter }));

    expect(result).toEqual({ kind: "cache-hit", proposal: approved });
    expect(adapter.generate).not.toHaveBeenCalled();
    expect(repository.saveValidation).not.toHaveBeenCalled();
  });

  it("does not reuse an approval identified only by a task key", async () => {
    const approved = proposal({ reviewStatus: "approved" });
    const repository = fakeRepository(null);
    repository.findApproved.mockImplementation(async (cacheKey) =>
      cacheKey === "kaufland:mapping:synthetic-1001" ? approved : null,
    );
    const adapter = { generate: vi.fn(async () => proposal()) };

    const result = await runAiAssist(runInput({ repository, adapter }));

    expect(result.kind).toBe("generated");
    expect(adapter.generate).toHaveBeenCalledOnce();
  });

  it("bounds the model request and persists a deterministic pending proposal", async () => {
    const repository = fakeRepository(null);
    const adapter = { generate: vi.fn(async () => proposal()) };

    const result = await runAiAssist(runInput({ repository, adapter }));

    expect(adapter.generate).toHaveBeenCalledWith({
      taskKey: "kaufland:mapping:synthetic-1001",
      promptVersion: "product-mapping-v1",
      sourceText: "Synthetic fresh bananas",
      sourceContentHash: sourceHash,
      maxOutputTokens: 500,
    });
    expect(result).toMatchObject({
      kind: "generated",
      validation: { status: "pending-review", reasonCodes: [] },
    });
    expect(repository.saveValidation).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending-review" }),
    );
  });

  it("stops before the adapter when source input exceeds the preflight budget", async () => {
    const repository = fakeRepository(null);
    const adapter = { generate: vi.fn() };

    await expect(
      runAiAssist(
        runInput({
          repository,
          adapter,
          request: {
            contractVersion: "1",
            taskKind: "product-mapping",
            taskKey: "kaufland:mapping:synthetic-1001",
            sourceSnapshotId: "018f5f70-7b5d-7a21-9f49-01b7f63aa003",
            promptVersion: "product-mapping-v1",
            sourceText: "x".repeat(101),
            sourceLength: 101,
            sourceContentHash: sourceHash,
          },
          maxInputCharacters: 100,
        }),
      ),
    ).rejects.toBeInstanceOf(AiAssistPreflightBudgetError);
    expect(adapter.generate).not.toHaveBeenCalled();
    expect(repository.recordFailure).toHaveBeenCalledWith({
      taskKey: "kaufland:mapping:synthetic-1001",
      code: "INPUT_BUDGET_EXCEEDED",
    });
  });

  it("records a bounded failure code when the provider adapter fails", async () => {
    const repository = fakeRepository(null);
    const adapter = {
      generate: vi.fn(async () => {
        throw new Error("Synthetic provider detail must not be persisted.");
      }),
    };

    await expect(
      runAiAssist(runInput({ repository, adapter })),
    ).rejects.toThrow("Synthetic provider detail");
    expect(repository.recordFailure).toHaveBeenCalledWith({
      taskKey: "kaufland:mapping:synthetic-1001",
      code: "PROVIDER_FAILURE",
    });
  });
});

function fakeRepository(cached: ReturnType<typeof proposal> | null) {
  const repository = {
    findApproved: vi.fn(async (cacheKey: string) => {
      expect(cacheKey).toMatch(/^ai-assist:v1:[a-f0-9]{64}$/);
      return cached;
    }),
    saveValidation: vi.fn(async () => undefined),
    recordFailure: vi.fn(async () => undefined),
  } satisfies AiAssistRepository;
  return repository;
}

function runInput(overrides: Record<string, unknown>) {
  return {
    request: {
      contractVersion: "1",
      taskKind: "product-mapping",
      taskKey: "kaufland:mapping:synthetic-1001",
      sourceSnapshotId: "018f5f70-7b5d-7a21-9f49-01b7f63aa003",
      promptVersion: "product-mapping-v1",
      sourceText: "Synthetic fresh bananas",
      sourceLength: "Synthetic fresh bananas".length,
      sourceContentHash: sourceHash,
    },
    maxInputCharacters: 1_000,
    validationContext: {
      sourceContentHash: sourceHash,
      sourceLength: 200,
      mappingCandidateId: "018f5f70-7b5d-7a21-9f49-01b7f63aa001",
      allowedCanonicalProductClassIds: ["a1000000-0000-8000-8000-000000000009"],
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
    },
    ...overrides,
  } as never;
}

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: "1" as const,
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
      kind: "product-mapping" as const,
      mappingCandidateId: "018f5f70-7b5d-7a21-9f49-01b7f63aa001",
      canonicalProductClassId: "a1000000-0000-8000-8000-000000000009",
      variantAttributes: { state: "fresh" },
    },
    reviewStatus: "pending" as const,
    createdAt: "2026-08-01T12:00:00.000Z",
    ...overrides,
  };
}
