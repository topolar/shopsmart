# ADR 0006: Globus Brno featured offers

- Status: accepted for local implementation; source re-audit required before public production
- Date: 2026-08-01
- Scope: Czech physical-store featured-offer ingestion

## Decision

ShopSmart may fetch the official public Globus Brno leaflet page at
<https://www.globus.cz/brno/letaky>. The connector is deliberately limited to
the small featured-offer section headed `Akční nabídka Brno`. It must not turn
product links discovered in that section into follow-up requests.

The reviewed Globus `robots.txt` allows the leaflet page and explicitly
disallows, among other paths, Brno product detail and full-offer routes under
`/brno/hypermarket/*/p/`, `/brno/hypermarket/cela-nabidka/*` and
`/brno/hypermarket/akcni-nabidka/*`. Those routes are a hard denylist even when
the allowed page links to them. The store page <https://www.globus.cz/brno> may
be retained as locality evidence but is not part of the scheduled fetch.

This is a narrow operational source review, not a perpetual licence
determination. A robots or terms change, complaint, access challenge,
authentication requirement, unexpected redirect or material page redesign
suspends the connector. It must never authenticate, retain a retailer session,
solve a CAPTCHA or bypass a technical control.

## Shared fetch and retention

- Fetch the one approved page once for all users and mappings, never per user.
- Default schedule and hard minimum interval: 12 hours for the source scope.
- Host concurrency: one request at a time.
- Send an identified ShopSmart user agent and conditional request headers.
- Follow redirects only when they remain HTTPS on `www.globus.cz` and resolve
  to exactly `/brno/letaky` (an optional trailing slash is equivalent).
- Reject challenges, unexpected content types and responses over 5 MiB.
- Hash content and skip unchanged content for the same parser version.
- Keep raw HTML only in the ignored local snapshot directory for 72 hours.
  Retain hashes, HTTP metadata, normalized facts and review state durably.

## Deterministic extraction contract

Only cards inside the single featured-offer section are candidates. A card
must expose an exact name, one unambiguous package or sale unit, a current CZK
price, a comparison unit price, an explicit validity end and Brno context.
Historical crossed-out prices are never current prices.

A lower price is published as a separate offer only when the same card labels
it unambiguously as requiring `Můj Globus`. Missing or ambiguous membership
evidence quarantines the lower candidate; it must never silently replace the
public price. Flyer applicability is physical-store evidence, not stock or
online availability.

No candidate is published until an immutable operator-approved mapping joins
the stable external key to a canonical product class. The key is a hash of the
normalized exact name and declared package; it excludes price, validity and
URL. Approval reparses the retained, hash-verified HTML without a network
request. Parser drift and uncertain packages, units, dates or prices fail
closed into review.

## Consequences

The initial Globus coverage is intentionally small and Brno-only. It provides
an official shared source without requesting a private feed or entering paths
the publisher excludes from automated access. Broad catalogue coverage, other
branches, online stock and delivery remain outside this decision.
