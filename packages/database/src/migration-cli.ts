import { createAppDataSource } from "./data-source.js";

const command = process.argv[2];
const dataSource = createAppDataSource();

try {
  await dataSource.initialize();

  if (command === "run") {
    const migrations = await dataSource.runMigrations({ transaction: "all" });
    console.log(`Applied ${migrations.length} migration(s).`);
  } else if (command === "revert") {
    await dataSource.undoLastMigration({ transaction: "all" });
    console.log("Reverted the latest migration.");
  } else {
    throw new Error("Expected migration command: run or revert.");
  }
} finally {
  if (dataSource.isInitialized) {
    await dataSource.destroy();
  }
}
