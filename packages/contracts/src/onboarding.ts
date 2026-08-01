import { z } from "zod/v4";

const selectionKeySchema = z
  .string()
  .regex(/^[a-z0-9]+(?:[-:][a-z0-9]+)*$/)
  .max(120);

export const onboardingRequestSchema = z
  .object({
    locale: z.literal("cs"),
    locality: z
      .object({
        city: z.string().trim().min(1).max(120),
        region: z.string().trim().min(1).max(120),
        postalCodePrefix: z
          .string()
          .regex(/^\d{3}$/)
          .nullable()
          .default(null),
      })
      .strict(),
    storeIds: z.array(z.uuid()).default([]),
    onlineChannelKeys: z.array(selectionKeySchema).default([]),
    loyaltyPrograms: z.array(selectionKeySchema).default([]),
    notification: z.object({
      emailDigestEnabled: z.boolean(),
      timezone: z.literal("Europe/Prague"),
    }),
  })
  .refine(
    ({ storeIds, onlineChannelKeys }) =>
      storeIds.length > 0 || onlineChannelKeys.length > 0,
    {
      message: "At least one reachable store or online channel is required.",
      path: ["storeIds"],
    },
  );

export const onboardingResponseSchema = onboardingRequestSchema.extend({
  tenantId: z.uuid(),
  completed: z.literal(true),
});

export const tenantAuthorizationErrorSchema = z.object({
  code: z.enum(["UNAUTHENTICATED", "TENANT_SCOPE_VIOLATION"]),
  message: z.string(),
});

export type OnboardingRequest = z.infer<typeof onboardingRequestSchema>;
export type OnboardingResponse = z.infer<typeof onboardingResponseSchema>;
