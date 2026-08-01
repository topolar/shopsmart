import { z } from "zod/v4";

export const packageUnitSchema = z.enum([
  "gram",
  "kilogram",
  "piece",
  "roll",
  "metre",
  "millilitre",
  "litre",
]);

export const comparisonUnitSchema = z.enum([
  "kilogram",
  "100-gram",
  "250-gram",
  "piece",
  "roll",
  "metre",
  "litre",
]);

const positiveMoneySchema = z
  .string()
  .regex(/^(0|[1-9]\d*)(?:\.\d{1,2})?$/)
  .refine((value) => /[1-9]/.test(value), "Price must be greater than zero.");

const positiveQuantitySchema = z
  .string()
  .regex(/^(0|[1-9]\d*)(?:\.\d{1,6})?$/)
  .refine(
    (value) => /[1-9]/.test(value),
    "Quantity must be greater than zero.",
  );

export const normalizeUnitPriceRequestSchema = z.object({
  packagePrice: positiveMoneySchema,
  currency: z.literal("CZK"),
  packageQuantity: z.object({
    amount: positiveQuantitySchema,
    unit: packageUnitSchema,
  }),
  comparisonUnit: comparisonUnitSchema,
});

export const normalizedUnitPriceSchema = z.object({
  amount: z.string().regex(/^\d+\.\d{2}$/),
  currency: z.literal("CZK"),
  unit: comparisonUnitSchema,
});

export const normalizeUnitPriceResponseSchema = z.object({
  id: z.uuid(),
  normalizedUnitPrice: normalizedUnitPriceSchema,
  createdAt: z.iso.datetime(),
});

export const normalizationErrorSchema = z.object({
  code: z.enum(["INCOMPATIBLE_UNIT", "INVALID_NORMALIZATION_INPUT"]),
  message: z.string(),
});

export type NormalizeUnitPriceRequest = z.infer<
  typeof normalizeUnitPriceRequestSchema
>;
export type NormalizeUnitPriceResponse = z.infer<
  typeof normalizeUnitPriceResponseSchema
>;
