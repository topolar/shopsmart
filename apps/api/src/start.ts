import {
  createAppDataSource,
  TypeOrmFirebaseIdentityStore,
  TypeOrmOnboardingStore,
  TypeOrmOffersDashboardStore,
  TypeOrmNormalizationStore,
  TypeOrmAiAssistStore,
  TypeOrmWatchRuleApplicationStore,
} from "@shopsmart/database";

import { buildApp } from "./app.js";
import { FirebaseSessionAuth } from "./auth.js";
import { createFirebaseAdminGateway } from "./firebase-admin-gateway.js";

const host = process.env.SHOPSMART_API_HOST ?? "127.0.0.1";
const port = Number(process.env.SHOPSMART_API_PORT ?? "8310");
const dataSource = createAppDataSource();
await dataSource.initialize();
const firebaseProjectId = process.env.FIREBASE_PROJECT_ID;
if (!firebaseProjectId) throw new Error("FIREBASE_PROJECT_ID is required.");
const publicUrl = process.env.SHOPSMART_PUBLIC_URL ?? "http://127.0.0.1:3310";
const auth = new FirebaseSessionAuth({
  gateway: createFirebaseAdminGateway(firebaseProjectId),
  identityStore: new TypeOrmFirebaseIdentityStore(dataSource),
});

const app = await buildApp(new TypeOrmNormalizationStore(dataSource), {
  auth,
  publicUrl,
  onboardingStore: new TypeOrmOnboardingStore(dataSource),
  dashboardStore: new TypeOrmOffersDashboardStore(dataSource),
  aiAssistStore: new TypeOrmAiAssistStore(dataSource),
  watchRuleStore: new TypeOrmWatchRuleApplicationStore(dataSource),
});

const close = async () => {
  await app.close();
  await dataSource.destroy();
};

process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());

await app.listen({ host, port });
