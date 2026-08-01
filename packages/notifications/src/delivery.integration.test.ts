import {
  createAppDataSource,
  NotificationEventRecord,
  NotificationOutboxRecord,
  NotificationPreferenceRecord,
  TenantRecord,
  TypeOrmNotificationOutboxStore,
} from "@shopsmart/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { integrationDatabaseUrl } from "../../../tests/integration-database.js";

import {
  NotificationDeliveryService,
  NotificationProviderError,
  type NotificationProvider,
} from "./delivery.js";

const databaseUrl = integrationDatabaseUrl();
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const tenantId = "018f5f70-7b5d-7a21-9f49-01b7f63a9601";
const watchRuleId = "018f5f70-7b5d-7a21-9f49-01b7f63a9602";

describeWithDatabase("exactly-once notification delivery", () => {
  let dataSource: ReturnType<typeof createAppDataSource> | undefined;
  let store: TypeOrmNotificationOutboxStore | undefined;

  beforeAll(async () => {
    dataSource = createAppDataSource(databaseUrl);
    await dataSource.initialize();
    await dataSource.runMigrations();
    store = new TypeOrmNotificationOutboxStore(dataSource);
  });

  beforeEach(async () => {
    if (!dataSource) return;
    await clearFixture(dataSource);
    await dataSource.getRepository(TenantRecord).save({
      id: tenantId,
      name: "Synthetic notification tenant",
    });
    await dataSource.getRepository(NotificationPreferenceRecord).save({
      tenantId,
      emailDigestEnabled: true,
      locale: "cs",
      timezone: "Europe/Prague",
    });
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    await clearFixture(dataSource);
    await dataSource.destroy();
  });

  it("commits only provider-confirmed delivery and makes the next unchanged evaluation silent", async () => {
    if (!store || !dataSource) throw new Error("Store was not initialized.");
    const provider = new FakeProvider();
    const payload = digest("1", "a");

    const queued = await store.enqueue(
      "synthetic-recipient@example.invalid",
      payload,
    );
    const duplicate = await store.enqueue(
      "synthetic-recipient@example.invalid",
      payload,
    );
    expect(duplicate?.id).toBe(queued?.id);

    await new NotificationDeliveryService(store, provider).deliver(queued!.id);

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.idempotencyKey).toBe(queued?.idempotencyKey);
    expect(
      await dataSource.getRepository(NotificationOutboxRecord).findOneByOrFail({
        id: queued!.id,
      }),
    ).toMatchObject({
      status: "awaiting-confirmation",
      providerMessageId: "provider-1",
    });
    expect(
      await dataSource.getRepository(NotificationEventRecord).findOneByOrFail({
        outboxId: queued!.id,
      }),
    ).toMatchObject({ state: "pending" });

    await store.recordProviderEvent("provider-1", "delivered");

    expect(
      await dataSource.getRepository(NotificationOutboxRecord).findOneByOrFail({
        id: queued!.id,
      }),
    ).toMatchObject({ status: "delivered", providerMessageId: "provider-1" });
    expect(
      await dataSource.getRepository(NotificationEventRecord).findOneByOrFail({
        outboxId: queued!.id,
      }),
    ).toMatchObject({ state: "notified" });

    await expect(
      store.enqueue("synthetic-recipient@example.invalid", digest("2", "a")),
    ).resolves.toBeNull();
    expect(provider.calls).toHaveLength(1);

    const previous = digest("3", "a").groups[0]!.offers[0]!;
    const novel = digest("3", "b").groups[0]!.offers[0]!;
    const delta = await store.enqueue("synthetic-recipient@example.invalid", {
      ...digest("3", "a"),
      groups: [
        {
          ...digest("3", "a").groups[0]!,
          offers: [previous, novel],
        },
      ],
    });
    expect(
      delta?.payload.groups.flatMap(({ offers }) =>
        offers.map(({ noveltyKey }) => noveltyKey),
      ),
    ).toEqual([novel.noveltyKey]);
  });

  it("preserves the immutable payload and previous state on provider failure", async () => {
    if (!store || !dataSource) throw new Error("Store was not initialized.");
    const provider = new FakeProvider();
    const first = await store.enqueue(
      "synthetic-recipient@example.invalid",
      digest("1", "a"),
    );
    await new NotificationDeliveryService(store, provider).deliver(first!.id);
    await store.recordProviderEvent("provider-1", "delivered");

    const secondPayload = digest("2", "b");
    const second = await store.enqueue(
      "synthetic-recipient@example.invalid",
      secondPayload,
    );
    provider.failure = new NotificationProviderError(
      "TEMPORARY_PROVIDER_FAILURE",
      true,
    );
    await expect(
      new NotificationDeliveryService(store, provider).deliver(second!.id),
    ).rejects.toMatchObject({ code: "TEMPORARY_PROVIDER_FAILURE" });

    const failed = await dataSource
      .getRepository(NotificationOutboxRecord)
      .findOneByOrFail({ id: second!.id });
    expect(failed).toMatchObject({ status: "retry", attempts: 1 });
    expect(failed.payload).toEqual(secondPayload);
    const events = await dataSource
      .getRepository(NotificationEventRecord)
      .find({
        order: { createdAt: "ASC" },
      });
    expect(events.map(({ state }) => state)).toEqual(["notified", "pending"]);
  });

  it("models unsubscribe, suppression, bounce, and dead-letter terminal states", async () => {
    if (!store || !dataSource) throw new Error("Store was not initialized.");
    const provider = new FakeProvider();
    const bounced = await store.enqueue(
      "synthetic-recipient@example.invalid",
      digest("1", "a"),
    );
    await new NotificationDeliveryService(store, provider).deliver(bounced!.id);
    await store.recordProviderEvent("provider-1", "bounced");
    await store.recordProviderEvent("provider-1", "bounced");
    expect(
      await dataSource.getRepository(NotificationOutboxRecord).findOneByOrFail({
        id: bounced!.id,
      }),
    ).toMatchObject({ status: "bounced" });

    const pending = await store.enqueue(
      "synthetic-recipient@example.invalid",
      digest("2", "b"),
    );
    await store.unsubscribe(tenantId);
    expect(
      await dataSource.getRepository(NotificationOutboxRecord).findOneByOrFail({
        id: pending!.id,
      }),
    ).toMatchObject({ status: "unsubscribed" });

    await dataSource
      .getRepository(NotificationPreferenceRecord)
      .update({ tenantId }, { emailDigestEnabled: true });
    const dead = await store.enqueue(
      "synthetic-recipient@example.invalid",
      digest("3", "c"),
    );
    provider.failure = new NotificationProviderError(
      "PERMANENT_FAILURE",
      false,
    );
    await expect(
      new NotificationDeliveryService(store, provider).deliver(dead!.id),
    ).rejects.toBeInstanceOf(NotificationProviderError);
    expect(
      await dataSource.getRepository(NotificationOutboxRecord).findOneByOrFail({
        id: dead!.id,
      }),
    ).toMatchObject({ status: "dead-letter" });
  });
});

class FakeProvider implements NotificationProvider {
  readonly calls: { idempotencyKey: string }[] = [];
  failure?: NotificationProviderError;

  async send(input: { idempotencyKey: string }) {
    this.calls.push(input);
    if (this.failure) throw this.failure;
    return { providerMessageId: `provider-${this.calls.length}` };
  }
}

function digest(interval: string, novelty: string) {
  return {
    contractVersion: "1",
    tenantId,
    intervalKey: `2026-08-0${interval}`,
    locale: "cs",
    groups: [
      {
        canonicalProductClassId: "018f5f70-7b5d-7a21-9f49-01b7f63a9603",
        currency: "CZK",
        comparisonUnit: "100-gram",
        offers: [
          {
            matchId: novelty.repeat(64),
            watchRuleId,
            offerId: "018f5f70-7b5d-7a21-9f49-01b7f63a9604",
            noveltyKey: `offer-novelty:v1:${novelty.repeat(64)}`,
            retailer: {
              id: "018f5f70-7b5d-7a21-9f49-01b7f63a9605",
              name: "Synthetic Retailer",
            },
            exactName: "Synthetic curd 250 g",
            variantAttributes: { fatClass: "low-fat" },
            package: {
              declared: "250 g",
              quantity: { amount: "250", unit: "gram" },
              count: 1,
            },
            price: { amount: "49.90", currency: "CZK" },
            regularPrice: null,
            discountPercent: null,
            normalizedUnitPrice: {
              amount: "19.96",
              currency: "CZK",
              unit: "100-gram",
            },
            membership: { kind: "none" },
            locality: {
              kind: "physical",
              storeId: "018f5f70-7b5d-7a21-9f49-01b7f63a9606",
              applicability: "store",
            },
            availability: {
              kind: "physical",
              evidence: "flyer-applicability",
              stockStatus: "not-asserted",
            },
            validity: {
              validFrom: "2026-08-01T00:00:00.000Z",
              validTo: "2026-08-07T23:59:59.000Z",
            },
            thresholdReason: {
              scope: "fallback",
              predicate: "max-unit-price",
              actual: "19.96",
              limit: "20.00",
            },
            sourceUrl: "https://retailer.example.invalid/offers/curd",
            retrievedAt: "2026-08-01T06:00:00.000Z",
            evidenceLevel: "official",
          },
        ],
      },
    ],
  } as const;
}

async function clearFixture(
  dataSource: NonNullable<ReturnType<typeof createAppDataSource>>,
) {
  await dataSource
    .getRepository(TenantRecord)
    .createQueryBuilder()
    .delete()
    .where("id = :tenantId", { tenantId })
    .execute();
}
