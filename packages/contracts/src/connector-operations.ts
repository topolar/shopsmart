import { z } from "zod/v4";

export const earlyRefreshTriggerSchema = z.enum([
  "broken-url",
  "contradiction",
  "official-change",
  "unknown-retailer",
  "explicit-request",
]);

export const coverageItemStatusSchema = z.enum([
  "fetched",
  "unchanged",
  "quarantined",
  "rejected",
  "error",
]);

export const coverageItemSchema = z.object({
  key: z.string().trim().min(1).max(160),
  status: coverageItemStatusSchema,
  candidateCount: z.number().int().nonnegative(),
  offerCount: z.number().int().nonnegative().default(0),
  quarantineCount: z.number().int().nonnegative().default(0),
  reasonCode: z.string().trim().min(1).max(120).nullable().default(null),
});

export const coverageManifestSchema = z.object({
  expectedKeys: z.array(z.string().trim().min(1).max(160)).min(1),
  items: z.array(coverageItemSchema),
});

export type EarlyRefreshTrigger = z.infer<typeof earlyRefreshTriggerSchema>;
export type CoverageItem = z.infer<typeof coverageItemSchema>;
export type CoverageItemInput = z.input<typeof coverageItemSchema>;
