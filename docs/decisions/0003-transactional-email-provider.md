# ADR 0003: Resend as the first transactional e-mail adapter

- Status: accepted for implementation; live sending remains a production gate
- Date: 2026-08-01
- Scope: aggregated offer digests, provider idempotency, delivery confirmation, bounces, suppressions, and unsubscribe

## Decision

ShopSmart will implement Resend as its first production e-mail adapter. The domain and persistence layers remain provider-neutral: an adapter submits one validated aggregate with the outbox idempotency key, stores the returned provider message ID, and waits for a verified `email.delivered` webhook before atomically marking novelty events as notified. API acceptance alone is not delivery confirmation.

The PostgreSQL outbox is the authority for exactly-once application state. Resend's `Idempotency-Key` is a second line of defence for a retry after an uncertain API outcome, not a replacement for database uniqueness. Resend retains these keys for 24 hours, so retries outside that window must still be controlled by the immutable outbox record and operator-visible dead-letter policy.

No live adapter, API key, sender identity, recipient, or webhook endpoint is introduced by this decision. Those require a separate production-readiness change and an end-to-end test using provider-owned test addresses.

References:

- [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys)
- [Resend send API](https://resend.com/docs/api-reference/emails/send-email)
- [Resend delivered webhook](https://resend.com/docs/webhooks/emails/delivered)
- [Resend bounced webhook](https://resend.com/docs/webhooks/emails/bounced)
- [Resend suppression behaviour](https://resend.com/docs/dashboard/emails/email-suppressions)

## Comparison

| Provider | Delivery and failure events | Provider-side send idempotency | Operational fit for the first adapter |
| --- | --- | --- | --- |
| Resend | Delivered and bounced webhooks; suppression is documented | Explicit `Idempotency-Key`, retained for 24 hours | Small HTTP/TypeScript integration and the strongest documented duplicate-send guard of the compared options |
| Postmark | Delivery/bounce webhooks and suppression APIs | No equivalent send idempotency key was found in the reviewed send API documentation | Mature event model, but uncertain send outcomes would rely only on ShopSmart's database state |
| Amazon SES v2 | Delivery/bounce/complaint events through AWS event infrastructure and suppression lists | `SendEmail` does not document a client idempotency token | Strong scale and AWS integration, but more infrastructure than the local-first MVP needs |

Reviewed primary documentation:

- [Postmark send API](https://postmarkapp.com/developer/user-guide/send-email-with-api)
- [Postmark webhook overview](https://postmarkapp.com/developer/webhooks/webhooks-overview)
- [Postmark suppressions API](https://postmarkapp.com/developer/api/suppressions-api)
- [Amazon SES v2 SendEmail](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html)
- [Amazon SES notification event contents](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-contents.html)
- [Amazon SES suppression lists](https://docs.aws.amazon.com/ses/latest/dg/sending-email-suppression-list.html)

## Delivery state contract

1. Enqueue creates one immutable digest per tenant and interval and reserves each `(tenant, watch rule, novelty key)`.
2. A worker transactionally claims `pending` or `retry` work and increments its attempt counter.
3. Provider API acceptance stores the message ID and moves the outbox to `awaiting-confirmation`; novelty events remain `pending`.
4. A signature-verified, replay-safe delivered webhook atomically marks the delivery `provider-confirmed`, the outbox `delivered`, and its novelty events `notified`.
5. A retryable submission failure preserves the payload and moves the outbox to `retry`; a permanent or exhausted failure moves it to `dead-letter`.
6. Bounce and suppression events are terminal delivery states. Unsubscribe disables future enqueueing and cancels work that has not yet been claimed by a worker.

## Security and privacy gates for the live adapter

- Keep the API key only in the deployment secret store and never in fixtures, logs, or GitHub.
- Verify webhook signatures against the raw request body before parsing or mutating state, and process webhook event IDs idempotently.
- Do not log recipient addresses or rendered payloads. Use provider message IDs and bounded reason codes for diagnostics.
- Render an unsubscribe URL into every digest and enforce the local preference before enqueue and immediately before submission.
- Configure and verify SPF, DKIM, DMARC, sender domain, regional data processing, retention, and a provider data-processing agreement before real recipient data is used.
