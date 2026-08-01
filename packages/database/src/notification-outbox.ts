import {
  notificationDigestPayloadSchema,
  type NotificationDigestPayload,
  type NotificationOutboxStatus,
} from "@shopsmart/contracts";
import { createDigestIdempotencyKey } from "@shopsmart/domain";
import { EntitySchema, In, type DataSource } from "typeorm";

import { NotificationPreferenceRecord } from "./onboarding-store.js";

export class NotificationOutboxRecord {
  id!: string;
  tenantId!: string;
  intervalKey!: string;
  recipientEmail!: string;
  payload!: NotificationDigestPayload;
  idempotencyKey!: string;
  status!: NotificationOutboxStatus;
  attempts!: number;
  maxAttempts!: number;
  providerMessageId!: string | null;
  lastErrorCode!: string | null;
  createdAt!: Date;
  updatedAt!: Date;
}

export class NotificationEventRecord {
  id!: string;
  outboxId!: string;
  tenantId!: string;
  watchRuleId!: string;
  noveltyKey!: string;
  state!: "pending" | "notified";
  notifiedAt!: Date | null;
  createdAt!: Date;
}

export class NotificationDeliveryRecord {
  id!: string;
  outboxId!: string;
  providerMessageId!: string;
  status!: "accepted" | "provider-confirmed" | "bounced" | "suppressed";
  createdAt!: Date;
  updatedAt!: Date;
}

export const notificationOutboxRecordSchema =
  new EntitySchema<NotificationOutboxRecord>({
    name: "NotificationOutboxRecord",
    tableName: "notification_outbox",
    target: NotificationOutboxRecord,
    columns: {
      id: { type: "uuid", primary: true, generated: "uuid" },
      tenantId: { name: "tenant_id", type: "uuid" },
      intervalKey: { name: "interval_key", type: "varchar", length: 160 },
      recipientEmail: {
        name: "recipient_email",
        type: "varchar",
        length: 320,
      },
      payload: { type: "jsonb" },
      idempotencyKey: {
        name: "idempotency_key",
        type: "varchar",
        length: 96,
        unique: true,
      },
      status: { type: "varchar", length: 24 },
      attempts: { type: "integer", default: 0 },
      maxAttempts: { name: "max_attempts", type: "integer", default: 3 },
      providerMessageId: {
        name: "provider_message_id",
        type: "varchar",
        length: 240,
        nullable: true,
      },
      lastErrorCode: {
        name: "last_error_code",
        type: "varchar",
        length: 120,
        nullable: true,
      },
      createdAt: { name: "created_at", type: "timestamptz", createDate: true },
      updatedAt: { name: "updated_at", type: "timestamptz", updateDate: true },
    },
    uniques: [
      {
        name: "uq_notification_outbox_tenant_interval",
        columns: ["tenantId", "intervalKey"],
      },
    ],
  });

export const notificationEventRecordSchema =
  new EntitySchema<NotificationEventRecord>({
    name: "NotificationEventRecord",
    tableName: "notification_events",
    target: NotificationEventRecord,
    columns: {
      id: { type: "uuid", primary: true, generated: "uuid" },
      outboxId: { name: "outbox_id", type: "uuid" },
      tenantId: { name: "tenant_id", type: "uuid" },
      watchRuleId: { name: "watch_rule_id", type: "uuid" },
      noveltyKey: { name: "novelty_key", type: "varchar", length: 96 },
      state: { type: "varchar", length: 16 },
      notifiedAt: { name: "notified_at", type: "timestamptz", nullable: true },
      createdAt: { name: "created_at", type: "timestamptz", createDate: true },
    },
    uniques: [
      {
        name: "uq_notification_events_tenant_rule_novelty",
        columns: ["tenantId", "watchRuleId", "noveltyKey"],
      },
    ],
  });

export const notificationDeliveryRecordSchema =
  new EntitySchema<NotificationDeliveryRecord>({
    name: "NotificationDeliveryRecord",
    tableName: "notification_deliveries",
    target: NotificationDeliveryRecord,
    columns: {
      id: { type: "uuid", primary: true, generated: "uuid" },
      outboxId: { name: "outbox_id", type: "uuid", unique: true },
      providerMessageId: {
        name: "provider_message_id",
        type: "varchar",
        length: 240,
        unique: true,
      },
      status: { type: "varchar", length: 24 },
      createdAt: { name: "created_at", type: "timestamptz", createDate: true },
      updatedAt: { name: "updated_at", type: "timestamptz", updateDate: true },
    },
  });

export type ClaimedNotification = Readonly<{
  id: string;
  recipientEmail: string;
  payload: NotificationDigestPayload;
  idempotencyKey: string;
}>;

export class TypeOrmNotificationOutboxStore {
  constructor(private readonly dataSource: DataSource) {}

  async enqueue(
    recipientEmail: string,
    payloadInput: unknown,
  ): Promise<NotificationOutboxRecord | null> {
    const payload = notificationDigestPayloadSchema.parse(payloadInput);
    return this.dataSource.transaction(async (manager) => {
      const preference = await manager
        .getRepository(NotificationPreferenceRecord)
        .findOneBy({ tenantId: payload.tenantId });
      if (!preference?.emailDigestEnabled) return null;

      const outboxRepository = manager.getRepository(NotificationOutboxRecord);
      const existingOutbox = await outboxRepository.findOneBy({
        tenantId: payload.tenantId,
        intervalKey: payload.intervalKey,
      });
      if (existingOutbox) return existingOutbox;

      const offers = payload.groups.flatMap(({ offers }) => offers);
      const existingEvents = await manager
        .getRepository(NotificationEventRecord)
        .findBy({
          tenantId: payload.tenantId,
          noveltyKey: In(offers.map(({ noveltyKey }) => noveltyKey)),
        });
      const existingKeys = new Set(
        existingEvents.map(
          ({ watchRuleId, noveltyKey }) => `${watchRuleId}:${noveltyKey}`,
        ),
      );
      const newOffers = offers.filter(
        ({ watchRuleId, noveltyKey }) =>
          !existingKeys.has(`${watchRuleId}:${noveltyKey}`),
      );
      if (newOffers.length === 0) return null;

      const newOfferKeys = new Set(
        newOffers.map(
          ({ watchRuleId, noveltyKey }) => `${watchRuleId}:${noveltyKey}`,
        ),
      );
      const filteredPayload = notificationDigestPayloadSchema.parse({
        ...payload,
        groups: payload.groups
          .map((group) => ({
            ...group,
            offers: group.offers.filter(({ watchRuleId, noveltyKey }) =>
              newOfferKeys.has(`${watchRuleId}:${noveltyKey}`),
            ),
          }))
          .filter(({ offers: groupOffers }) => groupOffers.length > 0),
      });

      const outbox = await outboxRepository.save({
        tenantId: payload.tenantId,
        intervalKey: payload.intervalKey,
        recipientEmail,
        payload: filteredPayload,
        idempotencyKey: createDigestIdempotencyKey(filteredPayload),
        status: "pending",
        attempts: 0,
        maxAttempts: 3,
        providerMessageId: null,
        lastErrorCode: null,
      });
      await manager.getRepository(NotificationEventRecord).save(
        newOffers.map(({ noveltyKey, watchRuleId }) => ({
          outboxId: outbox.id,
          tenantId: payload.tenantId,
          watchRuleId,
          noveltyKey,
          state: "pending" as const,
          notifiedAt: null,
        })),
      );
      return outbox;
    });
  }

  async claim(id: string): Promise<ClaimedNotification | null> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(NotificationOutboxRecord);
      const outbox = await repository.findOne({
        where: { id },
        lock: { mode: "pessimistic_write" },
      });
      if (!outbox || !["pending", "retry"].includes(outbox.status)) return null;
      outbox.status = "processing";
      outbox.attempts += 1;
      await repository.save(outbox);
      return {
        id: outbox.id,
        recipientEmail: outbox.recipientEmail,
        payload: outbox.payload,
        idempotencyKey: outbox.idempotencyKey,
      };
    });
  }

  async accept(id: string, providerMessageId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const outbox = await manager
        .getRepository(NotificationOutboxRecord)
        .findOneByOrFail({ id });
      if (outbox.status !== "processing") return;
      await manager.getRepository(NotificationDeliveryRecord).save({
        outboxId: id,
        providerMessageId,
        status: "accepted",
      });
      await manager.getRepository(NotificationOutboxRecord).update(
        { id },
        {
          status: "awaiting-confirmation",
          providerMessageId,
          lastErrorCode: null,
        },
      );
    });
  }

  async fail(id: string, errorCode: string, retryable: boolean): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(NotificationOutboxRecord);
      const outbox = await repository.findOneByOrFail({ id });
      const status =
        retryable && outbox.attempts < outbox.maxAttempts
          ? "retry"
          : "dead-letter";
      await repository.update({ id }, { status, lastErrorCode: errorCode });
    });
  }

  async recordProviderEvent(
    providerMessageId: string,
    status: "delivered" | "bounced" | "suppressed",
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const deliveryRepository = manager.getRepository(
        NotificationDeliveryRecord,
      );
      const delivery = await deliveryRepository.findOne({
        where: { providerMessageId },
        lock: { mode: "pessimistic_write" },
      });
      if (!delivery) throw new Error("UNKNOWN_PROVIDER_MESSAGE");
      const deliveryStatus =
        status === "delivered" ? "provider-confirmed" : status;
      if (delivery.status !== "accepted") {
        if (delivery.status === deliveryStatus) return;
        throw new Error("CONFLICTING_PROVIDER_EVENT");
      }
      if (status === "delivered") {
        await deliveryRepository.update(
          { id: delivery.id },
          { status: "provider-confirmed" },
        );
        await manager
          .getRepository(NotificationEventRecord)
          .update(
            { outboxId: delivery.outboxId, state: "pending" },
            { state: "notified", notifiedAt: new Date() },
          );
        await manager
          .getRepository(NotificationOutboxRecord)
          .update({ id: delivery.outboxId }, { status: "delivered" });
        return;
      }
      await manager
        .getRepository(NotificationDeliveryRecord)
        .update({ id: delivery.id }, { status });
      await manager
        .getRepository(NotificationOutboxRecord)
        .update({ id: delivery.outboxId }, { status });
    });
  }

  async unsubscribe(tenantId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager
        .getRepository(NotificationPreferenceRecord)
        .update({ tenantId }, { emailDigestEnabled: false });
      await manager.getRepository(NotificationOutboxRecord).update(
        {
          tenantId,
          status: In(["pending", "retry"]),
        },
        { status: "unsubscribed" },
      );
    });
  }
}
