import {
  coverageItemSchema,
  earlyRefreshTriggerSchema,
  type CoverageItemInput,
  type EarlyRefreshTrigger,
} from "@shopsmart/contracts";

type RefreshDecisionInput = Readonly<{
  kind: "static" | "dynamic";
  now: string;
  expiresAt: string | null;
  trigger?: EarlyRefreshTrigger;
}>;

const earlyReasons: Record<EarlyRefreshTrigger, string> = {
  "broken-url": "EARLY_BROKEN_URL",
  contradiction: "EARLY_CONTRADICTION",
  "official-change": "EARLY_OFFICIAL_CHANGE",
  "unknown-retailer": "EARLY_UNKNOWN_RETAILER",
  "explicit-request": "EARLY_EXPLICIT_REQUEST",
};

export function decideStaticContextRefresh(input: RefreshDecisionInput) {
  const now = parseTimestamp(input.now);
  const expiresAt = input.expiresAt ? parseTimestamp(input.expiresAt) : null;
  if (input.kind === "dynamic") {
    return { refresh: true, reason: "DYNAMIC_FACT" } as const;
  }
  if (input.trigger) {
    const trigger = earlyRefreshTriggerSchema.parse(input.trigger);
    return { refresh: true, reason: earlyReasons[trigger] } as const;
  }
  if (expiresAt === null) {
    return { refresh: true, reason: "TTL_MISSING" } as const;
  }
  return expiresAt <= now
    ? ({ refresh: true, reason: "TTL_EXPIRED" } as const)
    : ({ refresh: false, reason: "FRESH_TTL" } as const);
}

export function calculateConnectorRetryAt(
  failedAt: string,
  attempt: number,
): string {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error("Attempt must be a positive integer.");
  }
  const delaySeconds = Math.min(3600, 60 * 2 ** Math.min(attempt - 1, 16));
  return new Date(parseTimestamp(failedAt) + delaySeconds * 1000).toISOString();
}

export function summarizeCoverageManifest(
  expectedKeysInput: readonly string[],
  itemsInput: readonly CoverageItemInput[],
) {
  const expectedKeys = [...new Set(expectedKeysInput)].toSorted();
  if (expectedKeys.length === 0 || expectedKeys.some((key) => !key.trim())) {
    throw new Error("At least one valid coverage key is required.");
  }
  const items = itemsInput.map((item) => coverageItemSchema.parse(item));
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.key)) throw new Error("Duplicate coverage item.");
    seen.add(item.key);
  }
  const missingKeys = expectedKeys.filter((key) => !seen.has(key));
  const unexpectedKeys = [...seen]
    .filter((key) => !expectedKeys.includes(key))
    .toSorted();
  return {
    complete: missingKeys.length === 0 && unexpectedKeys.length === 0,
    successful:
      missingKeys.length === 0 &&
      unexpectedKeys.length === 0 &&
      items.every(({ status }) => status !== "error"),
    missingKeys,
    unexpectedKeys,
  };
}

function parseTimestamp(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("Invalid timestamp.");
  return parsed;
}
