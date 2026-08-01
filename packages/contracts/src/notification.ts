import { z } from "zod/v4";

import {
  membershipConditionSchema,
  moneySchema,
  offerAvailabilitySchema,
  offerLocalitySchema,
  offerPackageSchema,
  offerValiditySchema,
} from "./offer";
import { matchedOfferSchema, thresholdReasonSchema } from "./watch-rule";

export const notificationOutboxStatusSchema = z.enum([
  "pending",
  "processing",
  "awaiting-confirmation",
  "retry",
  "delivered",
  "bounced",
  "suppressed",
  "unsubscribed",
  "dead-letter",
]);

export const notificationDeliveryStatusSchema = z.enum([
  "accepted",
  "provider-confirmed",
  "bounced",
  "suppressed",
]);

export const digestOfferSchema = z.object({
  matchId: z.string().min(1),
  watchRuleId: z.uuid(),
  offerId: z.uuid(),
  noveltyKey: matchedOfferSchema.shape.noveltyKey,
  retailer: matchedOfferSchema.shape.retailer,
  exactName: z.string().trim().min(1),
  variantAttributes: z.record(z.string(), z.string()),
  package: offerPackageSchema,
  price: moneySchema,
  regularPrice: moneySchema.nullable(),
  discountPercent: z.number().nullable(),
  normalizedUnitPrice: matchedOfferSchema.shape.normalizedUnitPrice,
  membership: membershipConditionSchema,
  locality: offerLocalitySchema,
  availability: offerAvailabilitySchema,
  validity: offerValiditySchema,
  thresholdReason: thresholdReasonSchema,
  sourceUrl: z.url(),
  retrievedAt: z.iso.datetime(),
  evidenceLevel: z.enum(["official", "cross-checked"]),
});

export const notificationDigestPayloadSchema = z.object({
  contractVersion: z.literal("1"),
  tenantId: z.uuid(),
  intervalKey: z.string().trim().min(1).max(160),
  locale: z.literal("cs"),
  groups: z
    .array(
      z.object({
        canonicalProductClassId: z.uuid(),
        currency: z.string().regex(/^[A-Z]{3}$/),
        comparisonUnit: matchedOfferSchema.shape.normalizedUnitPrice.shape.unit,
        offers: z.array(digestOfferSchema).min(1),
      }),
    )
    .min(1),
});

export type NotificationDigestPayload = z.infer<
  typeof notificationDigestPayloadSchema
>;
export type NotificationOutboxStatus = z.infer<
  typeof notificationOutboxStatusSchema
>;
