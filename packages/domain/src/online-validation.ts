import {
  onlineOfferCandidateSchema,
  onlineStockCheckSchema,
  publishedOfferSchema,
  serviceAreaContextSchema,
  tenantServiceAreaLocalitySchema,
  type MatchedOffer,
  type OnlineOfferCandidate,
  type OnlineStockCheck,
  type PublishedOffer,
  type ServiceAreaContext,
  type UserWatchRule,
} from "@shopsmart/contracts";

import {
  evaluateMatchPrerequisites,
  matchOffer,
  type MatchRejectionReason,
} from "./matching.js";

export type OnlineValidationReason =
  | "CANDIDATE_CHECK_MISMATCH"
  | "LOCALITY_CHECK_MISMATCH"
  | "FULFILMENT_MISMATCH"
  | "OUT_OF_STOCK"
  | "STALE_STOCK_CHECK"
  | "FUTURE_STOCK_CHECK"
  | "CURRENCY_MISMATCH"
  | "INSUFFICIENT_EVIDENCE";

export type PrequalifiedOnlineCandidate = Readonly<{
  eligible: true;
  candidate: OnlineOfferCandidate;
  retailer: Readonly<{ id: string; name: string }>;
  rule: UserWatchRule;
  evaluatedAt: string;
}>;

export type OnlinePrequalificationDecision =
  | PrequalifiedOnlineCandidate
  | { eligible: false; reason: MatchRejectionReason };

export type OnlineConfirmationDecision =
  | { confirmed: true; offer: PublishedOffer; match: MatchedOffer }
  | { confirmed: false; reason: OnlineValidationReason | MatchRejectionReason };

export function prequalifyOnlineCandidate(
  ruleInput: unknown,
  candidateInput: unknown,
  retailer: Readonly<{ id: string; name: string }>,
  evaluatedAt: string,
): OnlinePrequalificationDecision {
  const candidate = onlineOfferCandidateSchema.parse(candidateInput);
  const prerequisite = evaluateMatchPrerequisites(
    ruleInput,
    candidate,
    retailer,
    evaluatedAt,
  );
  if (!prerequisite.eligible) return prerequisite;
  return {
    eligible: true,
    candidate,
    retailer,
    rule: prerequisite.rule,
    evaluatedAt,
  };
}

export function confirmOnlineCandidate(
  prequalified: PrequalifiedOnlineCandidate,
  stockCheckInput: unknown,
  maxStockAgeSeconds = 15 * 60,
): OnlineConfirmationDecision {
  const stockCheck = onlineStockCheckSchema.parse(stockCheckInput);
  const { candidate, evaluatedAt } = prequalified;
  if (stockCheck.candidateId !== candidate.id)
    return reject("CANDIDATE_CHECK_MISMATCH");
  if (stockCheck.serviceAreaId !== candidate.locality.serviceAreaId)
    return reject("LOCALITY_CHECK_MISMATCH");
  if (stockCheck.fulfilment !== candidate.locality.fulfilment)
    return reject("FULFILMENT_MISMATCH");
  if (stockCheck.stockStatus !== "in-stock") return reject("OUT_OF_STOCK");

  const checkedAt = Date.parse(stockCheck.checkedAt);
  const evaluated = Date.parse(evaluatedAt);
  if (checkedAt > evaluated) return reject("FUTURE_STOCK_CHECK");
  if (evaluated - checkedAt > maxStockAgeSeconds * 1_000)
    return reject("STALE_STOCK_CHECK");
  if (!hasMatchingCurrency(candidate, stockCheck))
    return reject("CURRENCY_MISMATCH");
  if (candidate.evidence.level === "candidate-only")
    return reject("INSUFFICIENT_EVIDENCE");

  const offer = publishedOfferSchema.parse({
    ...candidate,
    status: "published",
    availability: {
      kind: "online",
      stockStatus: "in-stock",
      checkedAt: stockCheck.checkedAt,
      fulfilmentDetails: stockCheck.fulfilmentDetails,
      deliveryFee: stockCheck.deliveryFee,
      minimumBasket: stockCheck.minimumBasket,
      fulfilmentWindow: stockCheck.fulfilmentWindow,
      stockEvidenceUrl: stockCheck.evidenceUrl,
    },
  });
  const matchDecision = matchOffer(
    prequalified.rule,
    { offer, retailer: prequalified.retailer },
    evaluatedAt,
  );
  if (!matchDecision.matched) {
    return { confirmed: false, reason: matchDecision.reason };
  }
  return { confirmed: true, offer, match: matchDecision.match };
}

export function isServiceAreaContextUsable(
  contextInput: unknown,
  localityInput: unknown,
  now: string,
): boolean {
  const contextResult = serviceAreaContextSchema.safeParse(contextInput);
  const localityResult =
    tenantServiceAreaLocalitySchema.safeParse(localityInput);
  const nowValue = Date.parse(now);
  if (
    !contextResult.success ||
    !localityResult.success ||
    !Number.isFinite(nowValue)
  )
    return false;
  const context: ServiceAreaContext = contextResult.data;
  const locality = localityResult.data;
  return (
    context.supported &&
    Date.parse(context.verifiedAt) <= nowValue &&
    Date.parse(context.expiresAt) > nowValue &&
    context.locality.city === locality.city &&
    context.locality.region === locality.region &&
    (context.locality.postalCodePrefix === null ||
      context.locality.postalCodePrefix === locality.postalCodePrefix)
  );
}

function hasMatchingCurrency(
  candidate: OnlineOfferCandidate,
  stockCheck: OnlineStockCheck,
): boolean {
  return [stockCheck.deliveryFee, stockCheck.minimumBasket].every(
    (money) => money === null || money.currency === candidate.price.currency,
  );
}

function reject(reason: OnlineValidationReason): OnlineConfirmationDecision {
  return { confirmed: false, reason };
}
