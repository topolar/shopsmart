import { createAppDataSource, TypeOrmOperatorStore } from "@shopsmart/database";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const usage = "Usage: grant --email <existing-account-email>";
if (args.length !== 3 || args[0] !== "grant" || args[1] !== "--email") {
  throw new Error(usage);
}

const dataSource = createAppDataSource();
await dataSource.initialize();
try {
  await dataSource.runMigrations();
  const result = await new TypeOrmOperatorStore(dataSource).grantByEmail(
    args[2]!,
  );
  console.log(JSON.stringify({ status: "operator-granted", ...result }));
} finally {
  await dataSource.destroy();
}
