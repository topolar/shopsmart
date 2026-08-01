import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateNotificationOutbox20260801130000 implements MigrationInterface {
  name = "CreateNotificationOutbox20260801130000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "notification_outbox" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "interval_key" varchar(160) NOT NULL,
        "recipient_email" varchar(320) NOT NULL,
        "payload" jsonb NOT NULL,
        "idempotency_key" varchar(96) NOT NULL,
        "status" varchar(24) NOT NULL,
        "attempts" integer NOT NULL DEFAULT 0,
        "max_attempts" integer NOT NULL DEFAULT 3,
        "provider_message_id" varchar(240) NULL,
        "last_error_code" varchar(120) NULL,
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "uq_notification_outbox_idempotency" UNIQUE ("idempotency_key"),
        CONSTRAINT "uq_notification_outbox_tenant_interval"
          UNIQUE ("tenant_id", "interval_key"),
        CONSTRAINT "fk_notification_outbox_tenant" FOREIGN KEY ("tenant_id")
          REFERENCES "tenants"("id") ON DELETE CASCADE,
        CONSTRAINT "ck_notification_outbox_status" CHECK (
          "status" IN ('pending','processing','awaiting-confirmation','retry',
            'delivered','bounced','suppressed','unsubscribed','dead-letter')
        )
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "notification_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "outbox_id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "watch_rule_id" uuid NOT NULL,
        "novelty_key" varchar(96) NOT NULL,
        "state" varchar(16) NOT NULL,
        "notified_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "uq_notification_events_tenant_rule_novelty"
          UNIQUE ("tenant_id", "watch_rule_id", "novelty_key"),
        CONSTRAINT "fk_notification_events_outbox" FOREIGN KEY ("outbox_id")
          REFERENCES "notification_outbox"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_notification_events_tenant" FOREIGN KEY ("tenant_id")
          REFERENCES "tenants"("id") ON DELETE CASCADE,
        CONSTRAINT "ck_notification_events_state" CHECK ("state" IN ('pending','notified'))
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "notification_deliveries" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "outbox_id" uuid NOT NULL,
        "provider_message_id" varchar(240) NOT NULL,
        "status" varchar(24) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "uq_notification_deliveries_outbox" UNIQUE ("outbox_id"),
        CONSTRAINT "uq_notification_deliveries_provider_message"
          UNIQUE ("provider_message_id"),
        CONSTRAINT "fk_notification_deliveries_outbox" FOREIGN KEY ("outbox_id")
          REFERENCES "notification_outbox"("id") ON DELETE CASCADE,
        CONSTRAINT "ck_notification_deliveries_status" CHECK (
          "status" IN ('accepted','provider-confirmed','bounced','suppressed')
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_notification_outbox_due" ON "notification_outbox" ("status", "created_at")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "notification_deliveries"`);
    await queryRunner.query(`DROP TABLE "notification_events"`);
    await queryRunner.query(`DROP TABLE "notification_outbox"`);
  }
}
