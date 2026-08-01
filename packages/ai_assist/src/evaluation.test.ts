import { describe, expect, it } from "vitest";

import {
  aiAssistEvaluationFixtures,
  evaluateAiAssistFixtures,
} from "./evaluation.js";

describe("synthetic AI-assist evaluation", () => {
  it("covers expected failure modes without a live model call", () => {
    expect(aiAssistEvaluationFixtures.map(({ name }) => name)).toEqual([
      "valid-product-mapping",
      "low-confidence",
      "cost-budget-exceeded",
      "invalid-evidence",
      "wrong-source-and-store",
    ]);
    expect(evaluateAiAssistFixtures()).toEqual({
      total: 5,
      passed: 5,
      failures: [],
    });
  });
});
