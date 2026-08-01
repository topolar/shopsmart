export function integrationDatabaseUrl(): string | undefined {
  const testUrl = process.env.DATABASE_TEST_URL?.trim();
  if (testUrl) return testUrl;

  // CI databases are disposable by contract. Local DATABASE_URL points at the
  // operator's persistent development data and must never be test-cleaned.
  return process.env.CI
    ? process.env.DATABASE_URL?.trim() || undefined
    : undefined;
}
