import { z } from "zod/v4";

import {
  moneySchema,
  offerBaseSchema,
  offerEvidenceSchema,
  onlineOfferLocalitySchema,
} from "./offer";

export const onlineOfferCandidateSchema = offerBaseSchema.extend({
  status: z.literal("candidate"),
  channel: z.literal("online"),
  locality: onlineOfferLocalitySchema,
  availability: z.object({
    kind: z.literal("online"),
    stockStatus: z.literal("unknown"),
  }),
  evidence: offerEvidenceSchema,
});

export const onlineStockCheckSchema = z.object({
  candidateId: z.uuid(),
  serviceAreaId: z.uuid(),
  stockStatus: z.enum(["in-stock", "out-of-stock", "unknown"]),
  checkedAt: z.iso.datetime(),
  fulfilment: z.enum(["delivery", "pickup"]),
  fulfilmentDetails: z.string().trim().min(1),
  deliveryFee: moneySchema.nullable().default(null),
  minimumBasket: moneySchema.nullable().default(null),
  fulfilmentWindow: z.string().trim().min(1).nullable().default(null),
  evidenceUrl: z.url().refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }),
});

export const serviceAreaContextSchema = z
  .object({
    serviceAreaId: z.uuid(),
    locality: z
      .object({
        city: z.string().trim().min(1),
        region: z.string().trim().min(1),
        postalCodePrefix: z
          .string()
          .regex(/^\d{3}$/)
          .nullable()
          .default(null),
      })
      .strict(),
    supported: z.boolean(),
    sourceUrl: z.url().refine((value) => {
      const protocol = new URL(value).protocol;
      return protocol === "http:" || protocol === "https:";
    }),
    verifiedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .strict()
  .refine(
    ({ verifiedAt, expiresAt }) =>
      Date.parse(expiresAt) > Date.parse(verifiedAt),
    { message: "Service-area TTL must expire after verification." },
  );

export const tenantServiceAreaLocalitySchema = z
  .object({
    city: z.string().trim().min(1),
    region: z.string().trim().min(1),
    postalCodePrefix: z
      .string()
      .regex(/^\d{3}$/)
      .nullable()
      .default(null),
  })
  .strict();

export type OnlineOfferCandidate = z.infer<typeof onlineOfferCandidateSchema>;
export type OnlineStockCheck = z.infer<typeof onlineStockCheckSchema>;
export type ServiceAreaContext = z.infer<typeof serviceAreaContextSchema>;
