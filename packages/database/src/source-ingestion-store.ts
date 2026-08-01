import {
  KAUFLAND_PRAHA_VYPICH_SCOPE,
  type KauflandSnapshotResult,
} from "@shopsmart/connectors";
import { EntitySchema, type DataSource } from "typeorm";

import { OfferRecord, RetailerProductRecord } from "./offer-record.js";
import { StoreRecord } from "./onboarding-store.js";

export class SourceSnapshotRecord {
  id!: string;
  sourceScopeKey!: string;
  sourceUrl!: string;
  retrievedAt!: Date;
  httpStatus!: number;
  contentHash!: string;
  parserVersion!: string;
  parseStatus!: KauflandSnapshotResult["status"];
  etag!: string | null;
  lastModified!: string | null;
  rawStorageKey!: string | null;
  rawDeleteAt!: Date;
  rawDeletedAt!: Date | null;
  createdAt!: Date;
}

export class QuarantinedSourceCandidateRecord {
  id!: string;
  snapshotId!: string;
  sourceScopeKey!: string;
  externalId!: string | null;
  exactName!: string | null;
  reasonCode!: string;
  createdAt!: Date;
}

export const sourceSnapshotRecordSchema =
  new EntitySchema<SourceSnapshotRecord>({
    name: "SourceSnapshotRecord",
    tableName: "source_snapshots",
    target: SourceSnapshotRecord,
    columns: {
      id: { type: "uuid", primary: true, generated: "uuid" },
      sourceScopeKey: {
        name: "source_scope_key",
        type: "varchar",
        length: 240,
      },
      sourceUrl: { name: "source_url", type: "varchar", length: 2_048 },
      retrievedAt: { name: "retrieved_at", type: "timestamptz" },
      httpStatus: { name: "http_status", type: "integer" },
      contentHash: { name: "content_hash", type: "char", length: 64 },
      parserVersion: {
        name: "parser_version",
        type: "varchar",
        length: 120,
      },
      parseStatus: { name: "parse_status", type: "varchar", length: 24 },
      etag: { type: "varchar", length: 500, nullable: true },
      lastModified: {
        name: "last_modified",
        type: "varchar",
        length: 160,
        nullable: true,
      },
      rawStorageKey: {
        name: "raw_storage_key",
        type: "varchar",
        length: 500,
        nullable: true,
      },
      rawDeleteAt: { name: "raw_delete_at", type: "timestamptz" },
      rawDeletedAt: {
        name: "raw_deleted_at",
        type: "timestamptz",
        nullable: true,
      },
      createdAt: { name: "created_at", type: "timestamptz", createDate: true },
    },
  });

export const quarantinedSourceCandidateRecordSchema =
  new EntitySchema<QuarantinedSourceCandidateRecord>({
    name: "QuarantinedSourceCandidateRecord",
    tableName: "quarantined_source_candidates",
    target: QuarantinedSourceCandidateRecord,
    columns: {
      id: { type: "uuid", primary: true, generated: "uuid" },
      snapshotId: { name: "snapshot_id", type: "uuid" },
      sourceScopeKey: {
        name: "source_scope_key",
        type: "varchar",
        length: 240,
      },
      externalId: {
        name: "external_id",
        type: "varchar",
        length: 240,
        nullable: true,
      },
      exactName: {
        name: "exact_name",
        type: "varchar",
        length: 500,
        nullable: true,
      },
      reasonCode: { name: "reason_code", type: "varchar", length: 120 },
      createdAt: { name: "created_at", type: "timestamptz", createDate: true },
    },
  });

type PersistOptions = Readonly<{ rawStorageKey: string | null }>;

export class TypeOrmSourceIngestionStore {
  constructor(private readonly dataSource: DataSource) {}

  async latestRetrieval(sourceScopeKey: string) {
    const snapshot = await this.dataSource
      .getRepository(SourceSnapshotRecord)
      .findOne({
        where: { sourceScopeKey },
        order: { retrievedAt: "DESC", createdAt: "DESC" },
      });
    return snapshot
      ? {
          contentHash: snapshot.contentHash.trim(),
          parserVersion: snapshot.parserVersion,
          etag: snapshot.etag,
          lastModified: snapshot.lastModified,
        }
      : null;
  }

  async persist(
    result: KauflandSnapshotResult,
    options: PersistOptions,
  ): Promise<Readonly<{ snapshotId: string }>> {
    validateStorageKey(options.rawStorageKey);
    return this.dataSource.transaction(async (manager) => {
      const snapshot = await manager.getRepository(SourceSnapshotRecord).save({
        sourceScopeKey: result.retrieval.sourceScopeKey,
        sourceUrl: result.retrieval.sourceUrl,
        retrievedAt: new Date(result.retrieval.retrievedAt),
        httpStatus: result.retrieval.httpStatus,
        contentHash: result.retrieval.contentHash,
        parserVersion: result.retrieval.parserVersion,
        parseStatus: result.status,
        etag: result.retrieval.etag,
        lastModified: result.retrieval.lastModified,
        rawStorageKey: options.rawStorageKey,
        rawDeleteAt: new Date(result.retrieval.rawDeleteAt),
        rawDeletedAt: null,
      });

      if (result.status !== "unchanged") {
        await manager.getRepository(StoreRecord).upsert(
          {
            id: KAUFLAND_PRAHA_VYPICH_SCOPE.storeId,
            retailerId: KAUFLAND_PRAHA_VYPICH_SCOPE.retailerId,
            officialName: KAUFLAND_PRAHA_VYPICH_SCOPE.storeName,
            city: KAUFLAND_PRAHA_VYPICH_SCOPE.city,
            sourceUrl: KAUFLAND_PRAHA_VYPICH_SCOPE.sourceUrl,
          },
          ["id"],
        );
      }

      if (result.retailerProducts.length > 0) {
        await manager.getRepository(RetailerProductRecord).upsert(
          result.retailerProducts.map((product) => ({
            ...product,
            contractVersion: "1" as const,
          })),
          ["retailerId", "externalId"],
        );
      }

      if (result.offers.length > 0) {
        await manager.getRepository(OfferRecord).save(
          result.offers.map((offer) => ({
            id: offer.id,
            contractVersion: offer.contractVersion,
            retailerProductId: offer.retailerProductId,
            sourceScopeId: offer.sourceScopeId,
            canonicalProductClassId: offer.canonicalProductClassId,
            exactName: offer.exactName,
            variantAttributes: offer.variantAttributes,
            package: offer.package,
            priceAmount: offer.price.amount,
            currency: offer.price.currency,
            regularPriceAmount: offer.regularPrice?.amount ?? null,
            discountPercent:
              offer.discountPercent === null
                ? null
                : offer.discountPercent.toFixed(2),
            comparisonUnit: offer.comparisonUnit,
            unitPrices: offer.unitPrices,
            membership: offer.membership,
            channel: offer.channel,
            locality: offer.locality,
            availability: offer.availability,
            validity: offer.validity,
            evidence: offer.evidence,
            parserVersion: offer.parserVersion,
            status: offer.status,
          })),
        );
      }

      if (result.quarantines.length > 0) {
        await manager.getRepository(QuarantinedSourceCandidateRecord).save(
          result.quarantines.map((candidate) => ({
            snapshotId: snapshot.id,
            sourceScopeKey: result.retrieval.sourceScopeKey,
            externalId: candidate.externalId,
            exactName: candidate.exactName,
            reasonCode: candidate.reasonCode,
          })),
        );
      }

      return { snapshotId: snapshot.id };
    });
  }

  async markRawDeleted(storageKeys: readonly string[], deletedAt: string) {
    if (storageKeys.length === 0) return;
    for (const storageKey of storageKeys) validateStorageKey(storageKey);
    const timestamp = new Date(deletedAt);
    if (
      !Number.isFinite(timestamp.getTime()) ||
      timestamp.toISOString() !== deletedAt
    ) {
      throw new Error("deletedAt must be a canonical ISO timestamp.");
    }
    await this.dataSource
      .getRepository(SourceSnapshotRecord)
      .createQueryBuilder()
      .update()
      .set({ rawDeletedAt: timestamp, rawStorageKey: null })
      .where("raw_storage_key IN (:...storageKeys)", { storageKeys })
      .execute();
  }
}

function validateStorageKey(storageKey: string | null): void {
  if (storageKey !== null && !/^\d{13}-[a-f0-9]{64}\.html$/.test(storageKey)) {
    throw new Error("rawStorageKey must be a safe snapshot filename.");
  }
}
