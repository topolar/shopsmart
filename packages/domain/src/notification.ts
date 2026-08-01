import { createHash } from "node:crypto";

import {
  matchedOfferSchema,
  notificationDigestPayloadSchema,
  publishedOfferSchema,
  type MatchedOffer,
  type NotificationDigestPayload,
  type PublishedOffer,
} from "@shopsmart/contracts";

import { groupAndSortMatches } from "./matching.js";

type DigestFact = Readonly<{ match: unknown; offer: unknown }>;
type RenderDigestInput = Readonly<{
  tenantId: string;
  intervalKey: string;
  locale: "cs";
  facts: readonly DigestFact[];
}>;

export class InvalidDigestFactsError extends Error {
  readonly code = "INVALID_DIGEST_FACTS";

  constructor(message: string) {
    super(message);
    this.name = "InvalidDigestFactsError";
  }
}

export function renderNotificationDigest(
  input: RenderDigestInput,
): NotificationDigestPayload {
  if (input.facts.length === 0) {
    throw new InvalidDigestFactsError("A digest requires at least one fact.");
  }

  const facts = input.facts.map(({ match: matchInput, offer: offerInput }) => {
    const match = parseMatch(matchInput);
    const offer = parseOffer(offerInput);
    validateFact(input.tenantId, match, offer);
    return { match, offer };
  });
  const factsByMatchId = new Map(
    facts.map((fact) => [fact.match.id, fact] as const),
  );

  return notificationDigestPayloadSchema.parse({
    contractVersion: "1",
    tenantId: input.tenantId,
    intervalKey: input.intervalKey,
    locale: input.locale,
    groups: groupAndSortMatches(facts.map(({ match }) => match)).map(
      (group) => ({
        canonicalProductClassId: group.canonicalProductClassId,
        currency: group.currency,
        comparisonUnit: group.comparisonUnit,
        offers: group.matches.map((match) => {
          const fact = factsByMatchId.get(match.id)!;
          const { offer } = fact;
          return {
            matchId: match.id,
            watchRuleId: match.watchRuleId,
            offerId: offer.id,
            noveltyKey: match.noveltyKey,
            retailer: match.retailer,
            exactName: offer.exactName,
            variantAttributes: offer.variantAttributes,
            package: offer.package,
            price: offer.price,
            regularPrice: offer.regularPrice,
            discountPercent: offer.discountPercent,
            normalizedUnitPrice: match.normalizedUnitPrice,
            membership: offer.membership,
            locality: offer.locality,
            availability: offer.availability,
            validity: offer.validity,
            thresholdReason: match.thresholdReason,
            sourceUrl: offer.evidence.sourceUrl,
            retrievedAt: offer.evidence.retrievedAt,
            evidenceLevel: offer.evidence.level,
          };
        }),
      }),
    ),
  });
}

export function createDigestIdempotencyKey(
  payload: NotificationDigestPayload,
): string {
  const noveltyKeys = payload.groups
    .flatMap(({ offers }) => offers.map(({ noveltyKey }) => noveltyKey))
    .toSorted();
  return `digest:v1:${createHash("sha256")
    .update(
      `${payload.tenantId}:${payload.intervalKey}:${noveltyKeys.join(":")}`,
    )
    .digest("hex")}`;
}

function parseMatch(input: unknown): MatchedOffer {
  const result = matchedOfferSchema.safeParse(input);
  if (!result.success) {
    throw new InvalidDigestFactsError("Digest match is not validated.");
  }
  return result.data;
}

function parseOffer(input: unknown): PublishedOffer {
  const result = publishedOfferSchema.safeParse(input);
  if (!result.success || result.data.evidence.level === "candidate-only") {
    throw new InvalidDigestFactsError(
      "Digest offer evidence is not publishable.",
    );
  }
  return result.data;
}

function validateFact(
  tenantId: string,
  match: MatchedOffer,
  offer: PublishedOffer,
) {
  const normalized = offer.unitPrices.some(
    (price) =>
      price.amount === match.normalizedUnitPrice.amount &&
      price.currency === match.normalizedUnitPrice.currency &&
      price.unit === match.normalizedUnitPrice.unit,
  );
  if (
    match.tenantId !== tenantId ||
    match.offerId !== offer.id ||
    match.canonicalProductClassId !== offer.canonicalProductClassId ||
    match.packagePrice.amount !== offer.price.amount ||
    match.packagePrice.currency !== offer.price.currency ||
    !normalized
  ) {
    throw new InvalidDigestFactsError(
      "Digest match and offer facts are inconsistent.",
    );
  }
}
