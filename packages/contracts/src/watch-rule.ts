import { z } from "zod/v4";

import {
  comparableUnitPriceSchema,
  moneySchema,
  offerContractVersionSchema,
  productAttributesSchema,
} from "./offer";
import { comparisonUnitSchema } from "./unit-price";

const percentageSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d?)(?:\.\d{1,2})?$|^100(?:\.0{1,2})?$/);

export const attributeExclusionsSchema = z.record(
  z.string().trim().min(1),
  z.array(z.string().trim().min(1)).min(1),
);

export const watchThresholdSchema = z
  .object({
    maxUnitPrice: comparableUnitPriceSchema.nullable().default(null),
    minDiscountPercent: percentageSchema.nullable().default(null),
  })
  .refine(
    ({ maxUnitPrice, minDiscountPercent }) =>
      maxUnitPrice !== null || minDiscountPercent !== null,
    "At least one threshold predicate is required.",
  );

export const userWatchRuleSchema = z
  .object({
    contractVersion: offerContractVersionSchema.default("1"),
    id: z.uuid(),
    tenantId: z.uuid(),
    canonicalProductClassId: z.uuid(),
    requiredAttributes: productAttributesSchema.default({}),
    excludedAttributes: attributeExclusionsSchema.default({}),
    comparisonUnit: comparisonUnitSchema,
    preferredRetailerIds: z.array(z.uuid()).default([]),
    preferredThreshold: watchThresholdSchema,
    fallbackThreshold: watchThresholdSchema,
    acceptedMemberships: z.array(z.string().trim().min(1)).default([]),
    channels: z.array(z.enum(["physical", "online"])).min(1),
    storeIds: z.array(z.uuid()).default([]),
    serviceAreaIds: z.array(z.uuid()).default([]),
  })
  .superRefine((rule, context) => {
    for (const [name, threshold] of [
      ["preferredThreshold", rule.preferredThreshold],
      ["fallbackThreshold", rule.fallbackThreshold],
    ] as const) {
      if (
        threshold.maxUnitPrice !== null &&
        threshold.maxUnitPrice.unit !== rule.comparisonUnit
      ) {
        context.addIssue({
          code: "custom",
          message: "Threshold unit must equal the watch rule comparison unit.",
          path: [name, "maxUnitPrice", "unit"],
        });
      }
    }
  });

export const thresholdReasonSchema = z.discriminatedUnion("predicate", [
  z.object({
    scope: z.enum(["preferred", "fallback"]),
    predicate: z.literal("max-unit-price"),
    actual: z.string(),
    limit: z.string(),
  }),
  z.object({
    scope: z.enum(["preferred", "fallback"]),
    predicate: z.literal("min-discount-percent"),
    actual: z.string(),
    limit: z.string(),
  }),
]);

export const matchedOfferSchema = z.object({
  id: z.string().min(1),
  tenantId: z.uuid(),
  watchRuleId: z.uuid(),
  offerId: z.uuid(),
  canonicalProductClassId: z.uuid(),
  normalizedUnitPrice: comparableUnitPriceSchema,
  packagePrice: moneySchema,
  retailer: z.object({ id: z.uuid(), name: z.string().trim().min(1) }),
  thresholdReason: thresholdReasonSchema,
  noveltyKey: z.string().regex(/^offer-novelty:v1:[a-f0-9]{64}$/),
  evaluatedAt: z.iso.datetime(),
});

export type UserWatchRule = z.infer<typeof userWatchRuleSchema>;
export type WatchThreshold = z.infer<typeof watchThresholdSchema>;
export type ThresholdReason = z.infer<typeof thresholdReasonSchema>;
export type MatchedOffer = z.infer<typeof matchedOfferSchema>;
