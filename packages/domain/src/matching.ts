import { createHash } from "node:crypto";

import {
  matchedOfferSchema,
  userWatchRuleSchema,
  type MatchedOffer,
  type PublishedOffer,
  type ThresholdReason,
  type UserWatchRule,
  type WatchThreshold,
} from "@shopsmart/contracts";

export type MatchRejectionReason =
  | "CANONICAL_PRODUCT_MISMATCH"
  | "REQUIRED_ATTRIBUTE_MISMATCH"
  | "EXCLUDED_ATTRIBUTE"
  | "CHANNEL_NOT_ACCEPTED"
  | "LOCALITY_NOT_REACHABLE"
  | "MEMBERSHIP_NOT_ACCEPTED"
  | "OFFER_NOT_ACTIVE"
  | "INCOMPATIBLE_COMPARISON_UNIT"
  | "CURRENCY_MISMATCH"
  | "THRESHOLD_NOT_MET";

export type MatchDecision =
  | { matched: true; match: MatchedOffer }
  | { matched: false; reason: MatchRejectionReason };

export type MatchableOffer = Readonly<{
  offer: PublishedOffer;
  retailer: Readonly<{ id: string; name: string }>;
}>;

export type MatchGroup = Readonly<{
  canonicalProductClassId: string;
  comparisonUnit: MatchedOffer["normalizedUnitPrice"]["unit"];
  currency: string;
  matches: readonly MatchedOffer[];
}>;

export function matchOffer(
  ruleInput: unknown,
  candidate: MatchableOffer,
  evaluatedAt: string,
): MatchDecision {
  const rule = userWatchRuleSchema.parse(ruleInput);
  const { offer, retailer } = candidate;

  if (offer.canonicalProductClassId !== rule.canonicalProductClassId) {
    return reject("CANONICAL_PRODUCT_MISMATCH");
  }
  if (!hasRequiredAttributes(rule, offer)) {
    return reject("REQUIRED_ATTRIBUTE_MISMATCH");
  }
  if (hasExcludedAttribute(rule, offer)) {
    return reject("EXCLUDED_ATTRIBUTE");
  }
  if (!rule.channels.includes(offer.channel)) {
    return reject("CHANNEL_NOT_ACCEPTED");
  }
  if (!isLocalityReachable(rule, offer)) {
    return reject("LOCALITY_NOT_REACHABLE");
  }
  if (!isMembershipAccepted(rule, offer)) {
    return reject("MEMBERSHIP_NOT_ACCEPTED");
  }
  if (!isActiveAt(offer, evaluatedAt)) {
    return reject("OFFER_NOT_ACTIVE");
  }
  if (offer.comparisonUnit !== rule.comparisonUnit) {
    return reject("INCOMPATIBLE_COMPARISON_UNIT");
  }

  const normalizedUnitPrice = offer.unitPrices.find(
    ({ currency, unit }) =>
      unit === rule.comparisonUnit && currency === offer.price.currency,
  );
  if (!normalizedUnitPrice) {
    return reject("CURRENCY_MISMATCH");
  }

  const preferred = rule.preferredRetailerIds.includes(retailer.id);
  const scope = preferred ? "preferred" : "fallback";
  const threshold = preferred
    ? rule.preferredThreshold
    : rule.fallbackThreshold;
  const thresholdDecision = evaluateThreshold(
    threshold,
    scope,
    normalizedUnitPrice,
    offer,
  );
  if (thresholdDecision === "CURRENCY_MISMATCH") {
    return reject("CURRENCY_MISMATCH");
  }
  if (thresholdDecision === null) {
    return reject("THRESHOLD_NOT_MET");
  }

  const noveltyKey = createOfferNoveltyKey(offer, retailer.id);
  return {
    matched: true,
    match: matchedOfferSchema.parse({
      id: createMatchId(rule, noveltyKey),
      tenantId: rule.tenantId,
      watchRuleId: rule.id,
      offerId: offer.id,
      canonicalProductClassId: offer.canonicalProductClassId,
      normalizedUnitPrice,
      packagePrice: offer.price,
      retailer,
      thresholdReason: thresholdDecision,
      noveltyKey,
      evaluatedAt,
    }),
  };
}

export function createOfferNoveltyKey(
  offer: PublishedOffer,
  retailerId: string,
): string {
  const materialIdentity = {
    retailerId,
    retailerProductId: offer.retailerProductId,
    canonicalProductClassId: offer.canonicalProductClassId,
    package: offer.package,
    price: offer.price,
    regularPrice: offer.regularPrice,
    discountPercent: offer.discountPercent,
    channel: offer.channel,
    locality: offer.locality,
    validity: offer.validity,
    membership: offer.membership,
  };
  const digest = createHash("sha256")
    .update(JSON.stringify(materialIdentity))
    .digest("hex");
  return `offer-novelty:v1:${digest}`;
}

export function groupAndSortMatches(
  matches: readonly MatchedOffer[],
): MatchGroup[] {
  const groups = new Map<string, MatchedOffer[]>();
  for (const matchInput of matches) {
    const match = matchedOfferSchema.parse(matchInput);
    const key = [
      match.canonicalProductClassId,
      match.normalizedUnitPrice.currency,
      match.normalizedUnitPrice.unit,
    ].join(":");
    const group = groups.get(key) ?? [];
    group.push(match);
    groups.set(key, group);
  }

  return [...groups.values()]
    .map((group) => ({
      canonicalProductClassId: group[0]!.canonicalProductClassId,
      comparisonUnit: group[0]!.normalizedUnitPrice.unit,
      currency: group[0]!.normalizedUnitPrice.currency,
      matches: group.toSorted(compareMatches),
    }))
    .toSorted((left, right) =>
      compareText(
        `${left.canonicalProductClassId}:${left.currency}:${left.comparisonUnit}`,
        `${right.canonicalProductClassId}:${right.currency}:${right.comparisonUnit}`,
      ),
    );
}

function hasRequiredAttributes(
  rule: UserWatchRule,
  offer: PublishedOffer,
): boolean {
  return Object.entries(rule.requiredAttributes).every(
    ([name, expected]) => offer.variantAttributes[name] === expected,
  );
}

function hasExcludedAttribute(
  rule: UserWatchRule,
  offer: PublishedOffer,
): boolean {
  return Object.entries(rule.excludedAttributes).some(([name, excluded]) => {
    const actual = offer.variantAttributes[name];
    return actual !== undefined && excluded.includes(actual);
  });
}

function isLocalityReachable(
  rule: UserWatchRule,
  offer: PublishedOffer,
): boolean {
  if (offer.locality.kind === "physical") {
    return rule.storeIds.includes(offer.locality.storeId);
  }
  return rule.serviceAreaIds.includes(offer.locality.serviceAreaId);
}

function isMembershipAccepted(
  rule: UserWatchRule,
  offer: PublishedOffer,
): boolean {
  if (offer.membership.kind === "none") return true;
  const membershipKey =
    offer.membership.kind === "coupon"
      ? `coupon:${offer.membership.description}`
      : `${offer.membership.kind}:${offer.membership.program}`;
  return rule.acceptedMemberships.includes(membershipKey);
}

function isActiveAt(offer: PublishedOffer, evaluatedAt: string): boolean {
  const evaluated = Date.parse(evaluatedAt);
  const start = Date.parse(offer.validity.validFrom);
  const end =
    offer.validity.validTo === null
      ? Number.POSITIVE_INFINITY
      : Date.parse(offer.validity.validTo);
  return Number.isFinite(evaluated) && evaluated >= start && evaluated <= end;
}

function evaluateThreshold(
  threshold: WatchThreshold,
  scope: ThresholdReason["scope"],
  unitPrice: PublishedOffer["unitPrices"][number],
  offer: PublishedOffer,
): ThresholdReason | "CURRENCY_MISMATCH" | null {
  if (threshold.maxUnitPrice !== null) {
    if (threshold.maxUnitPrice.currency !== unitPrice.currency) {
      return "CURRENCY_MISMATCH";
    }
    if (compareDecimal(unitPrice.amount, threshold.maxUnitPrice.amount) <= 0) {
      return {
        scope,
        predicate: "max-unit-price",
        actual: unitPrice.amount,
        limit: threshold.maxUnitPrice.amount,
      };
    }
  }
  if (
    threshold.minDiscountPercent !== null &&
    offer.discountPercent !== null &&
    compareDecimal(
      offer.discountPercent.toString(),
      threshold.minDiscountPercent,
    ) >= 0
  ) {
    return {
      scope,
      predicate: "min-discount-percent",
      actual: offer.discountPercent.toString(),
      limit: threshold.minDiscountPercent,
    };
  }
  return null;
}

function compareMatches(left: MatchedOffer, right: MatchedOffer): number {
  return (
    compareDecimal(
      left.normalizedUnitPrice.amount,
      right.normalizedUnitPrice.amount,
    ) ||
    compareDecimal(left.packagePrice.amount, right.packagePrice.amount) ||
    compareText(left.retailer.name, right.retailer.name) ||
    compareText(left.id, right.id)
  );
}

function compareDecimal(left: string, right: string): number {
  const leftDecimal = parseDecimal(left);
  const rightDecimal = parseDecimal(right);
  const denominator =
    leftDecimal.denominator > rightDecimal.denominator
      ? leftDecimal.denominator
      : rightDecimal.denominator;
  const normalizedLeft =
    leftDecimal.numerator * (denominator / leftDecimal.denominator);
  const normalizedRight =
    rightDecimal.numerator * (denominator / rightDecimal.denominator);
  return normalizedLeft < normalizedRight
    ? -1
    : normalizedLeft > normalizedRight
      ? 1
      : 0;
}

function parseDecimal(value: string) {
  const [whole = "0", fraction = ""] = value.split(".");
  const denominator = 10n ** BigInt(fraction.length);
  return {
    numerator: BigInt(whole) * denominator + BigInt(fraction || "0"),
    denominator,
  };
}

function createMatchId(rule: UserWatchRule, noveltyKey: string): string {
  return createHash("sha256")
    .update(`match:v1:${rule.tenantId}:${rule.id}:${noveltyKey}`)
    .digest("hex");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function reject(reason: MatchRejectionReason): MatchDecision {
  return { matched: false, reason };
}
