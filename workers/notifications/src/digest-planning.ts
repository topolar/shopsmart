import type { NotificationDigestPayload } from "@shopsmart/contracts";
import {
  InvalidDigestFactsError,
  renderNotificationDigest,
} from "@shopsmart/domain";

export type DigestPlanningCandidate = Readonly<{
  tenantId: string;
  recipientEmails: readonly string[];
  facts: readonly Readonly<{ match: unknown; offer: unknown }>[];
}>;

export interface DigestPlanningStore {
  listCandidates(): Promise<readonly DigestPlanningCandidate[]>;
  enqueue(
    recipientEmail: string,
    payload: NotificationDigestPayload,
  ): Promise<boolean>;
}

export type DigestPlanningSkipReason =
  "MISSING_RECIPIENT" | "AMBIGUOUS_RECIPIENT" | "INVALID_FACTS";

type DigestRenderer = (input: {
  tenantId: string;
  intervalKey: string;
  locale: "cs";
  facts: readonly Readonly<{ match: unknown; offer: unknown }>[];
}) => NotificationDigestPayload;

export async function runDigestPlanning(
  store: DigestPlanningStore,
  intervalKey: string,
  render: DigestRenderer = renderNotificationDigest,
) {
  assertIntervalKey(intervalKey);
  const candidates = await store.listCandidates();
  const skippedCounts: Partial<Record<DigestPlanningSkipReason, number>> = {};
  let enqueuedCount = 0;
  let silentCount = 0;

  for (const candidate of candidates) {
    const recipients = [...new Set(candidate.recipientEmails)];
    if (recipients.length === 0) {
      increment(skippedCounts, "MISSING_RECIPIENT");
      continue;
    }
    if (recipients.length !== 1) {
      increment(skippedCounts, "AMBIGUOUS_RECIPIENT");
      continue;
    }

    let payload: NotificationDigestPayload;
    try {
      payload = render({
        tenantId: candidate.tenantId,
        intervalKey,
        locale: "cs",
        facts: candidate.facts,
      });
    } catch (error) {
      if (!(error instanceof InvalidDigestFactsError)) throw error;
      increment(skippedCounts, "INVALID_FACTS");
      continue;
    }
    if (await store.enqueue(recipients[0]!, payload)) {
      enqueuedCount += 1;
    } else {
      silentCount += 1;
    }
  }

  return {
    intervalKey,
    candidateTenantCount: candidates.length,
    candidateFactCount: candidates.reduce(
      (count, candidate) => count + candidate.facts.length,
      0,
    ),
    enqueuedCount,
    silentCount,
    skippedCounts,
  };
}

function increment(
  counts: Partial<Record<DigestPlanningSkipReason, number>>,
  reason: DigestPlanningSkipReason,
) {
  counts[reason] = (counts[reason] ?? 0) + 1;
}

function assertIntervalKey(value: string) {
  if (value.trim() !== value || value.length === 0 || value.length > 160) {
    throw new Error(
      "intervalKey must be a non-empty stable key up to 160 chars.",
    );
  }
}
