import { randomUUID } from "node:crypto";

import { TenantRecord, type createAppDataSource } from "@shopsmart/database";
import { betterAuth } from "better-auth";
import { Pool } from "pg";

type AuthOptions = Readonly<{
  databaseUrl: string;
  dataSource: ReturnType<typeof createAppDataSource>;
  secret: string;
  baseURL: string;
  trustedOrigins: readonly string[];
  rateLimitEnabled?: boolean;
}>;

export function createShopSmartAuth(options: AuthOptions) {
  const pool = new Pool({ connectionString: options.databaseUrl });
  const auth = betterAuth({
    appName: "ShopSmart",
    database: pool,
    secret: options.secret,
    baseURL: options.baseURL,
    trustedOrigins: [...options.trustedOrigins],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    user: {
      additionalFields: {
        tenantId: {
          type: "string",
          required: false,
          input: false,
        },
        role: {
          type: "string",
          required: false,
          input: false,
          defaultValue: "user",
        },
      },
    },
    advanced: {
      cookiePrefix: "shopsmart",
    },
    rateLimit: {
      enabled: options.rateLimitEnabled ?? true,
      window: 60,
      max: 100,
    },
    logger: { disabled: true },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const tenantId = randomUUID();
            await options.dataSource.getRepository(TenantRecord).save({
              id: tenantId,
              name: "Personal tenant",
            });
            return {
              data: {
                ...user,
                tenantId,
                role: "user",
              },
            };
          },
        },
      },
    },
  });

  return {
    auth,
    close: () => pool.end(),
  };
}

export type ShopSmartAuth = ReturnType<typeof createShopSmartAuth>["auth"];
