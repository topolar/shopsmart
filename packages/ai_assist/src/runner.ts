import {
  aiAssistProposalSchema,
  aiAssistRequestSchema,
  type AiAssistRequest,
  type AiAssistProposal,
} from "@shopsmart/contracts";
import {
  InvalidAiAssistProposalError,
  buildAiAssistCacheKey,
  buildAiAssistRequestCacheKey,
  validateAiAssistCandidate,
  type AiAssistValidationContext,
  type AiAssistValidationResult,
} from "@shopsmart/domain";

export type AiAssistModelAdapter = Readonly<{
  generate(input: {
    taskKey: string;
    promptVersion: string;
    sourceText: string;
    sourceContentHash: string;
    maxOutputTokens: number;
  }): Promise<unknown>;
}>;

export type AiAssistRepository = Readonly<{
  findApproved(cacheKey: string): Promise<AiAssistProposal | null>;
  saveValidation(validation: AiAssistValidationResult): Promise<void>;
  recordFailure(input: { taskKey: string; code: string }): Promise<void>;
}>;

type RunAiAssistInput = Readonly<{
  request: AiAssistRequest;
  maxInputCharacters: number;
  validationContext: AiAssistValidationContext;
  repository: AiAssistRepository;
  adapter: AiAssistModelAdapter;
}>;

export class AiAssistPreflightBudgetError extends Error {
  readonly code = "INPUT_BUDGET_EXCEEDED";

  constructor() {
    super("AI-assist source input exceeds the configured character budget.");
    this.name = "AiAssistPreflightBudgetError";
  }
}

export async function runAiAssist(input: RunAiAssistInput) {
  const request = aiAssistRequestSchema.parse(input.request);
  const cacheKey = buildAiAssistRequestCacheKey(request);
  const cached = await input.repository.findApproved(cacheKey);
  if (cached) {
    const proposal = aiAssistProposalSchema.parse(cached);
    if (
      proposal.reviewStatus === "approved" &&
      buildAiAssistCacheKey(proposal) === cacheKey
    ) {
      return { kind: "cache-hit" as const, proposal };
    }
  }
  if (
    !Number.isInteger(input.maxInputCharacters) ||
    input.maxInputCharacters < 1 ||
    request.sourceText.length > input.maxInputCharacters
  ) {
    await input.repository.recordFailure({
      taskKey: request.taskKey,
      code: "INPUT_BUDGET_EXCEEDED",
    });
    throw new AiAssistPreflightBudgetError();
  }

  let output: unknown;
  try {
    output = await input.adapter.generate({
      taskKey: request.taskKey,
      promptVersion: request.promptVersion,
      sourceText: request.sourceText,
      sourceContentHash: request.sourceContentHash,
      maxOutputTokens: input.validationContext.budget.maxOutputTokens,
    });
  } catch (error) {
    await input.repository.recordFailure({
      taskKey: request.taskKey,
      code: "PROVIDER_FAILURE",
    });
    throw error;
  }
  let validation: AiAssistValidationResult;
  try {
    validation = validateAiAssistCandidate(output, {
      ...input.validationContext,
      taskKind: request.taskKind,
    });
  } catch (error) {
    if (error instanceof InvalidAiAssistProposalError) {
      await input.repository.recordFailure({
        taskKey: request.taskKey,
        code: error.code,
      });
    }
    throw error;
  }
  await input.repository.saveValidation(validation);
  return { kind: "generated" as const, validation };
}
