import { z } from "zod/v4";

import { digestOfferSchema } from "./notification";
import { comparisonUnitSchema } from "./unit-price";

export const offersDashboardOfferSchema = digestOfferSchema.extend({
  localityName: z.string().trim().min(1),
});

export const offersDashboardGroupSchema = z.object({
  canonicalProductClassId: z.uuid(),
  canonicalProductClassName: z.string().trim().min(1),
  currency: z.string().regex(/^[A-Z]{3}$/),
  comparisonUnit: comparisonUnitSchema,
  offers: z.array(offersDashboardOfferSchema).min(1),
});

export const offersDashboardResponseSchema = z.object({
  contractVersion: z.literal("1"),
  tenantId: z.uuid(),
  groups: z.array(offersDashboardGroupSchema),
});

export type OffersDashboardResponse = z.infer<
  typeof offersDashboardResponseSchema
>;
