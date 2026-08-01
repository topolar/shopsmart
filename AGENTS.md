# ShopSmart agent instructions

## Mission

ShopSmart is a public, multi-tenant service that collects retail offers once, normalizes them into a shared evidence-backed catalogue, and matches them deterministically against each user's products, locations, reachable stores, online channels, loyalty memberships, and price rules. Results are presented in a web UI and optional aggregated email digests.

Read `PLAN.md` and `README.md` before changing architecture or behavior. The repository currently contains a planning baseline, not an implemented application.

## Non-negotiable product principles

1. **Shared ingestion, personalized matching.** Never crawl the same retailer independently for every user. Fetch each retailer/region/store scope once, cache the normalized result, then fan out matches with deterministic queries.
2. **Deterministic core, AI at uncertain edges.** Prices, unit conversions, validity, sorting, thresholds, deduplication, locality gates, authorization, scheduling, and delivery state must be ordinary tested code. AI may propose structured interpretations of ambiguous free text or unstructured flyers, but may not be the final authority.
3. **Evidence before alerts.** Every published offer must retain a concrete HTTP(S) source URL, retrieval timestamp, exact product identity, package, price, normalization unit, validity, membership condition, channel, and locality/availability evidence. Search snippets are discovery only.
4. **Fail closed.** If identity, pack size, comparison unit, validity, source, local applicability, or required online availability is uncertain, suppress the match rather than guessing.
5. **Comparable sorting.** Group offers by canonical watched product. Sort within a group by the configured normalized unit price ascending; use total package price and retailer name only as deterministic tie-breakers. Never compare incompatible units silently.
6. **Fresh dynamic data, cached static context.** Store existence, addresses, store type, official source URLs, and general delivery areas use TTL caches. Prices, packs, validity, club conditions, and qualifying online stock remain dynamic. Refresh static data early only on a broken URL, contradiction, official change signal, qualifying candidate from an unknown retailer, or explicit request.
7. **Exactly-once notification semantics.** A candidate becomes notified only after the provider confirms delivery. Use stable novelty keys plus provider idempotency. Preserve pending payloads on failure. Never send empty or duplicate digests.
8. **Privacy by design.** This is a public repository. Never commit personal email addresses, home addresses, API keys, cookies, retailer accounts, raw user exports, or production snapshots. Use synthetic fixtures and `.env.example` placeholders.
9. **Respect source terms.** Prefer official APIs, feeds, product pages, and flyers. Respect robots.txt, rate limits, copyright, and site terms. Do not bypass authentication, CAPTCHAs, bot protection, paywalls, or technical access controls.
10. **Transparent freshness.** Every UI/email claim must expose source and last verification time. A flyer price is not the same as store stock; label the evidence level explicitly.

## Canonical domain rules

- Keep canonical product classes separate from retailer SKUs and user watch rules.
- Preserve original package price and pack/count even when normalized prices are available.
- Supported comparison families include currency per kilogram, 100 g, 250 g, piece, roll, metre, litre, and other explicitly configured units.
- Product identity can include required attributes and exclusions: scent, fat class, preparation, size/grade, housing method, flavour, country of origin, fresh/frozen state, and membership requirements.
- Loyalty/app/coupon requirements are material offer attributes and belong in the novelty key.
- URL changes alone must not create a new offer. Price, pack, store/channel, validity, or membership changes do.
- Aggregators may discover candidates. An aggregator-sourced alert requires an official or independent secondary verification URL.
- Physical flyer applicability and online obtainability are separate evidence types.
- Online candidates require current product-specific stock plus delivery/pickup details for the user's configured locality. General service-area support may be cached, but it is not product stock.
- Offers with an explicit validity end can remain active until that end unless contradicted. Ongoing online prices without an end date require regular price and stock revalidation.

## AI boundary

AI is allowed to:

- translate a user's natural-language request into a proposed structured watch rule;
- extract candidate fields from an image/PDF flyer when deterministic parsing is insufficient;
- propose product/entity mappings across inconsistent retailer names;
- classify ambiguous attributes and flag source conflicts for review;
- generate optional human-readable explanations from already validated facts.

AI is not allowed to:

- invent or calculate authoritative prices, discounts, validity, stock, or unit conversions;
- decide authorization, notification state, billing, retry, or idempotency;
- publish a match without deterministic schema and provenance validation;
- silently overwrite a verified canonical product mapping;
- execute one full web-research agent per user as the normal ingestion model.

Persist approved AI outputs so the same stable product mapping or document interpretation is not purchased repeatedly. Store model/version, confidence, evidence spans, and review status.

## Engineering workflow

1. Read the relevant plan section and identify the deterministic contract.
2. For every behavior change, write a failing focused test first and observe the expected failure.
3. Implement the smallest vertical slice that passes it.
4. Run the focused test, then the maintained full suite.
5. Use migrations for schema changes; never mutate production schemas ad hoc.
6. Validate fixtures contain no personal data or secrets before committing.
7. Update `PLAN.md` when a decision, risk, source constraint, or milestone changes.
8. Report actual command output; never claim a fetch, send, migration, deployment, or test succeeded without execution evidence.

## GitHub Issues work ledger

GitHub Issues are the authoritative queue and audit trail for repository work. Use the repository skill `track-github-work` for the live workflow.

1. Every task that changes tracked files must have one primary GitHub Issue before the first edit. Read-only investigation and status reporting may use an existing issue without creating a new one.
2. Use an issue supplied by the user when it matches the requested scope. Otherwise search open issues for a clear match before creating a new task, bug, or decision issue from the repository templates. Do not create duplicates.
3. Record the goal, acceptance criteria, scope or non-goals, and known dependencies or evidence in the issue. Update the issue before materially expanding or changing that scope.
4. Treat assignment as ownership. Do not start an issue assigned to another person or agent without explicit confirmation. When claiming work, assign the agreed owner, replace `status:ready` with `status:in-progress`, and comment with the branch and concise execution plan.
5. Keep exactly one workflow label on every open work issue:
   - `status:ready` — defined and available to claim;
   - `status:in-progress` — actively being implemented;
   - `status:blocked` — waiting for a decision or external dependency;
   - `status:review` — a specific human review or approval is actually required before merge.
6. Add issue comments only at meaningful checkpoints: a material finding or scope change, a blocker, or a review handoff. Include executed verification commands and their actual results; do not post speculative or routine narration.
7. Before publishing completed work, post a work-log comment covering outcome, changed areas, verification, and remaining risks or follow-ups. Link the commit or pull request when one exists. Do not use `status:review` merely because work is on a branch or in a pull request.
8. An explicit instruction to commit and push, publish, land, merge, or finish completed work authorizes the agent to carry that scoped change through the repository pull-request path unless the owner asks to leave it unmerged or requests review first. Complete pull requests are ready, not draft. After required checks pass, merge without handing routine pull-request operations back to the owner when no human approval is required.
9. Pull requests must name the primary issue and use `Closes #<number>` only when merging the PR will satisfy its acceptance criteria. Use `status:review` only for an explicit review request, a required human approval, or a concrete decision outside agent authority; record the exact action needed.
10. Close an issue as completed only after the change has landed and the acceptance criteria are satisfied. Verify default-branch state and automatic issue closure rather than trusting the merge command alone. Close cancelled, duplicate, or rejected work as not planned and record the reason. Remove workflow labels when closing.
11. Never place secrets, cookies, private addresses, personal email addresses, production data, or unsanitized logs in issue bodies, comments, attachments, or linked work logs.
12. If GitHub is unavailable, report the failure and do not invent issue state. Continue offline only when the user explicitly authorizes it, then reconcile the issue before later work or handoff.

Issues track execution history; `PLAN.md` remains the durable source for accepted architecture, product decisions, risks, source constraints, and milestones.

## Technology baseline

The accepted local-first architecture is documented in `docs/TECHNICAL_ARCHITECTURE.md`.

- Use TypeScript across the web, API, canonical domain, connectors, and workers. Do not introduce Python services or tooling without a superseding GitHub decision issue and explicit owner approval.
- Use a pnpm workspace, Next.js App Router with Tailwind CSS for the web, Fastify for the private API, Zod/JSON Schema/OpenAPI contracts, and TypeORM with PostgreSQL.
- Keep TypeORM `synchronize` disabled. Change schemas only through reviewed, versioned TypeORM migrations run as an explicit release step. Inside a transaction, use only the provided transactional entity manager.
- Keep deterministic domain rules in shared TypeScript packages, not in React components, Next.js route glue, ORM models, or worker-specific copies.
- Local PostgreSQL runs in Docker as `shopsmart-postgres`, bound only to `127.0.0.1:${SHOPSMART_POSTGRES_PORT:-57432}`. Recheck port availability before creating the container.
- A future Cloudflare Tunnel may expose only the web origin. Never tunnel PostgreSQL or the private API, and never treat Cloudflare Access as a replacement for application authorization or tenant isolation.
- Keep the first local slice small: PostgreSQL-backed job leasing and outbox are preferred before adding Redis, a general queue, or Temporal without measured need.

## Expected repository structure

The initial implementation should evolve toward:

```text
apps/
  api/                 # Fastify HTTP API and application services
  web/                 # Next.js user-facing web application
workers/
  ingestion/           # retailer connectors and scheduler jobs
  matching/            # deterministic user matching/fan-out
packages/
  contracts/           # Zod, JSON Schema, and OpenAPI contracts
  domain/              # TypeScript canonical schemas and business rules
  database/            # TypeORM data source, entities, repositories, and transaction helpers
  connectors/          # TypeScript source-specific adapters
  notifications/       # web/email rendering and delivery state
  ai_assist/           # bounded optional AI extraction/mapping
migrations/            # TypeORM migrations
tests/
docs/
```

Do not create this structure as empty scaffolding merely to look complete. Add directories with the first tested vertical slice.

## Initial quality gates

Before the first production-like release, the maintained suite must prove:

- unit normalization and incompatible-unit rejection;
- required/excluded product attributes;
- source and locality fail-closed validation;
- grouping and ascending normalized-price ordering;
- membership-sensitive novelty keys;
- URL-only changes do not trigger novelty;
- successful delivery commits notification state;
- failed delivery preserves the outbox and previous state;
- the next evaluation after a successful alert is silent;
- tenant isolation and authorization;
- no fixture or log leaks secrets or personal addresses.

## Documentation language

Code identifiers and durable technical contracts should be in English. User-facing copy must be localizable; Czech is the initial reference locale. Documentation may be Czech or English, but avoid mixing languages inside a single schema contract.
