# AI-assist operations

The AI-assist package is an optional candidate-generation boundary. It does not
publish offers, calculate authoritative values, authorize users, or change
notification state. No live model provider is configured in this repository.
All maintained tests use synthetic adapters and fixtures.

## Processing contract

`@shopsmart/ai-assist` accepts a versioned request containing the task type,
prompt version, source snapshot identity, source content hash, source length,
and a bounded budget. A provider adapter must return the versioned Zod proposal
from `@shopsmart/contracts`, including:

- provider, model name, and model version;
- prompt version and task key;
- confidence and token/cost usage;
- source-bound evidence spans for every required field;
- either a product-mapping or flyer-extraction candidate payload.

The runner rejects oversized input before calling a provider and passes the
configured output-token ceiling to the adapter. It records provider/schema
failures without storing raw source text. The deterministic validator checks
the schema, budget, confidence, evidence hash and bounds, required evidence
fields, mapping identity, source URL, store scope, and canonical allowlists.
Its only successful states are `pending-review` and `quarantined`; there is no
automatic publish path.

## Persistence and reuse

TypeORM migrations create proposal, immutable review, approved-cache, and
failure tables. An approved product mapping is applied transactionally only if
the current retailer mapping candidate and canonical attributes still match the
validated proposal. Approved stable results use a task/input/prompt cache key
that is independent of tenant identity, so shared ingestion does not purchase
the same interpretation per user.

Flyer extraction approval records the reviewed candidate in the cache only. It
does not create or publish an offer; the ordinary evidence, normalization,
validity, locality, and publication pipeline remains mandatory.

## Operator review

Register the intended account normally, stop public write traffic to the local
instance, and grant the role through the local database administration command:

```powershell
pnpm operator:grant -- --email <existing-account-email>
```

The command returns only the account ID and resulting status. Public sign-up
always creates an ordinary `user`; an email address alone can never grant the
operator role. Run the command only from the trusted host with the private
database connection, and never commit a real address or its shell output.

With the local API and web running, open `/operator/ai-review`. The page shows
model and prompt provenance, confidence, usage/cost, evidence spans, validation
reasons, and the structured candidate. Only an authenticated operator can list
or decide proposals. Quarantined candidates cannot be approved. A second
decision returns HTTP 409 and cannot overwrite the original audit record.

Review API endpoints:

- `GET /api/v1/operator/ai-assist/proposals`
- `POST /api/v1/operator/ai-assist/proposals/:proposalId/review`

## Verification

Run the synthetic AI-assist tests without external credentials or model calls:

```powershell
pnpm test:ai-assist
pnpm test:integration
```

Before enabling any live provider, add a provider-specific issue covering data
handling, retention, regional processing, credentials, pricing, rate limits,
timeouts, retry behavior, observability, and a separately approved cost budget.
The provider adapter must not receive private addresses, authentication data,
cookies, or raw user exports.
