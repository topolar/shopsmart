import type { NotificationDigestPayload } from "@shopsmart/contracts";
import { In, type DataSource } from "typeorm";
import { z } from "zod/v4";

import { MatchRecord, mapMatchRecord } from "./matching-store.js";
import {
  NotificationEventRecord,
  TypeOrmNotificationOutboxStore,
} from "./notification-outbox.js";
import { NotificationPreferenceRecord } from "./onboarding-store.js";
import { OfferRecord } from "./offer-record.js";
import { mapPublishedOfferRecord } from "./offer-store.js";

export type DigestPlanningCandidateRecord = Readonly<{
  tenantId: string;
  recipientEmails: readonly string[];
  facts: readonly Readonly<{ match: unknown; offer: unknown }>[];
}>;

const emailSchema = z.email();

export class TypeOrmDigestPlanningStore {
  private readonly outbox: TypeOrmNotificationOutboxStore;

  constructor(private readonly dataSource: DataSource) {
    this.outbox = new TypeOrmNotificationOutboxStore(dataSource);
  }

  async listCandidates(): Promise<DigestPlanningCandidateRecord[]> {
    const preferences = await this.dataSource
      .getRepository(NotificationPreferenceRecord)
      .findBy({ emailDigestEnabled: true, locale: "cs" });
    const tenantIds = preferences.map(({ tenantId }) => tenantId).toSorted();
    if (tenantIds.length === 0) return [];

    const matches = await this.dataSource.getRepository(MatchRecord).find({
      where: { tenantId: In(tenantIds) },
      order: { tenantId: "ASC", evaluatedAt: "ASC", id: "ASC" },
    });
    if (matches.length === 0) return [];
    const events = await this.dataSource
      .getRepository(NotificationEventRecord)
      .findBy({ tenantId: In(tenantIds) });
    const plannedKeys = new Set(
      events.map(
        ({ tenantId, watchRuleId, noveltyKey }) =>
          `${tenantId}:${watchRuleId}:${noveltyKey}`,
      ),
    );
    const unplannedMatches = matches.filter(
      ({ tenantId, watchRuleId, noveltyKey }) =>
        !plannedKeys.has(`${tenantId}:${watchRuleId}:${noveltyKey}`),
    );
    if (unplannedMatches.length === 0) return [];

    const offerRecords = await this.dataSource
      .getRepository(OfferRecord)
      .findBy({
        id: In(unplannedMatches.map(({ offerId }) => offerId)),
        status: "published",
      });
    const offers = new Map(
      offerRecords.map((record) => [record.id, mapOfferForDigest(record)]),
    );
    const recipientRows = (await this.dataSource.query(
      `SELECT "tenantId" AS "tenantId", "email" FROM "user" WHERE "tenantId" = ANY($1::uuid[]) ORDER BY "tenantId", "email"`,
      [tenantIds],
    )) as { tenantId: string; email: string }[];
    const recipientsByTenant = new Map<string, string[]>();
    for (const row of recipientRows) {
      const parsed = emailSchema.safeParse(row.email);
      if (!parsed.success) continue;
      const recipients = recipientsByTenant.get(row.tenantId) ?? [];
      recipients.push(parsed.data);
      recipientsByTenant.set(row.tenantId, recipients);
    }

    const matchesByTenant = new Map<string, MatchRecord[]>();
    for (const match of unplannedMatches) {
      const tenantMatches = matchesByTenant.get(match.tenantId) ?? [];
      tenantMatches.push(match);
      matchesByTenant.set(match.tenantId, tenantMatches);
    }
    return [...matchesByTenant.entries()].map(([tenantId, tenantMatches]) => ({
      tenantId,
      recipientEmails: recipientsByTenant.get(tenantId) ?? [],
      facts: tenantMatches.map((record) => ({
        match: mapMatchForDigest(record),
        offer: offers.get(record.offerId) ?? null,
      })),
    }));
  }

  async enqueue(
    recipientEmail: string,
    payload: NotificationDigestPayload,
  ): Promise<boolean> {
    const outbox = await this.outbox.enqueue(recipientEmail, payload);
    if (outbox === null) return false;
    const offers = payload.groups.flatMap((group) => group.offers);
    const events = await this.dataSource
      .getRepository(NotificationEventRecord)
      .findBy({
        tenantId: payload.tenantId,
        noveltyKey: In(offers.map(({ noveltyKey }) => noveltyKey)),
      });
    const eventKeys = new Set(
      events.map(
        ({ watchRuleId, noveltyKey }) => `${watchRuleId}:${noveltyKey}`,
      ),
    );
    return offers.every(({ watchRuleId, noveltyKey }) =>
      eventKeys.has(`${watchRuleId}:${noveltyKey}`),
    );
  }
}

function mapMatchForDigest(record: MatchRecord): unknown {
  try {
    return mapMatchRecord(record);
  } catch {
    return null;
  }
}

function mapOfferForDigest(record: OfferRecord): unknown {
  try {
    return mapPublishedOfferRecord(record);
  } catch {
    return null;
  }
}
