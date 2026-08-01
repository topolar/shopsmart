import {
  createAppDataSource,
  TypeOrmNormalizationStore,
} from "@shopsmart/database";

import { buildApp } from "./app.js";

const host = process.env.SHOPSMART_API_HOST ?? "127.0.0.1";
const port = Number(process.env.SHOPSMART_API_PORT ?? "8310");
const dataSource = createAppDataSource();
await dataSource.initialize();

const app = await buildApp(new TypeOrmNormalizationStore(dataSource));

const close = async () => {
  await app.close();
  await dataSource.destroy();
};

process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());

await app.listen({ host, port });
