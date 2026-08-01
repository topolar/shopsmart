import {
  ALBERT_HYPERMARKET_SCOPE,
  type AlbertLeafletKind,
  type AlbertLeafletManifest,
  type AlbertProductMapping,
  ALBERT_RETAILER_ID,
  type AlbertSnapshotResult,
  ALBERT_SUPERMARKET_SCOPE,
  GLOBUS_BRNO_SCOPE,
  type GlobusProductMapping,
  type GlobusSnapshotResult,
  KAUFLAND_PRAHA_VYPICH_SCOPE,
  type KauflandProductMapping,
  type KauflandSnapshotResult,
} from "@shopsmart/connectors";
import { EntitySchema, type DataSource } from "typeorm";

import {
  CanonicalProductClassRecord,
  OfferRecord,
  RetailerProductRecord,
} from "./offer-record.js";
import { StoreRecord } from "./onboarding-store.js";

export class SourceSnapshotRecord {
  id!: string;
  sourceScopeKey!: string;
  sourceUrl!: string;
  retrievedAt!: Date;
  httpStatus!: number;
  contentHash!: string;
  parserVersion!: string;
  parseStatus!:
    | KauflandSnapshotResult["status"]
    | AlbertSnapshotResult["status"]
    | GlobusSnapshotResult["status"];
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

export class RetailerProductMappingCandidateRecord {
  id!: string;
  sourceScopeKey!: string;
  retailerId!: string;
  externalId!: string;
  exactName!: string;
  sourceSnapshotId!: string;
  status!: "pending" | "approved" | "rejected";
  canonicalProductClassId!: string | null;
  variantAttributes!: Record<string, string>;
  reviewedBy!: string | null;
  reviewedAt!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;
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

export const retailerProductMappingCandidateRecordSchema =
  new EntitySchema<RetailerProductMappingCandidateRecord>({
    name: "RetailerProductMappingCandidateRecord",
    tableName: "retailer_product_mapping_candidates",
    target: RetailerProductMappingCandidateRecord,
    columns: {
      id: { type: "uuid", primary: true, generated: "uuid" },
      sourceScopeKey: {
        name: "source_scope_key",
        type: "varchar",
        length: 240,
      },
      retailerId: { name: "retailer_id", type: "uuid" },
      externalId: { name: "external_id", type: "varchar", length: 240 },
      exactName: { name: "exact_name", type: "varchar", length: 500 },
      sourceSnapshotId: { name: "source_snapshot_id", type: "uuid" },
      status: { type: "varchar", length: 24, default: "pending" },
      canonicalProductClassId: {
        name: "canonical_product_class_id",
        type: "uuid",
        nullable: true,
      },
      variantAttributes: {
        name: "variant_attributes",
        type: "jsonb",
        default: {},
      },
      reviewedBy: {
        name: "reviewed_by",
        type: "varchar",
        length: 160,
        nullable: true,
      },
      reviewedAt: {
        name: "reviewed_at",
        type: "timestamptz",
        nullable: true,
      },
      createdAt: { name: "created_at", type: "timestamptz", createDate: true },
      updatedAt: { name: "updated_at", type: "timestamptz", updateDate: true },
    },
    uniques: [
      {
        name: "uq_retailer_mapping_candidate_external",
        columns: ["retailerId", "externalId"],
      },
    ],
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
          rawStorageKey: snapshot.rawStorageKey,
          sourceUrl: snapshot.sourceUrl,
          retrievedAt: snapshot.retrievedAt.toISOString(),
          httpStatus: snapshot.httpStatus,
        }
      : null;
  }

  async latestRetainedRetrieval(sourceScopeKey: string) {
    const snapshot = await this.dataSource
      .getRepository(SourceSnapshotRecord)
      .createQueryBuilder("snapshot")
      .where("snapshot.source_scope_key = :sourceScopeKey", {
        sourceScopeKey,
      })
      .andWhere("snapshot.raw_storage_key IS NOT NULL")
      .andWhere("snapshot.raw_deleted_at IS NULL")
      .orderBy("snapshot.retrieved_at", "DESC")
      .addOrderBy("snapshot.created_at", "DESC")
      .getOne();
    return snapshot
      ? {
          contentHash: snapshot.contentHash.trim(),
          parserVersion: snapshot.parserVersion,
          etag: snapshot.etag,
          lastModified: snapshot.lastModified,
          rawStorageKey: snapshot.rawStorageKey,
          sourceUrl: snapshot.sourceUrl,
          retrievedAt: snapshot.retrievedAt.toISOString(),
          httpStatus: snapshot.httpStatus,
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

      const unmapped = result.quarantines.filter(
        (candidate) =>
          candidate.reasonCode === "UNMAPPED_PRODUCT" &&
          candidate.externalId !== null &&
          candidate.exactName !== null,
      );
      for (const candidate of unmapped) {
        await manager.query(
          `INSERT INTO "retailer_product_mapping_candidates" (
             "source_scope_key", "retailer_id", "external_id", "exact_name",
             "source_snapshot_id", "status"
           ) VALUES ($1, $2, $3, $4, $5, 'pending')
           ON CONFLICT ("retailer_id", "external_id") DO UPDATE SET
             "exact_name" = EXCLUDED."exact_name",
             "source_snapshot_id" = EXCLUDED."source_snapshot_id",
             "updated_at" = CURRENT_TIMESTAMP`,
          [
            result.retrieval.sourceScopeKey,
            KAUFLAND_PRAHA_VYPICH_SCOPE.retailerId,
            candidate.externalId,
            candidate.exactName,
            snapshot.id,
          ],
        );
      }

      return { snapshotId: snapshot.id };
    });
  }

  async persistAlbert(
    result: AlbertSnapshotResult,
    options: PersistOptions & Readonly<{ manifest: AlbertLeafletManifest }>,
  ): Promise<Readonly<{ snapshotId: string }>> {
    validateStorageKey(options.rawStorageKey);
    const scope =
      options.manifest.kind === "supermarket"
        ? ALBERT_SUPERMARKET_SCOPE
        : ALBERT_HYPERMARKET_SCOPE;
    if (result.retrieval.sourceScopeKey !== scope.key) {
      throw new Error("Albert result and manifest scope do not match.");
    }
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
            id: scope.storeId,
            retailerId: ALBERT_RETAILER_ID,
            officialName: scope.storeName,
            city: "Czech Republic",
            sourceUrl: options.manifest.viewerUrl,
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
      const unmapped = result.quarantines.filter(
        (candidate) =>
          candidate.reasonCode === "UNMAPPED_PRODUCT" &&
          candidate.externalId !== null &&
          candidate.exactName !== null,
      );
      for (const candidate of unmapped) {
        await manager.query(
          `INSERT INTO "retailer_product_mapping_candidates" (
             "source_scope_key", "retailer_id", "external_id", "exact_name",
             "source_snapshot_id", "status"
           ) VALUES ($1, $2, $3, $4, $5, 'pending')
           ON CONFLICT ("retailer_id", "external_id") DO UPDATE SET
             "exact_name" = EXCLUDED."exact_name",
             "source_snapshot_id" = EXCLUDED."source_snapshot_id",
             "updated_at" = CURRENT_TIMESTAMP`,
          [
            scope.key,
            ALBERT_RETAILER_ID,
            candidate.externalId,
            candidate.declaredPackage
              ? `${candidate.exactName} — ${candidate.declaredPackage}`
              : candidate.exactName,
            snapshot.id,
          ],
        );
      }
      return { snapshotId: snapshot.id };
    });
  }

  async persistGlobus(
    result: GlobusSnapshotResult,
    options: PersistOptions,
  ): Promise<Readonly<{ snapshotId: string }>> {
    validateStorageKey(options.rawStorageKey);
    if (result.retrieval.sourceScopeKey !== GLOBUS_BRNO_SCOPE.key) {
      throw new Error(
        "Globus result does not match the approved source scope.",
      );
    }
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
            id: GLOBUS_BRNO_SCOPE.storeId,
            retailerId: GLOBUS_BRNO_SCOPE.retailerId,
            officialName: GLOBUS_BRNO_SCOPE.storeName,
            city: GLOBUS_BRNO_SCOPE.city,
            sourceUrl: GLOBUS_BRNO_SCOPE.storeUrl,
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
      const unmapped = result.quarantines.filter(
        (candidate) =>
          candidate.reasonCode === "UNMAPPED_PRODUCT" &&
          candidate.externalId !== null &&
          candidate.exactName !== null,
      );
      for (const candidate of unmapped) {
        await manager.query(
          `INSERT INTO "retailer_product_mapping_candidates" (
             "source_scope_key", "retailer_id", "external_id", "exact_name",
             "source_snapshot_id", "status"
           ) VALUES ($1, $2, $3, $4, $5, 'pending')
           ON CONFLICT ("retailer_id", "external_id") DO UPDATE SET
             "exact_name" = EXCLUDED."exact_name",
             "source_snapshot_id" = EXCLUDED."source_snapshot_id",
             "updated_at" = CURRENT_TIMESTAMP`,
          [
            GLOBUS_BRNO_SCOPE.key,
            GLOBUS_BRNO_SCOPE.retailerId,
            candidate.externalId,
            candidate.declaredPackage
              ? `${candidate.exactName} — ${candidate.declaredPackage}`
              : candidate.exactName,
            snapshot.id,
          ],
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

  async listPendingKauflandMappings() {
    return this.dataSource
      .getRepository(RetailerProductMappingCandidateRecord)
      .find({
        where: {
          sourceScopeKey: KAUFLAND_PRAHA_VYPICH_SCOPE.key,
          status: "pending",
        },
        order: { createdAt: "ASC", externalId: "ASC" },
      });
  }

  async listPendingAlbertMappings(kind: AlbertLeafletKind) {
    const scope =
      kind === "supermarket"
        ? ALBERT_SUPERMARKET_SCOPE
        : ALBERT_HYPERMARKET_SCOPE;
    return this.dataSource
      .getRepository(RetailerProductMappingCandidateRecord)
      .find({
        where: { sourceScopeKey: scope.key, status: "pending" },
        order: { createdAt: "ASC", externalId: "ASC" },
      });
  }

  async listPendingGlobusMappings() {
    return this.dataSource
      .getRepository(RetailerProductMappingCandidateRecord)
      .find({
        where: { sourceScopeKey: GLOBUS_BRNO_SCOPE.key, status: "pending" },
        order: { createdAt: "ASC", externalId: "ASC" },
      });
  }

  async listKauflandCanonicalClasses() {
    return this.dataSource.getRepository(CanonicalProductClassRecord).find({
      select: {
        id: true,
        slug: true,
        name: true,
        comparisonUnit: true,
        requiredAttributes: true,
        excludedAttributes: true,
      },
      order: { slug: "ASC" },
    });
  }

  async approveKauflandMapping(input: {
    candidateId: string;
    canonicalProductClassId: string;
    variantAttributes: Record<string, string>;
    reviewedBy: string;
    reviewedAt: string;
    allowedSourceScopeKeys?: readonly string[];
  }): Promise<Readonly<{ sourceScopeKey: string }>> {
    const reviewedAt = parseCanonicalTimestamp(input.reviewedAt, "reviewedAt");
    const reviewedBy = input.reviewedBy.trim();
    if (!reviewedBy || reviewedBy.length > 160) {
      throw new Error("reviewedBy must identify the local operator.");
    }
    validateVariantAttributes(input.variantAttributes);
    return this.dataSource.transaction(async (manager) => {
      const candidates = manager.getRepository(
        RetailerProductMappingCandidateRecord,
      );
      const candidate = await candidates.findOne({
        where: { id: input.candidateId },
        lock: { mode: "pessimistic_write" },
      });
      if (!candidate) throw new Error("UNKNOWN_MAPPING_CANDIDATE");
      if (candidate.status !== "pending") {
        throw new Error("MAPPING_ALREADY_REVIEWED");
      }
      if (
        input.allowedSourceScopeKeys &&
        !input.allowedSourceScopeKeys.includes(candidate.sourceScopeKey)
      ) {
        throw new Error("MAPPING_CANDIDATE_SCOPE_MISMATCH");
      }
      const canonical = await manager
        .getRepository(CanonicalProductClassRecord)
        .findOneBy({ id: input.canonicalProductClassId });
      if (!canonical) throw new Error("UNKNOWN_CANONICAL_PRODUCT_CLASS");
      const missingRequiredAttribute = Object.entries(
        canonical.requiredAttributes,
      ).some(([key, expected]) => input.variantAttributes[key] !== expected);
      const excludedAttribute = Object.entries(
        canonical.excludedAttributes,
      ).some(([key, excluded]) => input.variantAttributes[key] === excluded);
      if (missingRequiredAttribute || excludedAttribute) {
        throw new Error("MAPPING_ATTRIBUTE_MISMATCH");
      }
      await candidates.update(
        { id: candidate.id, status: "pending" },
        {
          status: "approved",
          canonicalProductClassId: input.canonicalProductClassId,
          variantAttributes: { ...input.variantAttributes },
          reviewedBy,
          reviewedAt,
        },
      );
      return { sourceScopeKey: candidate.sourceScopeKey };
    });
  }

  async loadApprovedKauflandMappings(): Promise<KauflandProductMapping[]> {
    const rows = (await this.dataSource.query(
      `SELECT candidate."external_id", candidate."canonical_product_class_id",
              candidate."variant_attributes", canonical."comparison_unit"
       FROM "retailer_product_mapping_candidates" candidate
       INNER JOIN "canonical_product_classes" canonical
         ON canonical."id" = candidate."canonical_product_class_id"
       WHERE candidate."source_scope_key" = $1
         AND candidate."retailer_id" = $2
         AND candidate."status" = 'approved'
       ORDER BY candidate."external_id"`,
      [KAUFLAND_PRAHA_VYPICH_SCOPE.key, KAUFLAND_PRAHA_VYPICH_SCOPE.retailerId],
    )) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      externalId: row.external_id as string,
      canonicalProductClassId: row.canonical_product_class_id as string,
      comparisonUnit:
        row.comparison_unit as KauflandProductMapping["comparisonUnit"],
      variantAttributes: row.variant_attributes as Record<string, string>,
    }));
  }

  async loadApprovedAlbertMappings(
    kind: AlbertLeafletKind,
  ): Promise<AlbertProductMapping[]> {
    const scope =
      kind === "supermarket"
        ? ALBERT_SUPERMARKET_SCOPE
        : ALBERT_HYPERMARKET_SCOPE;
    const rows = (await this.dataSource.query(
      `SELECT candidate."external_id", candidate."canonical_product_class_id",
              candidate."variant_attributes", canonical."comparison_unit"
       FROM "retailer_product_mapping_candidates" candidate
       INNER JOIN "canonical_product_classes" canonical
         ON canonical."id" = candidate."canonical_product_class_id"
       WHERE candidate."source_scope_key" = $1
         AND candidate."retailer_id" = $2
         AND candidate."status" = 'approved'
       ORDER BY candidate."external_id"`,
      [scope.key, ALBERT_RETAILER_ID],
    )) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      externalId: row.external_id as string,
      canonicalProductClassId: row.canonical_product_class_id as string,
      comparisonUnit:
        row.comparison_unit as AlbertProductMapping["comparisonUnit"],
      variantAttributes: row.variant_attributes as Record<string, string>,
    }));
  }

  async loadApprovedGlobusMappings(): Promise<GlobusProductMapping[]> {
    const rows = (await this.dataSource.query(
      `SELECT candidate."external_id", candidate."canonical_product_class_id",
              candidate."variant_attributes", canonical."comparison_unit"
       FROM "retailer_product_mapping_candidates" candidate
       INNER JOIN "canonical_product_classes" canonical
         ON canonical."id" = candidate."canonical_product_class_id"
       WHERE candidate."source_scope_key" = $1
         AND candidate."retailer_id" = $2
         AND candidate."status" = 'approved'
       ORDER BY candidate."external_id"`,
      [GLOBUS_BRNO_SCOPE.key, GLOBUS_BRNO_SCOPE.retailerId],
    )) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      externalId: row.external_id as string,
      canonicalProductClassId: row.canonical_product_class_id as string,
      comparisonUnit:
        row.comparison_unit as GlobusProductMapping["comparisonUnit"],
      variantAttributes: row.variant_attributes as Record<string, string>,
    }));
  }
}

function validateStorageKey(storageKey: string | null): void {
  if (
    storageKey !== null &&
    !/^\d{13}-[a-f0-9]{64}\.(?:html|pdf)$/.test(storageKey)
  ) {
    throw new Error("rawStorageKey must be a safe snapshot filename.");
  }
}

function parseCanonicalTimestamp(value: string, name: string): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${name} must be a canonical ISO timestamp.`);
  }
  return parsed;
}

function validateVariantAttributes(attributes: Record<string, string>): void {
  for (const [key, value] of Object.entries(attributes)) {
    if (
      !key.trim() ||
      key.length > 120 ||
      !value.trim() ||
      value.length > 240
    ) {
      throw new Error("variantAttributes must contain bounded non-empty text.");
    }
  }
}
