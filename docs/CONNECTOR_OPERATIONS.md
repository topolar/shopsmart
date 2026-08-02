# Connector operations

ShopSmart schedules one job per shared `sourceScopeKey`; tenant count is never part of connector scheduling. Kaufland Praha-Vypich is the first implemented source scope. Repository fixtures remain synthetic; live response bodies belong only in the ignored raw-snapshot directory.

## Shared connector platform

Every installed connector is split into three explicit layers:

1. A versioned manifest in `packages/connectors` declares the connector ID, Czech source scopes, entry URLs, content kind, parser version, capabilities, refresh and lease intervals, attempt limit, minimum rate-limit pause, and raw retention. The manifest is the policy authority; worker orchestration must not copy these values.
2. A retailer adapter owns only source-specific discovery, fetch rules, deterministic parsing, mapping lookup, and persistence translation. Different HTML, PDF, API, membership, locality, and evidence semantics remain source-specific.
3. The shared runtime in `workers/ingestion` owns registration and leasing, one-time raw purge, retained-snapshot hash verification, coverage summaries, health aggregation, and common operator commands.

The installed adapters are Albert, Globus, and Kaufland. Their manifests are checked together for unique connector/scope identities and Czech-only HTTPS entry points. The shared conformance suite covers lifecycle behavior once; every adapter still keeps synthetic source-specific fetch and parser fixtures.

### Common operator commands

```powershell
pnpm connector list
pnpm connector health
pnpm connector health --connector albert
pnpm connector run --connector globus
pnpm connector reprocess --connector albert --scope albert:cz:supermarket:physical-leaflet
pnpm connector repair --connector globus --scope globus:cz:brno:featured-offers --reason explicit-request
```

- `list` reads manifests only and does not access PostgreSQL or a retailer.
- `health` reads PostgreSQL only. Per scope it reports job state, due/lease/rate-limit timestamps, attempts, last attempt/success/content change, HTTP status, parser drift, coverage completeness, latest candidate/offer/quarantine counts, and retained raw availability/deletion time.
- `run` registers every manifest scope and claims only due shared work. It never receives a tenant or user ID. `partial` or `quarantined` coverage returns a non-zero process exit code even though the bounded JSON result is still printed.
- `reprocess` reads the newest retained snapshot, verifies its storage hash, validates its source scope, executes the current deterministic parser, and persists the result. Albert also verifies that the retained PDF is still the current official leaflet discovered by its index.
- `repair` writes an audited early-refresh event for one stable scope. Allowed reasons are `broken-url`, `contradiction`, `official-change`, `unknown-retailer`, and `explicit-request`.

Existing `ingest:*` and `mapping:*` commands remain compatibility and mapping-review entry points. New operational automation should use `pnpm connector`; product mappings must still use the retailer-specific reviewed workflow because product identity is not a generic runtime concern.

### Adding a Czech retailer adapter

1. Create or approve the exact Czech source scope and its source-specific access/evidence constraints before live fetch code.
2. Add a strict manifest with a unique `<connector>:cz:<scope>` key and measured policy values. Do not copy interval constants into the worker.
3. Add synthetic fetch/parser fixtures covering changed and unchanged content, missing evidence, invalid locality or membership, parser drift, incomplete coverage, rate limiting, and access challenges. Fixtures must contain no personal data, secrets, cookies, or live raw documents.
4. Implement deterministic fetch/parse code under `packages/connectors`. Do not put job leasing, tenant fan-out, raw filesystem policy, or notification behavior in the adapter.
5. Register the adapter with the shared runtime and implement retained reprocessing. A changed parser version must force parsing even when HTTP validators report no content change.
6. Run connector conformance, focused source tests, database integration tests, and the maintained full suite. Perform live smoke separately and record only sanitized aggregate evidence in the issue.
7. Add its exact source and repair procedure to this document. A new retailer is not complete while it requires an undocumented bespoke scheduler or health query.

### Incident and repair procedure

1. Run `pnpm connector health --connector <id>` and identify the exact scope. Inspect `status`, `lastErrorCode`, parser versions, coverage completeness, last HTTP state, and raw retention before taking action.
2. For `rate-limited`, wait until `rateLimitUntil`; a repair request must not shorten the manifest minimum pause. For an access challenge, do not retry through or bypass the challenge.
3. For parser drift or bad extraction, reproduce from an ignored retained snapshot or a sanitized synthetic fixture, add a failing focused test, update the parser version, and run `reprocess`. Do not refetch merely to test parser code.
4. For a broken URL, contradiction, official change, or explicitly approved retry, use `repair` with the precise reason. The next shared run owns the fetch; do not invoke one fetch per user.
5. Verify health after the run: expected/current parser versions match, coverage is complete, error state cleared, and candidate/offer/quarantine counts are plausible. Review quarantined reason codes rather than force-publishing uncertain data.
6. Record the cause, repair, commands, and actual sanitized results in the connector's GitHub Issue. A process exit code alone is not evidence of source coverage.

## Kaufland Praha-Vypich pipeline

`workers/ingestion` contains the shared handler for a claimed Kaufland job. One execution:

1. reads the latest `ETag` and `Last-Modified` metadata;
2. performs one identified ordinary-HTML request to the approved store path;
3. hashes changed HTML, writes it with owner-only file permissions and a 72-hour deletion key, and never logs the body;
4. skips parsing on HTTP 304 or an unchanged hash with the current parser version;
5. parses the exact store/validity section, normalizes mapped products deterministically, and quarantines unmapped or uncertain candidates with stable reason codes;
6. transactionally persists retrieval metadata, qualified shared offers, and quarantine records;
7. completes the connector lease with one explicit coverage item and schedules the healthy scope 12 hours later.

An access challenge is permanent for that run and is never retried automatically. HTTP 429 moves the job to `rate-limited` for at least six hours. The raw purge deletes expired files first and then marks their database metadata as deleted; hashes and retrieval metadata remain available for audit.

The connector proves physical flyer applicability only. It sets stock to `not-asserted` and cannot produce online availability.

### Local operator commands

- `pnpm ingest:kaufland` purges expired raw files, registers and claims only the approved source scope, loads approved mappings, and performs at most one due fetch.
- `pnpm mapping:kaufland list` lists pending mapping candidates with snapshot IDs but no raw response body.
- `pnpm mapping:kaufland classes` lists the stable initial Czech canonical catalogue.
- `pnpm mapping:kaufland approve --candidate <uuid> --canonical <uuid> --reviewer <operator-id> --attribute state=fresh` records one explicit approval. A reviewed mapping cannot be silently replaced.

The initial catalogue contains the 13 Czech reference product classes from `PLAN.md` and uses stable IDs. Approval remains fail-closed: the canonical class must exist, attributes must be bounded strings, and an unmapped or unreviewed candidate never produces an offer. Approved mappings are shared by the source connector and are not tenant-specific.

## State machine

- `idle`: due according to the source policy;
- `leased`: owned temporarily by one worker through `FOR UPDATE SKIP LOCKED`;
- `retry`: retryable failure, with capped deterministic exponential backoff;
- `rate-limited`: paused until the provider-supplied retry time;
- `quarantined`: complete but unsafe run, including parser drift or an erroneous/incomplete coverage result;
- `dead-letter`: permanent failure or exhausted attempts, requiring an explicit audited refresh request.

Expired leases can be reclaimed. A normal registration/update changes only connector configuration and cannot reset an active lease, retry, quarantine, or dead-letter state.

## Coverage and freshness

Every successful run must record one result for every configured coverage key. A single `success` boolean is not accepted. Each item records its status, candidate count, and optional bounded reason code. Missing coverage fails closed and quarantines the job.

Dynamic offer facts are always refreshed. Static context can be reused only before its TTL expiry. These signals bypass a fresh TTL and create an audited early-refresh event:

- broken URL;
- source contradiction;
- official change signal;
- qualifying candidate from an unknown retailer;
- explicit operator request.

The health view exposes the due time, lease/rate-limit state, attempts, parser versions, last content hash, last success, coverage completeness, last error, and quarantine count. The latest run retains its complete coverage manifest for diagnosis.

## Operator procedure

1. Inspect job health and its latest coverage manifest; never infer completeness from process exit status.
2. For `rate-limited`, wait until `rateLimitUntil`; do not bypass the source limit. For Kaufland this is at least six hours.
3. For `quarantined`, compare the expected and observed parser versions and review deterministic reason codes/sanitized snapshots before an explicit refresh.
4. For `dead-letter`, resolve the source or parser fault before creating an `explicit-request` refresh event.
5. Never put response bodies, credentials, cookies, retailer accounts, personal addresses, or recipient data into health records or logs.
