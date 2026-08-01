import { resolve } from "node:path";
import { loadEnvFile } from "node:process";

try {
  loadEnvFile(resolve(import.meta.dirname, "../../.env"));
} catch (error) {
  if (error?.code !== "ENOENT") {
    throw error;
  }
}

await import("next/dist/bin/next");
