import { z } from "zod/v4";

const httpsUrlSchema = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === "https:", {
    message: "Connector entry URLs must use HTTPS.",
  });

export const connectorScopeManifestSchema = z
  .object({
    key: z.string().trim().min(1).max(240),
    entryUrl: httpsUrlSchema,
    requiredCoverageKeys: z.array(z.string().trim().min(1).max(160)).min(1),
    refreshIntervalSeconds: z.number().int().positive().max(604_800),
    leaseSeconds: z.number().int().positive().max(7_200),
    maxAttempts: z.number().int().positive().max(10),
    minimumRateLimitPauseSeconds: z.number().int().nonnegative().max(604_800),
    rawRetentionSeconds: z.number().int().positive().max(2_592_000),
  })
  .strict()
  .superRefine((scope, context) => {
    if (!scope.requiredCoverageKeys.includes(scope.key)) {
      context.addIssue({
        code: "custom",
        path: ["requiredCoverageKeys"],
        message: "A source scope must explicitly cover itself.",
      });
    }
  });

export const connectorManifestSchema = z
  .object({
    contractVersion: z.literal("1"),
    connectorId: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9-]{1,63}$/),
    displayName: z.string().trim().min(1).max(120),
    country: z.literal("CZ"),
    parserVersion: z.string().trim().min(1).max(120),
    contentKind: z.enum(["html", "pdf", "json"]),
    capabilities: z
      .object({
        conditionalRequests: z.boolean(),
        retainedSnapshotReprocess: z.boolean(),
        physicalOffers: z.boolean(),
        onlineStock: z.boolean(),
      })
      .strict(),
    scopes: z.array(connectorScopeManifestSchema).min(1),
  })
  .strict()
  .superRefine((manifest, context) => {
    const keys = manifest.scopes.map(({ key }) => key);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: "custom",
        path: ["scopes"],
        message: "Connector source scope keys must be unique.",
      });
    }
    for (const [index, key] of keys.entries()) {
      if (!key.startsWith(`${manifest.connectorId}:cz:`)) {
        context.addIssue({
          code: "custom",
          path: ["scopes", index, "key"],
          message: "Source scope keys must belong to the Czech connector.",
        });
      }
    }
  });

export type ConnectorManifest = z.infer<typeof connectorManifestSchema>;
export type ConnectorScopeManifest = z.infer<
  typeof connectorScopeManifestSchema
>;
