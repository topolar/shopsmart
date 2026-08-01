import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FileSystemRawSnapshotStore } from "./raw-snapshot-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("FileSystemRawSnapshotStore", () => {
  it("stores changed raw HTML outside Git and purges it at the retention deadline", async () => {
    const directory = await mkdtemp(join(tmpdir(), "shopsmart-snapshot-test-"));
    temporaryDirectories.push(directory);
    const store = new FileSystemRawSnapshotStore(directory);
    const contentHash = "a".repeat(64);

    const stored = await store.write({
      html: "<html><body>Synthetic retailer evidence</body></html>",
      contentHash,
      retrievedAt: "2026-08-01T12:00:00.000Z",
      rawDeleteAt: "2026-08-04T12:00:00.000Z",
    });

    expect(stored.storageKey).toMatch(/^1785844800000-[a-f0-9]{64}\.html$/);
    expect(stored.absolutePath.startsWith(directory)).toBe(true);
    await expect(readFile(stored.absolutePath, "utf8")).resolves.toBe(
      "<html><body>Synthetic retailer evidence</body></html>",
    );
    await expect(
      store.purgeExpired("2026-08-04T11:59:59.999Z"),
    ).resolves.toEqual([]);
    await expect(
      store.purgeExpired("2026-08-04T12:00:00.000Z"),
    ).resolves.toEqual([stored.storageKey]);
    await expect(readFile(stored.absolutePath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("uses only validated hashes and canonical timestamps in storage keys", async () => {
    const directory = await mkdtemp(join(tmpdir(), "shopsmart-snapshot-test-"));
    temporaryDirectories.push(directory);
    const store = new FileSystemRawSnapshotStore(directory);

    await expect(
      store.write({
        html: "synthetic",
        contentHash: "../outside",
        retrievedAt: "2026-08-01T12:00:00.000Z",
        rawDeleteAt: "2026-08-04T12:00:00.000Z",
      }),
    ).rejects.toThrow("contentHash");
    await expect(
      store.write({
        html: "synthetic",
        contentHash: "b".repeat(64),
        retrievedAt: "not-a-date",
        rawDeleteAt: "2026-08-04T12:00:00.000Z",
      }),
    ).rejects.toThrow("retrievedAt");
  });

  it("stores binary PDF evidence without converting it to text", async () => {
    const directory = await mkdtemp(join(tmpdir(), "shopsmart-snapshot-test-"));
    temporaryDirectories.push(directory);
    const store = new FileSystemRawSnapshotStore(directory);
    const contentHash = "c".repeat(64);
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]);

    const stored = await store.writeBinary({
      bytes,
      extension: "pdf",
      contentHash,
      retrievedAt: "2026-08-01T12:00:00.000Z",
      rawDeleteAt: "2026-08-04T12:00:00.000Z",
    });

    expect(stored.storageKey).toBe(`1785844800000-${contentHash}.pdf`);
    await expect(readFile(stored.absolutePath)).resolves.toEqual(
      Buffer.from(bytes),
    );
    await expect(
      store.purgeExpired("2026-08-04T12:00:00.000Z"),
    ).resolves.toEqual([stored.storageKey]);
  });
});
