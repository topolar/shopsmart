import { z } from "zod/v4";

import { comparisonUnitSchema, packageUnitSchema } from "./unit-price";

export const offerContractVersionSchema = z.literal("1");

const nonEmptyTextSchema = z.string().trim().min(1);
const decimalAmountSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)(?:\.\d{1,6})?$/)
  .refine((value) => /[1-9]/.test(value), "Amount must be greater than zero.");
const currencySchema = z.string().regex(/^[A-Z]{3}$/);
const httpUrlSchema = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
}, "Evidence URLs must use HTTP(S).");

export const productAttributesSchema = z.record(
  nonEmptyTextSchema,
  nonEmptyTextSchema,
);

export const canonicalProductClassSchema = z.object({
  contractVersion: offerContractVersionSchema.default("1"),
  id: z.uuid(),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: nonEmptyTextSchema,
  comparisonUnit: comparisonUnitSchema,
  requiredAttributes: productAttributesSchema.default({}),
  excludedAttributes: productAttributesSchema.default({}),
});

export const retailerProductSchema = z.object({
  contractVersion: offerContractVersionSchema.default("1"),
  id: z.uuid(),
  retailerId: z.uuid(),
  externalId: nonEmptyTextSchema,
  canonicalProductClassId: z.uuid().nullable(),
  exactName: nonEmptyTextSchema,
  variantAttributes: productAttributesSchema.default({}),
});

export const offerPackageSchema = z.object({
  declared: nonEmptyTextSchema,
  quantity: z.object({
    amount: decimalAmountSchema,
    unit: packageUnitSchema,
  }),
  count: z.number().int().positive(),
});

export const moneySchema = z.object({
  amount: decimalAmountSchema,
  currency: currencySchema,
});

export const comparableUnitPriceSchema = moneySchema.extend({
  unit: comparisonUnitSchema,
});

export const membershipConditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({
    kind: z.literal("loyalty"),
    program: nonEmptyTextSchema,
  }),
  z.object({
    kind: z.literal("app"),
    program: nonEmptyTextSchema,
  }),
  z.object({
    kind: z.literal("coupon"),
    description: nonEmptyTextSchema,
  }),
]);

export const physicalOfferLocalitySchema = z.object({
  kind: z.literal("physical"),
  storeId: z.uuid(),
  applicability: z.enum(["store", "region", "national"]),
});

export const onlineOfferLocalitySchema = z.object({
  kind: z.literal("online"),
  serviceAreaId: z.uuid(),
  fulfilment: z.enum(["delivery", "pickup"]),
});

export const offerLocalitySchema = z.discriminatedUnion("kind", [
  physicalOfferLocalitySchema,
  onlineOfferLocalitySchema,
]);

export const offerAvailabilitySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("physical"),
    evidence: z.literal("flyer-applicability"),
    stockStatus: z.literal("not-asserted").default("not-asserted"),
  }),
  z.object({
    kind: z.literal("online"),
    stockStatus: z.literal("in-stock"),
    checkedAt: z.iso.datetime(),
    fulfilmentDetails: nonEmptyTextSchema,
    deliveryFee: moneySchema.nullable().optional(),
    minimumBasket: moneySchema.nullable().optional(),
    fulfilmentWindow: nonEmptyTextSchema.nullable().optional(),
    stockEvidenceUrl: httpUrlSchema.optional(),
  }),
]);

export const offerValiditySchema = z
  .object({
    validFrom: z.iso.datetime(),
    validTo: z.iso.datetime().nullable().default(null),
  })
  .refine(
    ({ validFrom, validTo }) =>
      validTo === null || Date.parse(validTo) >= Date.parse(validFrom),
    { message: "validTo must not precede validFrom.", path: ["validTo"] },
  );

export const offerEvidenceSchema = z
  .object({
    level: z.enum(["official", "cross-checked", "candidate-only"]),
    sourceUrl: httpUrlSchema,
    verificationUrls: z.array(httpUrlSchema).default([]),
    retrievedAt: z.iso.datetime(),
  })
  .refine(
    ({ level, verificationUrls }) =>
      level !== "cross-checked" || verificationUrls.length > 0,
    {
      message: "Cross-checked evidence requires a verification URL.",
      path: ["verificationUrls"],
    },
  );

export const offerStatusSchema = z.enum([
  "candidate",
  "qualified",
  "published",
  "quarantined",
  "expired",
]);

const offerFields = {
  contractVersion: offerContractVersionSchema.default("1"),
  id: z.uuid(),
  retailerProductId: z.uuid(),
  sourceScopeId: z.uuid(),
  canonicalProductClassId: z.uuid(),
  exactName: nonEmptyTextSchema,
  variantAttributes: productAttributesSchema.default({}),
  package: offerPackageSchema,
  price: moneySchema,
  regularPrice: moneySchema.nullable().default(null),
  discountPercent: z.number().min(0).max(100).nullable().default(null),
  comparisonUnit: comparisonUnitSchema,
  unitPrices: z.array(comparableUnitPriceSchema).min(1),
  membership: membershipConditionSchema,
  channel: z.enum(["physical", "online"]),
  locality: offerLocalitySchema,
  availability: offerAvailabilitySchema,
  validity: offerValiditySchema,
  evidence: offerEvidenceSchema,
  parserVersion: nonEmptyTextSchema,
} as const;

export const offerBaseSchema = z.object(offerFields);

export const qualifiedOfferSchema = offerBaseSchema
  .extend({ status: z.literal("qualified") })
  .superRefine(validateChannelLocality);

export const publishedOfferSchema = offerBaseSchema
  .extend({ status: z.literal("published") })
  .superRefine(validateChannelLocality);

function validateChannelLocality(
  offer: {
    channel: "physical" | "online";
    locality: z.infer<typeof offerLocalitySchema>;
    availability: z.infer<typeof offerAvailabilitySchema>;
    price: z.infer<typeof moneySchema>;
    regularPrice: z.infer<typeof moneySchema> | null;
    discountPercent: number | null;
  },
  context: z.RefinementCtx,
) {
  if (offer.channel !== offer.locality.kind) {
    context.addIssue({
      code: "custom",
      message: "Offer channel and locality kind must match.",
      path: ["locality", "kind"],
    });
  }
  if (offer.channel !== offer.availability.kind) {
    context.addIssue({
      code: "custom",
      message: "Offer channel and availability kind must match.",
      path: ["availability", "kind"],
    });
  }
  if (
    offer.regularPrice !== null &&
    offer.regularPrice.currency !== offer.price.currency
  ) {
    context.addIssue({
      code: "custom",
      message: "Offer and regular prices must use the same currency.",
      path: ["regularPrice", "currency"],
    });
  }
  if (offer.discountPercent !== null && offer.regularPrice === null) {
    context.addIssue({
      code: "custom",
      message: "A discount percentage requires a regular price.",
      path: ["discountPercent"],
    });
  }
}

export type CanonicalProductClass = z.infer<typeof canonicalProductClassSchema>;
export type RetailerProduct = z.infer<typeof retailerProductSchema>;
export type QualifiedOffer = z.infer<typeof qualifiedOfferSchema>;
export type PublishedOffer = z.infer<typeof publishedOfferSchema>;
