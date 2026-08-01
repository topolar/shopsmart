import { randomUUID } from "node:crypto";

import {
  createWatchRuleRequestSchema,
  type CreateWatchRuleRequest,
  type UserWatchRule,
  type WatchRuleOptionsResponse,
} from "@shopsmart/contracts";
import { In, type DataSource } from "typeorm";

import { TypeOrmMatchingStore } from "./matching-store.js";
import { CanonicalProductClassRecord } from "./offer-record.js";
import {
  LoyaltyMembershipRecord,
  StoreRecord,
  UserStoreAccessRecord,
} from "./onboarding-store.js";

export interface WatchRuleApplicationStore {
  create(
    actorTenantId: string,
    input: CreateWatchRuleRequest,
  ): Promise<UserWatchRule>;
  list(actorTenantId: string): Promise<UserWatchRule[]>;
  options(actorTenantId: string): Promise<WatchRuleOptionsResponse>;
}

export class WatchRuleSelectionError extends Error {
  readonly code = "WATCH_RULE_SELECTION_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "WatchRuleSelectionError";
  }
}

export class TypeOrmWatchRuleApplicationStore implements WatchRuleApplicationStore {
  private readonly matchingStore: TypeOrmMatchingStore;

  constructor(private readonly dataSource: DataSource) {
    this.matchingStore = new TypeOrmMatchingStore(dataSource);
  }

  async create(
    actorTenantId: string,
    input: CreateWatchRuleRequest,
  ): Promise<UserWatchRule> {
    const request = createWatchRuleRequestSchema.parse(input);
    const canonical = await this.validateSelections(actorTenantId, request);
    return this.matchingStore.saveWatchRule(actorTenantId, {
      contractVersion: "1",
      id: randomUUID(),
      tenantId: actorTenantId,
      canonicalProductClassId: request.canonicalProductClassId,
      requiredAttributes: canonical.requiredAttributes,
      excludedAttributes: Object.fromEntries(
        Object.entries(canonical.excludedAttributes).map(([name, value]) => [
          name,
          [value],
        ]),
      ),
      comparisonUnit: canonical.comparisonUnit,
      preferredRetailerIds: [],
      preferredThreshold: {
        maxUnitPrice: request.maxUnitPrice,
        minDiscountPercent: null,
      },
      fallbackThreshold: {
        maxUnitPrice: request.maxUnitPrice,
        minDiscountPercent: null,
      },
      acceptedMemberships: [...new Set(request.acceptedMemberships)],
      channels: [request.channel],
      storeIds: [...new Set(request.storeIds)],
      serviceAreaIds: [],
    });
  }

  list(actorTenantId: string): Promise<UserWatchRule[]> {
    return this.matchingStore.listWatchRules(actorTenantId);
  }

  async options(actorTenantId: string): Promise<WatchRuleOptionsResponse> {
    const [products, stores, selectedStores, memberships] = await Promise.all([
      this.dataSource.getRepository(CanonicalProductClassRecord).find({
        order: { id: "ASC" },
      }),
      this.dataSource.getRepository(StoreRecord).find({ order: { id: "ASC" } }),
      this.dataSource.getRepository(UserStoreAccessRecord).find({
        where: { tenantId: actorTenantId },
        order: { storeId: "ASC" },
      }),
      this.dataSource.getRepository(LoyaltyMembershipRecord).find({
        where: { tenantId: actorTenantId },
        order: { programKey: "ASC" },
      }),
    ]);
    return {
      tenantId: actorTenantId,
      products: products.map((product) => ({
        contractVersion: product.contractVersion,
        id: product.id,
        slug: product.slug,
        name: product.name,
        comparisonUnit: product.comparisonUnit,
        requiredAttributes: product.requiredAttributes,
        excludedAttributes: product.excludedAttributes,
      })),
      availableStores: stores.map((store) => ({
        id: store.id,
        retailerId: store.retailerId,
        name: store.officialName,
        city: store.city,
      })),
      selectedStoreIds: selectedStores.map(({ storeId }) => storeId),
      acceptedMemberships: memberships.map(
        ({ programKey }) => `loyalty:${programKey}`,
      ),
    };
  }

  private async validateSelections(
    tenantId: string,
    request: CreateWatchRuleRequest,
  ): Promise<CanonicalProductClassRecord> {
    const canonical = await this.dataSource
      .getRepository(CanonicalProductClassRecord)
      .findOneBy({ id: request.canonicalProductClassId });
    if (
      canonical === null ||
      canonical.comparisonUnit !== request.maxUnitPrice.unit
    ) {
      throw new WatchRuleSelectionError(
        "The canonical product or comparison unit is not available.",
      );
    }
    const storeCount = await this.dataSource
      .getRepository(UserStoreAccessRecord)
      .countBy({ tenantId, storeId: In(request.storeIds) });
    if (storeCount !== new Set(request.storeIds).size) {
      throw new WatchRuleSelectionError(
        "A selected store is not enabled in tenant onboarding.",
      );
    }

    const membershipPrograms = request.acceptedMemberships.map((key) => {
      const [kind, ...programParts] = key.split(":");
      if (
        !["loyalty", "app"].includes(kind ?? "") ||
        programParts.length === 0
      ) {
        throw new WatchRuleSelectionError(
          "A selected membership has an unsupported format.",
        );
      }
      return programParts.join(":");
    });
    if (membershipPrograms.length === 0) return canonical;
    const membershipCount = await this.dataSource
      .getRepository(LoyaltyMembershipRecord)
      .countBy({ tenantId, programKey: In(membershipPrograms) });
    if (membershipCount !== new Set(membershipPrograms).size) {
      throw new WatchRuleSelectionError(
        "A selected membership is not enabled in tenant onboarding.",
      );
    }
    return canonical;
  }
}
