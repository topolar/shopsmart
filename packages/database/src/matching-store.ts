import {
  matchedOfferSchema,
  userWatchRuleSchema,
  type MatchedOffer,
  type UserWatchRule,
} from "@shopsmart/contracts";
import { EntitySchema, type DataSource } from "typeorm";

export class TenantRecord {
  id!: string;
  name!: string;
  createdAt!: Date;
}

export class WatchRuleRecord {
  id!: string;
  tenantId!: string;
  contractVersion!: "1";
  canonicalProductClassId!: string;
  requiredAttributes!: UserWatchRule["requiredAttributes"];
  excludedAttributes!: UserWatchRule["excludedAttributes"];
  comparisonUnit!: UserWatchRule["comparisonUnit"];
  preferredRetailerIds!: string[];
  preferredThreshold!: UserWatchRule["preferredThreshold"];
  fallbackThreshold!: UserWatchRule["fallbackThreshold"];
  acceptedMemberships!: string[];
  channels!: UserWatchRule["channels"];
  storeIds!: string[];
  serviceAreaIds!: string[];
  createdAt!: Date;
  updatedAt!: Date;
}

export class MatchRecord {
  id!: string;
  tenantId!: string;
  watchRuleId!: string;
  offerId!: string;
  canonicalProductClassId!: string;
  normalizedAmount!: string;
  currency!: string;
  comparisonUnit!: MatchedOffer["normalizedUnitPrice"]["unit"];
  packagePriceAmount!: string;
  retailer!: MatchedOffer["retailer"];
  thresholdReason!: MatchedOffer["thresholdReason"];
  noveltyKey!: string;
  evaluatedAt!: Date;
  createdAt!: Date;
}

export const tenantRecordSchema = new EntitySchema<TenantRecord>({
  name: "TenantRecord",
  tableName: "tenants",
  target: TenantRecord,
  columns: {
    id: { type: "uuid", primary: true, generated: "uuid" },
    name: { type: "varchar", length: 160 },
    createdAt: { name: "created_at", type: "timestamptz", createDate: true },
  },
});

export const watchRuleRecordSchema = new EntitySchema<WatchRuleRecord>({
  name: "WatchRuleRecord",
  tableName: "watch_rules",
  target: WatchRuleRecord,
  columns: {
    id: { type: "uuid", primary: true },
    tenantId: { name: "tenant_id", type: "uuid" },
    contractVersion: {
      name: "contract_version",
      type: "varchar",
      length: 8,
      default: "1",
    },
    canonicalProductClassId: {
      name: "canonical_product_class_id",
      type: "uuid",
    },
    requiredAttributes: {
      name: "required_attributes",
      type: "jsonb",
      default: {},
    },
    excludedAttributes: {
      name: "excluded_attributes",
      type: "jsonb",
      default: {},
    },
    comparisonUnit: {
      name: "comparison_unit",
      type: "varchar",
      length: 32,
    },
    preferredRetailerIds: {
      name: "preferred_retailer_ids",
      type: "uuid",
      array: true,
      default: "{}",
    },
    preferredThreshold: { name: "preferred_threshold", type: "jsonb" },
    fallbackThreshold: { name: "fallback_threshold", type: "jsonb" },
    acceptedMemberships: {
      name: "accepted_memberships",
      type: "varchar",
      array: true,
      default: "{}",
    },
    channels: { type: "varchar", array: true },
    storeIds: {
      name: "store_ids",
      type: "uuid",
      array: true,
      default: "{}",
    },
    serviceAreaIds: {
      name: "service_area_ids",
      type: "uuid",
      array: true,
      default: "{}",
    },
    createdAt: { name: "created_at", type: "timestamptz", createDate: true },
    updatedAt: { name: "updated_at", type: "timestamptz", updateDate: true },
  },
  uniques: [
    {
      name: "uq_watch_rules_tenant_id",
      columns: ["tenantId", "id"],
    },
  ],
});

export const matchRecordSchema = new EntitySchema<MatchRecord>({
  name: "MatchRecord",
  tableName: "matches",
  target: MatchRecord,
  columns: {
    id: { type: "char", length: 64, primary: true },
    tenantId: { name: "tenant_id", type: "uuid" },
    watchRuleId: { name: "watch_rule_id", type: "uuid" },
    offerId: { name: "offer_id", type: "uuid" },
    canonicalProductClassId: {
      name: "canonical_product_class_id",
      type: "uuid",
    },
    normalizedAmount: {
      name: "normalized_amount",
      type: "varchar",
      length: 64,
    },
    currency: { type: "char", length: 3 },
    comparisonUnit: {
      name: "comparison_unit",
      type: "varchar",
      length: 32,
    },
    packagePriceAmount: {
      name: "package_price_amount",
      type: "varchar",
      length: 64,
    },
    retailer: { type: "jsonb" },
    thresholdReason: { name: "threshold_reason", type: "jsonb" },
    noveltyKey: { name: "novelty_key", type: "varchar", length: 96 },
    evaluatedAt: { name: "evaluated_at", type: "timestamptz" },
    createdAt: { name: "created_at", type: "timestamptz", createDate: true },
  },
  uniques: [
    {
      name: "uq_matches_tenant_rule_novelty",
      columns: ["tenantId", "watchRuleId", "noveltyKey"],
    },
  ],
});

export class TenantScopeViolationError extends Error {
  readonly code = "TENANT_SCOPE_VIOLATION";

  constructor() {
    super("The requested operation is outside the active tenant scope.");
    this.name = "TenantScopeViolationError";
  }
}

export class TypeOrmMatchingStore {
  constructor(private readonly dataSource: DataSource) {}

  async saveWatchRule(
    actorTenantId: string,
    input: unknown,
  ): Promise<UserWatchRule> {
    const rule = userWatchRuleSchema.parse(input);
    assertTenant(actorTenantId, rule.tenantId);

    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(WatchRuleRecord);
      const saved = await repository.save(
        repository.create({
          id: rule.id,
          tenantId: rule.tenantId,
          contractVersion: rule.contractVersion,
          canonicalProductClassId: rule.canonicalProductClassId,
          requiredAttributes: rule.requiredAttributes,
          excludedAttributes: rule.excludedAttributes,
          comparisonUnit: rule.comparisonUnit,
          preferredRetailerIds: rule.preferredRetailerIds,
          preferredThreshold: rule.preferredThreshold,
          fallbackThreshold: rule.fallbackThreshold,
          acceptedMemberships: rule.acceptedMemberships,
          channels: rule.channels,
          storeIds: rule.storeIds,
          serviceAreaIds: rule.serviceAreaIds,
        }),
      );
      return toWatchRule(saved);
    });
  }

  async getWatchRule(
    actorTenantId: string,
    id: string,
  ): Promise<UserWatchRule | null> {
    const record = await this.dataSource
      .getRepository(WatchRuleRecord)
      .findOneBy({
        id,
        tenantId: actorTenantId,
      });
    return record === null ? null : toWatchRule(record);
  }

  async saveMatch(
    actorTenantId: string,
    input: unknown,
  ): Promise<MatchedOffer> {
    const match = matchedOfferSchema.parse(input);
    assertTenant(actorTenantId, match.tenantId);

    return this.dataSource.transaction(async (manager) => {
      const rule = await manager.getRepository(WatchRuleRecord).findOneBy({
        id: match.watchRuleId,
        tenantId: actorTenantId,
      });
      if (rule === null) throw new TenantScopeViolationError();

      const repository = manager.getRepository(MatchRecord);
      const saved = await repository.save(
        repository.create({
          id: match.id,
          tenantId: match.tenantId,
          watchRuleId: match.watchRuleId,
          offerId: match.offerId,
          canonicalProductClassId: match.canonicalProductClassId,
          normalizedAmount: match.normalizedUnitPrice.amount,
          currency: match.normalizedUnitPrice.currency,
          comparisonUnit: match.normalizedUnitPrice.unit,
          packagePriceAmount: match.packagePrice.amount,
          retailer: match.retailer,
          thresholdReason: match.thresholdReason,
          noveltyKey: match.noveltyKey,
          evaluatedAt: new Date(match.evaluatedAt),
        }),
      );
      return toMatchedOffer(saved);
    });
  }

  async listMatches(
    actorTenantId: string,
    watchRuleId: string,
  ): Promise<MatchedOffer[]> {
    const records = await this.dataSource.getRepository(MatchRecord).find({
      where: { tenantId: actorTenantId, watchRuleId },
      order: { evaluatedAt: "ASC", id: "ASC" },
    });
    return records.map(toMatchedOffer);
  }
}

function toWatchRule(record: WatchRuleRecord): UserWatchRule {
  return userWatchRuleSchema.parse({
    contractVersion: record.contractVersion,
    id: record.id,
    tenantId: record.tenantId,
    canonicalProductClassId: record.canonicalProductClassId,
    requiredAttributes: record.requiredAttributes,
    excludedAttributes: record.excludedAttributes,
    comparisonUnit: record.comparisonUnit,
    preferredRetailerIds: record.preferredRetailerIds,
    preferredThreshold: record.preferredThreshold,
    fallbackThreshold: record.fallbackThreshold,
    acceptedMemberships: record.acceptedMemberships,
    channels: record.channels,
    storeIds: record.storeIds,
    serviceAreaIds: record.serviceAreaIds,
  });
}

function toMatchedOffer(record: MatchRecord): MatchedOffer {
  return matchedOfferSchema.parse({
    id: record.id.trim(),
    tenantId: record.tenantId,
    watchRuleId: record.watchRuleId,
    offerId: record.offerId,
    canonicalProductClassId: record.canonicalProductClassId,
    normalizedUnitPrice: {
      amount: record.normalizedAmount,
      currency: record.currency.trim(),
      unit: record.comparisonUnit,
    },
    packagePrice: {
      amount: record.packagePriceAmount,
      currency: record.currency.trim(),
    },
    retailer: record.retailer,
    thresholdReason: record.thresholdReason,
    noveltyKey: record.noveltyKey,
    evaluatedAt: record.evaluatedAt.toISOString(),
  });
}

function assertTenant(actorTenantId: string, resourceTenantId: string) {
  if (actorTenantId !== resourceTenantId) {
    throw new TenantScopeViolationError();
  }
}
