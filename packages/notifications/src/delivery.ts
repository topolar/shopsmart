import type { NotificationDigestPayload } from "@shopsmart/contracts";
import type { TypeOrmNotificationOutboxStore } from "@shopsmart/database";

export type NotificationProviderInput = Readonly<{
  recipientEmail: string;
  payload: NotificationDigestPayload;
  idempotencyKey: string;
}>;

export interface NotificationProvider {
  send(
    input: NotificationProviderInput,
  ): Promise<Readonly<{ providerMessageId: string }>>;
}

export class NotificationProviderError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "NotificationProviderError";
  }
}

export class NotificationDeliveryService {
  constructor(
    private readonly store: TypeOrmNotificationOutboxStore,
    private readonly provider: NotificationProvider,
  ) {}

  async deliver(outboxId: string): Promise<void> {
    const claimed = await this.store.claim(outboxId);
    if (!claimed) return;

    try {
      const result = await this.provider.send({
        recipientEmail: claimed.recipientEmail,
        payload: claimed.payload,
        idempotencyKey: claimed.idempotencyKey,
      });
      await this.store.accept(claimed.id, result.providerMessageId);
    } catch (error) {
      const providerError =
        error instanceof NotificationProviderError
          ? error
          : new NotificationProviderError("UNKNOWN_PROVIDER_FAILURE", true);
      await this.store.fail(
        claimed.id,
        providerError.code,
        providerError.retryable,
      );
      throw providerError;
    }
  }
}
