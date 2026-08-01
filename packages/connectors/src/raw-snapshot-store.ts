import {
  lstat,
  mkdir,
  readFile,
  readdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

type WriteRawSnapshotInput = Readonly<{
  html: string;
  contentHash: string;
  retrievedAt: string;
  rawDeleteAt: string;
}>;

type WriteBinaryRawSnapshotInput = Readonly<{
  bytes: Uint8Array;
  extension: "pdf";
  contentHash: string;
  retrievedAt: string;
  rawDeleteAt: string;
}>;

export type StoredRawSnapshot = Readonly<{
  storageKey: string;
  absolutePath: string;
}>;

export class FileSystemRawSnapshotStore {
  readonly rootDirectory: string;

  constructor(rootDirectory: string) {
    if (!rootDirectory.trim()) throw new Error("rootDirectory is required.");
    this.rootDirectory = resolve(rootDirectory);
  }

  async write(input: WriteRawSnapshotInput): Promise<StoredRawSnapshot> {
    return this.writeContent({
      content: Buffer.from(input.html, "utf8"),
      extension: "html",
      contentHash: input.contentHash,
      retrievedAt: input.retrievedAt,
      rawDeleteAt: input.rawDeleteAt,
    });
  }

  async writeBinary(
    input: WriteBinaryRawSnapshotInput,
  ): Promise<StoredRawSnapshot> {
    return this.writeContent({
      content: Buffer.from(input.bytes),
      extension: input.extension,
      contentHash: input.contentHash,
      retrievedAt: input.retrievedAt,
      rawDeleteAt: input.rawDeleteAt,
    });
  }

  private async writeContent(input: {
    content: Buffer;
    extension: "html" | "pdf";
    contentHash: string;
    retrievedAt: string;
    rawDeleteAt: string;
  }): Promise<StoredRawSnapshot> {
    if (!/^[a-f0-9]{64}$/.test(input.contentHash)) {
      throw new Error("contentHash must be a lowercase SHA-256 digest.");
    }
    const retrievedAt = parseCanonicalTimestamp(
      input.retrievedAt,
      "retrievedAt",
    );
    const rawDeleteAt = parseCanonicalTimestamp(
      input.rawDeleteAt,
      "rawDeleteAt",
    );
    if (rawDeleteAt <= retrievedAt) {
      throw new Error("rawDeleteAt must follow retrievedAt.");
    }

    await mkdir(this.rootDirectory, { recursive: true });
    const storageKey = `${rawDeleteAt.getTime()}-${input.contentHash}.${input.extension}`;
    const absolutePath = this.resolveStorageKey(storageKey);
    try {
      await writeFile(absolutePath, input.content, {
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") throw error;
      const metadata = await lstat(absolutePath);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw new Error("Existing snapshot target is not a regular file.", {
          cause: error,
        });
      }
      const existing = await readFile(absolutePath);
      if (!existing.equals(input.content)) {
        throw new Error("Snapshot storage key collision.", { cause: error });
      }
    }
    return { storageKey, absolutePath };
  }

  async purgeExpired(nowInput: string): Promise<string[]> {
    const now = parseCanonicalTimestamp(nowInput, "now");
    await mkdir(this.rootDirectory, { recursive: true });
    const deleted: string[] = [];
    for (const entry of await readdir(this.rootDirectory, {
      withFileTypes: true,
    })) {
      const match = /^(\d{13})-[a-f0-9]{64}\.(?:html|pdf)$/.exec(entry.name);
      if (!match || !entry.isFile() || Number(match[1]) > now.getTime()) {
        continue;
      }
      const absolutePath = this.resolveStorageKey(entry.name);
      const metadata = await lstat(absolutePath);
      if (!metadata.isFile() || metadata.isSymbolicLink()) continue;
      await unlink(absolutePath);
      deleted.push(entry.name);
    }
    return deleted.toSorted();
  }

  private resolveStorageKey(storageKey: string): string {
    const absolutePath = resolve(this.rootDirectory, storageKey);
    const pathFromRoot = relative(this.rootDirectory, absolutePath);
    if (
      !pathFromRoot ||
      pathFromRoot.startsWith("..") ||
      isAbsolute(pathFromRoot)
    ) {
      throw new Error("Snapshot storage key escaped the configured root.");
    }
    return absolutePath;
  }
}

function parseCanonicalTimestamp(value: string, name: string): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${name} must be a canonical ISO timestamp.`);
  }
  return parsed;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
