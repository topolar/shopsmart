import {
  matchedOfferSchema,
  type MatchedOffer,
  type PublishedOffer,
  type UserWatchRule,
} from "@shopsmart/contracts";
import { In, type DataSource } from "typeorm";

import {
  MatchRecord,
  TenantScopeViolationError,
  WatchRuleRecord,
  mapWatchRuleRecord,
} from "./matching-store.js";
import { OfferRecord, RetailerProductRecord } from "./offer-record.js";
import { mapPublishedOfferRecord } from "./offer-store.js";

export type SharedPublishedOfferRecord = Readonly<{
  offer: PublishedOffer;
  retailerId: string;
}>;

export class TypeOrmMatchingFanOutStore {
  constructor(private readonly dataSource: DataSource) {}

  async listPublishedOffers(): Promise<SharedPublishedOfferRecord[]> {
    const offers = await this.dataSource.getRepository(OfferRecord).find({
      where: { status: "published" },
      order: { id: "ASC" },
    });
    if (offers.length === 0) return [];

    const retailerProducts = await this.dataSource
      .getRepository(RetailerProductRecord)
      .findBy({
        id: In(offers.map(({ retailerProductId }) => retailerProductId)),
      });
    const retailerIdByProductId = new Map(
      retailerProducts.map(({ id, retailerId }) => [id, retailerId]),
    );
    return offers.map((record) => {
      const retailerId = retailerIdByProductId.get(record.retailerProductId);
      if (retailerId === undefined) {
        throw new Error(
          `Retailer product ${record.retailerProductId} is missing.`,
        );
      }
      return { offer: mapPublishedOfferRecord(record), retailerId };
    });
  }

  async listWatchRulesForCanonicalProductClasses(
    canonicalProductClassIds: readonly string[],
  ): Promise<UserWatchRule[]> {
    const uniqueIds = [...new Set(canonicalProductClassIds)];
    if (uniqueIds.length === 0) return [];
    const records = await this.dataSource.getRepository(WatchRuleRecord).find({
      where: { canonicalProductClassId: In(uniqueIds) },
      order: { id: "ASC" },
    });
    return records.map(mapWatchRuleRecord);
  }

  async saveMatchesIdempotently(
    inputs: readonly MatchedOffer[],
  ): Promise<Readonly<{ insertedCount: number }>> {
    const matches = inputs.map((input) => matchedOfferSchema.parse(input));
    if (matches.length === 0) return { insertedCount: 0 };

    return this.dataSource.transaction(async (manager) => {
      const expectedRuleKeys = new Set(
        matches.map(
          ({ tenantId, watchRuleId }) => `${tenantId}:${watchRuleId}`,
        ),
      );
      const rules = await manager.getRepository(WatchRuleRecord).find({
        where: matches.map(({ tenantId, watchRuleId }) => ({
          tenantId,
          id: watchRuleId,
        })),
      });
      const actualRuleKeys = new Set(
        rules.map(({ tenantId, id }) => `${tenantId}:${id}`),
      );
      if (
        expectedRuleKeys.size !== actualRuleKeys.size ||
        [...expectedRuleKeys].some((key) => !actualRuleKeys.has(key))
      ) {
        throw new TenantScopeViolationError();
      }

      const result = await manager
        .getRepository(MatchRecord)
        .createQueryBuilder()
        .insert()
        .values(matches.map(toMatchRecord))
        .orIgnore()
        .returning(["id"])
        .execute();
      if (!Array.isArray(result.raw)) {
        throw new Error("PostgreSQL did not return inserted match ids.");
      }
      return { insertedCount: result.raw.length };
    });
  }
}

function toMatchRecord(match: MatchedOffer): Partial<MatchRecord> {
  return {
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
  };
}
