import {
  publishedOfferSchema,
  qualifiedOfferSchema,
  type PublishedOffer,
} from "@shopsmart/contracts";

export type OfferPublicationErrorCode =
  | "INVALID_OFFER_CONTRACT"
  | "INSUFFICIENT_EVIDENCE"
  | "MISSING_COMPARISON_UNIT";

export class OfferPublicationError extends Error {
  constructor(
    readonly code: OfferPublicationErrorCode,
    message: string,
    readonly issues: readonly string[] = [],
  ) {
    super(message);
    this.name = "OfferPublicationError";
  }
}

export function publishOffer(input: unknown): PublishedOffer {
  const result = qualifiedOfferSchema.safeParse(input);

  if (!result.success) {
    throw new OfferPublicationError(
      "INVALID_OFFER_CONTRACT",
      "Offer does not satisfy the qualified offer contract.",
      result.error.issues.map(
        (issue) => `${issue.path.join(".") || "offer"}: ${issue.message}`,
      ),
    );
  }

  const offer = result.data;
  if (offer.evidence.level === "candidate-only") {
    throw new OfferPublicationError(
      "INSUFFICIENT_EVIDENCE",
      "Candidate-only evidence cannot be published.",
    );
  }

  const comparablePrice = offer.unitPrices.find(
    ({ currency, unit }) =>
      unit === offer.comparisonUnit && currency === offer.price.currency,
  );
  if (!comparablePrice) {
    throw new OfferPublicationError(
      "MISSING_COMPARISON_UNIT",
      "The configured comparison unit price is missing.",
    );
  }

  return publishedOfferSchema.parse({ ...offer, status: "published" });
}
