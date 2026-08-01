import {
  offersDashboardResponseSchema,
  type OffersDashboardResponse,
} from "@shopsmart/contracts";
import { renderNotificationDigest } from "@shopsmart/domain";
import { In, type DataSource } from "typeorm";

import { mapMatchRecord, MatchRecord } from "./matching-store.js";
import { CanonicalProductClassRecord, OfferRecord } from "./offer-record.js";
import { mapPublishedOfferRecord } from "./offer-store.js";
import { StoreRecord } from "./onboarding-store.js";

export interface OffersDashboardStore {
  list(actorTenantId: string): Promise<OffersDashboardResponse>;
}

export class TypeOrmOffersDashboardStore implements OffersDashboardStore {
  constructor(private readonly dataSource: DataSource) {}

  async list(actorTenantId: string): Promise<OffersDashboardResponse> {
    const records = await this.dataSource.getRepository(MatchRecord).find({
      where: { tenantId: actorTenantId },
      order: { evaluatedAt: "DESC", id: "ASC" },
    });
    if (records.length === 0) return emptyDashboard(actorTenantId);

    const offerRecords = await this.dataSource
      .getRepository(OfferRecord)
      .findBy({
        id: In(records.map(({ offerId }) => offerId)),
        status: "published",
      });
    const offersById = new Map(offerRecords.map((offer) => [offer.id, offer]));
    const canonicalRecords = await this.dataSource
      .getRepository(CanonicalProductClassRecord)
      .findBy({
        id: In(
          records.map(({ canonicalProductClassId }) => canonicalProductClassId),
        ),
      });
    const canonicalNames = new Map(
      canonicalRecords.map(({ id, name }) => [id, name]),
    );
    const physicalStoreIds = offerRecords.flatMap(({ locality }) =>
      locality.kind === "physical" ? [locality.storeId] : [],
    );
    const storeNames = new Map(
      (physicalStoreIds.length === 0
        ? []
        : await this.dataSource
            .getRepository(StoreRecord)
            .findBy({ id: In(physicalStoreIds) })
      ).map(({ id, officialName }) => [id, officialName]),
    );

    const facts = records.flatMap((record) => {
      const offerRecord = offersById.get(record.offerId);
      const canonicalProductClassName = canonicalNames.get(
        record.canonicalProductClassId,
      );
      if (!offerRecord || !canonicalProductClassName) return [];
      try {
        const offer = mapPublishedOfferRecord(offerRecord);
        const localityName =
          offer.locality.kind === "physical"
            ? storeNames.get(offer.locality.storeId)
            : offer.locality.serviceAreaId;
        if (!localityName) return [];
        const fact = {
          match: mapMatchRecord(record),
          offer,
        };
        renderNotificationDigest({
          tenantId: actorTenantId,
          intervalKey: "dashboard-validation",
          locale: "cs",
          facts: [fact],
        });
        return [{ ...fact, canonicalProductClassName, localityName }];
      } catch {
        return [];
      }
    });
    if (facts.length === 0) return emptyDashboard(actorTenantId);

    const digest = renderNotificationDigest({
      tenantId: actorTenantId,
      intervalKey: "dashboard",
      locale: "cs",
      facts,
    });
    return offersDashboardResponseSchema.parse({
      contractVersion: "1",
      tenantId: actorTenantId,
      groups: digest.groups.map((group) => ({
        ...group,
        canonicalProductClassName: facts.find(
          ({ match }) =>
            match.canonicalProductClassId === group.canonicalProductClassId,
        )!.canonicalProductClassName,
        offers: group.offers.map((offer) => ({
          ...offer,
          localityName: facts.find(({ match }) => match.id === offer.matchId)!
            .localityName,
        })),
      })),
    });
  }
}

function emptyDashboard(tenantId: string): OffersDashboardResponse {
  return offersDashboardResponseSchema.parse({
    contractVersion: "1",
    tenantId,
    groups: [],
  });
}
