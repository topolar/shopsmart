# ADR 0004: Kaufland Praha-Vypich as the first retailer source scope

- Status: accepted for implementation; re-audit required before production beta
- Date: 2026-08-01
- Scope: first Czech physical-store ingestion connector

## Decision

ShopSmart will use the public official page for `Kaufland Praha-Vypich` as its first real retailer source scope:

- store-scoped source: <https://prodejny.kaufland.cz/aktualne/servis/prodejna/praha-vypich-3300.html>
- leaflet index: <https://prodejny.kaufland.cz/letak.html>
- published crawler policy: <https://prodejny.kaufland.cz/robots.txt>

The store page is the ingestion source. It exposes the selected store, the offer validity window, product name, declared package, current price, normalized unit price, regular price or discount when present, and Kaufland Card conditions in public HTML. The leaflet index is supporting evidence and a change-discovery URL; ShopSmart will not ingest the separate interactive leaflet or copy leaflet images.

The connector may request only the two approved paths above and redirects that remain on an approved Kaufland host. It must not request the paths currently disallowed by `robots.txt`, including `/nabidka/aktualni-tyden/prehled/detail` and `/nabidka/pristi-tyden/detail`. It must not authenticate, retain cookies, mask browser automation, solve a CAPTCHA, call an undocumented private endpoint, or work around a technical control.

This decision is based on the source's public access signals as of the decision date: the required pages are public without an account, the published crawler policy allows them, and the reviewed public site did not expose a term prohibiting automated access to these paths. It is not a perpetual licence determination. A robots or terms change, access challenge, complaint, or unexpected redirect immediately suspends the connector and creates an operator-visible compliance quarantine.

## Shared fetch and rate policy

- One fetch serves the complete source scope; never fetch per user.
- Default schedule: once every 12 hours while the source is healthy.
- Hard minimum interval: six hours per scope unless an operator records an explicit early-refresh reason.
- Host concurrency: one request at a time.
- Send an identified ShopSmart user agent and accept ordinary HTML only.
- Honor `Retry-After`, `ETag`, and `Last-Modified` when supplied.
- Use bounded exponential backoff for transient failures. Do not retry an access challenge automatically.
- Hash the response and skip parsing when the content is unchanged.

## Evidence, fixtures, and retention

Durable offer records retain normalized factual fields, the concrete source URL, retrieval timestamp, content hash, parser version, and locality evidence. They do not retain or republish page layout, photographs, leaflet pages, marketing copy, or logos.

Raw HTML is operational evidence, not a repository fixture:

- store it only in the ignored local snapshot directory or access-restricted encrypted object storage;
- delete it after 72 hours;
- never commit it, attach it to a public issue, or include it in logs;
- retain HTTP metadata and the content hash after raw deletion;
- use hand-written synthetic HTML fixtures for deterministic parser tests.

The retention clock may be shortened immediately after a source-policy change or deletion request. Extending it requires a new decision.

## Locality and fail-closed rules

The connector qualifies only physical flyer applicability for the exact public store scope `Kaufland Praha-Vypich`. It does not claim current shelf stock, reservation, delivery, or online obtainability.

A candidate is quarantined instead of published when any of the following is missing or ambiguous:

- exact store identity and source URL;
- one unambiguous offer validity interval;
- exact product name;
- declared package or comparison unit needed for deterministic normalization;
- current CZK price;
- membership condition when the displayed price requires Kaufland Card;
- parser evidence tying the candidate to the same store and validity section.

Ranges, mixed packs, incompatible units, contradictory prices, and markup drift receive stable reason codes. They are never guessed or repaired by AI in this connector.

## Alternatives rejected for the first connector

- Hermes's personal pilot workflow: it used ad-hoc web search, aggregators, downloaded flyers, and headless-browser scripts. It was not a reusable feed and included automation masking and locality data that are unsuitable for a public service.
- Kupi.cz and AkcniCeny.cz: useful discovery sources, not approved ingestion sources.
- BILLA pages and PDFs: BILLA's published terms require written consent for database storage or processing of site content.
- Rohlík MCP: its published terms restrict the service to normal customer use and require prior written consent for other uses.
- Globus product pages: the product-detail paths are disallowed by its published crawler policy.
- Open Prices: reusable under ODbL, but observations do not provide a retailer-authoritative active validity interval or current stock and therefore fail closed for the first qualified-offer path.

## Consequences

Issue #8 can implement a real shared connector without waiting for a private feed. The first slice remains deliberately narrow: one Czech physical store, one official HTML shape, no account, no online stock, and no generative AI. Additional retailers require their own source review and connector contract.
