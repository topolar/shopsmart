# Connector operations

ShopSmart schedules one job per shared `sourceScopeKey`; tenant count is never part of connector scheduling. Kaufland Praha-Vypich is the first implemented source scope. Repository fixtures remain synthetic; live response bodies belong only in the ignored raw-snapshot directory.

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
