# ADR 0005: Albert Czech supermarket and hypermarket leaflet scopes

- Status: accepted for local implementation; source re-audit required before public production
- Date: 2026-08-01
- Scope: Czech physical-store leaflet ingestion

## Decision

ShopSmart may use the official public Albert leaflet index at
<https://www.albert.cz/aktualni-letaky> to discover the current default Czech
supermarket and hypermarket leaflets. The index publishes explicit validity
dates, an official viewer URL and a direct PDF download URL for each class in
its serialized page data.

The connector may request only:

- `https://www.albert.cz/aktualni-letaky`;
- an HTTPS `view.publitas.com/<publisher>/<publication>/pdfs/<uuid>.pdf` URL
  discovered in that same response;
- the corresponding `https://letaky.albert.cz/<leaflet>/` URL as clickable
  evidence, without crawling its interactive contents.

The reviewed Albert `robots.txt` does not disallow `/aktualni-letaky`. The
reviewed terms for the discontinued Albert Online shop define that service as
the `/online` surface and mobile application; those surfaces are outside this
decision. This is a narrow operational source review, not a perpetual licence
determination. A terms or robots change, complaint, access challenge, new
authentication requirement, unexpected redirect or changed host suspends the
connector immediately.

The connector must not authenticate, retain a retailer session, mask browser
automation, call a private endpoint, solve a CAPTCHA or bypass a technical
control. Kupi, AkcniCeny and other aggregators remain discovery-only sources.

## Shared fetch and retention policy

- One index request serves all due Albert scopes.
- Each current PDF is fetched once per leaflet class, never once per user.
- Default schedule and hard minimum interval: 12 hours per class.
- Host concurrency: one request at a time.
- Send an identified ShopSmart user agent and accept only ordinary HTML or PDF.
- Honor `ETag` and `Last-Modified` when the source supplies them.
- Reject unexpected redirects, content types and oversized responses.
- Hash content and skip parsing when both the hash and parser version match.
- Keep raw PDF evidence only under the ignored local snapshot directory for 72
  hours, then delete it. Never commit or attach a retailer PDF or image.

## Deterministic extraction contract

PDF extraction uses `unpdf` in the TypeScript worker. Positioned text items are
used because plain PDF reading order does not preserve the visual relationship
between a product and its price.

Candidate detection may retain only facts that are geometrically unambiguous:

- exact product name;
- one declared package;
- one large current CZK price associated with that product tile;
- an Albert application requirement when the nearby `BEZ APLIKACE` marker
  proves that the prominent price requires the application;
- leaflet class and exact validity from the official index.

Ranges, missing prices, unsupported packages and uncertain geometry are
quarantined. The small downward-triangle price printed in product descriptions
is the historical 30-day comparison price, not the current offer, and must
never be parsed as the current price.

No product is published until an immutable operator-approved mapping connects
the derived retailer product key to a canonical product class. The external key
is a stable hash of leaflet class, normalized exact name and declared package;
price, validity and URL are intentionally excluded.

Mapping approval immediately reparses the retained current PDF without a new
PDF download. The worker first verifies the storage key and SHA-256 content,
then confirms that the official index still points to the same PDF. A retryable
operator command can repeat this reparse after a transient index or database
failure.

## Evidence and locality boundary

Durable offers retain the direct official PDF URL, official viewer URL,
retrieval timestamp, validity, content hash and parser version. ShopSmart does
not republish PDF pages, product imagery, layout or marketing copy.

The two source scopes represent Albert supermarket and hypermarket leaflet
classes in the Czech Republic. They prove physical flyer applicability only;
they do not prove shelf stock, reservation, pickup or delivery. Exact store-list
matching remains a follow-up before broad public delivery to arbitrary Albert
branches. Until then, matching must not silently treat one leaflet class as the
other.

## Consequences

The project gains a second official Czech retailer source without requesting a
private feed and without copying Hermes's automation masking or personal
locality. PDF parsing is more fragile than ordinary HTML, so parser drift and
mapping review remain expected operational work.
