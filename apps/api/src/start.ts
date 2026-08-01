import {
  createAppDataSource,
  TypeOrmOnboardingStore,
  TypeOrmOffersDashboardStore,
  TypeOrmNormalizationStore,
  TypeOrmAiAssistStore,
} from "@shopsmart/database";

import { buildApp } from "./app.js";
import { createShopSmartAuth } from "./auth.js";

const host = process.env.SHOPSMART_API_HOST ?? "127.0.0.1";
const port = Number(process.env.SHOPSMART_API_PORT ?? "8310");
const dataSource = createAppDataSource();
await dataSource.initialize();
const secret = process.env.BETTER_AUTH_SECRET;
if (!secret) throw new Error("BETTER_AUTH_SECRET is required.");
const publicUrl = process.env.SHOPSMART_PUBLIC_URL ?? "http://127.0.0.1:3310";
const authRuntime = createShopSmartAuth({
  databaseUrl: process.env.DATABASE_URL!,
  dataSource,
  secret,
  baseURL: publicUrl,
  trustedOrigins: [publicUrl],
});

const app = await buildApp(new TypeOrmNormalizationStore(dataSource), {
  auth: authRuntime.auth,
  onboardingStore: new TypeOrmOnboardingStore(dataSource),
  dashboardStore: new TypeOrmOffersDashboardStore(dataSource),
  aiAssistStore: new TypeOrmAiAssistStore(dataSource),
});

const close = async () => {
  await app.close();
  await authRuntime.close();
  await dataSource.destroy();
};

process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());

await app.listen({ host, port });
