import type {
  MatchedOffer,
  PublishedOffer,
  UserWatchRule,
} from "@shopsmart/contracts";
import { resolveRetailerIdentity } from "@shopsmart/connectors";
import { matchOffer, type MatchRejectionReason } from "@shopsmart/domain";

export type SharedPublishedOffer = Readonly<{
  offer: PublishedOffer;
  retailerId: string;
}>;

export interface MatchingFanOutStore {
  listPublishedOffers(): Promise<readonly SharedPublishedOffer[]>;
  listWatchRulesForCanonicalProductClasses(
    canonicalProductClassIds: readonly string[],
  ): Promise<readonly UserWatchRule[]>;
  saveMatchesIdempotently(
    matches: readonly MatchedOffer[],
  ): Promise<Readonly<{ insertedCount: number }>>;
}

export type MatchingFanOutRejectionReason =
  MatchRejectionReason | "UNKNOWN_RETAILER";

export type MatchingFanOutResult = Readonly<{
  evaluatedAt: string;
  publishedOfferCount: number;
  candidatePairCount: number;
  matchedCount: number;
  insertedCount: number;
  duplicateCount: number;
  rejectionCounts: Readonly<
    Partial<Record<MatchingFanOutRejectionReason, number>>
  >;
}>;

export async function runMatchingFanOut(
  store: MatchingFanOutStore,
  evaluatedAt: string,
): Promise<MatchingFanOutResult> {
  assertIsoTimestamp(evaluatedAt);
  const sharedOffers = await store.listPublishedOffers();
  const rejectionCounts: Partial<
    Record<MatchingFanOutRejectionReason, number>
  > = {};
  const knownOffers = sharedOffers.flatMap((sharedOffer) => {
    const retailer = resolveRetailerIdentity(sharedOffer.retailerId);
    if (retailer === null) {
      increment(rejectionCounts, "UNKNOWN_RETAILER");
      return [];
    }
    return [{ ...sharedOffer, retailer }];
  });

  const canonicalProductClassIds = [
    ...new Set(knownOffers.map(({ offer }) => offer.canonicalProductClassId)),
  ].toSorted();
  const rules =
    canonicalProductClassIds.length === 0
      ? []
      : await store.listWatchRulesForCanonicalProductClasses(
          canonicalProductClassIds,
        );
  const rulesByCanonicalProduct = new Map<string, UserWatchRule[]>();
  for (const rule of rules) {
    const matchingRules =
      rulesByCanonicalProduct.get(rule.canonicalProductClassId) ?? [];
    matchingRules.push(rule);
    rulesByCanonicalProduct.set(rule.canonicalProductClassId, matchingRules);
  }

  const matches: MatchedOffer[] = [];
  let candidatePairCount = 0;
  for (const { offer, retailer } of knownOffers) {
    const candidateRules =
      rulesByCanonicalProduct.get(offer.canonicalProductClassId) ?? [];
    for (const rule of candidateRules) {
      candidatePairCount += 1;
      const decision = matchOffer(rule, { offer, retailer }, evaluatedAt);
      if (decision.matched) {
        matches.push(decision.match);
      } else {
        increment(rejectionCounts, decision.reason);
      }
    }
  }

  const { insertedCount } =
    matches.length === 0
      ? { insertedCount: 0 }
      : await store.saveMatchesIdempotently(matches);
  if (insertedCount < 0 || insertedCount > matches.length) {
    throw new Error("Matching store returned an invalid inserted count.");
  }

  return {
    evaluatedAt,
    publishedOfferCount: sharedOffers.length,
    candidatePairCount,
    matchedCount: matches.length,
    insertedCount,
    duplicateCount: matches.length - insertedCount,
    rejectionCounts,
  };
}

function increment(
  counts: Partial<Record<MatchingFanOutRejectionReason, number>>,
  reason: MatchingFanOutRejectionReason,
) {
  counts[reason] = (counts[reason] ?? 0) + 1;
}

function assertIsoTimestamp(value: string) {
  if (
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error("evaluatedAt must be an ISO timestamp.");
  }
}
