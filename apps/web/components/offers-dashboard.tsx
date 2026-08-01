"use client";

import {
  offersDashboardResponseSchema,
  type OffersDashboardResponse,
} from "@shopsmart/contracts";
import { useEffect, useState } from "react";

import { cs } from "../messages/cs";

export function OffersDashboard({ tenantId }: { tenantId: string }) {
  const [dashboard, setDashboard] = useState<OffersDashboardResponse>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/v1/tenants/${tenantId}/offers`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("DASHBOARD_REQUEST_FAILED");
        return offersDashboardResponseSchema.parse(await response.json());
      })
      .then(setDashboard)
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setFailed(true);
        }
      });
    return () => controller.abort();
  }, [tenantId]);

  if (failed) return <p role="alert">{cs.offersError}</p>;
  if (!dashboard) return <p role="status">{cs.offersLoading}</p>;
  return <OffersDashboardView dashboard={dashboard} />;
}

export function OffersDashboardView({
  dashboard,
}: {
  dashboard: OffersDashboardResponse;
}) {
  if (dashboard.groups.length === 0) {
    return (
      <section aria-labelledby="offers-heading" className="grid gap-3">
        <h2 className="text-2xl font-bold" id="offers-heading">
          {cs.offersTitle}
        </h2>
        <p>{cs.noOffers}</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="offers-heading" className="grid gap-5">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wider text-emerald-800">
          {cs.confirmedOffers}
        </p>
        <h2 className="text-2xl font-bold" id="offers-heading">
          {cs.offersTitle}
        </h2>
      </header>
      {dashboard.groups.map((group) => (
        <article
          className="grid gap-3 rounded-2xl border border-emerald-900/10 bg-white p-5 shadow-sm"
          key={`${group.canonicalProductClassId}:${group.currency}:${group.comparisonUnit}`}
        >
          <h3 className="text-xl font-bold">
            {group.canonicalProductClassName}
          </h3>
          <p className="text-sm text-emerald-950/65">{cs.sortedByUnitPrice}</p>
          <ol className="grid gap-4">
            {group.offers.map((offer) => (
              <li
                className="grid gap-2 border-t border-emerald-900/10 pt-4"
                key={offer.matchId}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <div>
                    <p className="font-bold">{offer.exactName}</p>
                    <p className="text-sm">{offer.retailer.name}</p>
                  </div>
                  <p className="text-lg font-bold">
                    {formatMoney(
                      offer.normalizedUnitPrice.amount,
                      group.currency,
                    )}{" "}
                    / {unitLabel(group.comparisonUnit)}
                  </p>
                </div>
                <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
                  <Fact
                    label={cs.package}
                    value={`${offer.package.declared} · ${formatMoney(offer.price.amount, offer.price.currency)}`}
                  />
                  <Fact
                    label={cs.membership}
                    value={membershipLabel(offer.membership)}
                  />
                  <Fact
                    label={cs.channelAndLocality}
                    value={localityLabel(offer)}
                  />
                  <Fact
                    label={cs.validity}
                    value={validityLabel(offer.validity)}
                  />
                  <Fact
                    label={cs.thresholdReason}
                    value={thresholdLabel(offer.thresholdReason)}
                  />
                  <Fact
                    label={cs.evidence}
                    value={
                      offer.evidenceLevel === "official"
                        ? cs.officialEvidence
                        : cs.crossCheckedEvidence
                    }
                  />
                  <Fact
                    label={cs.lastVerified}
                    value={formatDateTime(offer.retrievedAt)}
                  />
                </dl>
                <a
                  className="w-fit font-semibold text-emerald-800 underline"
                  href={offer.sourceUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  {cs.openSource}
                </a>
              </li>
            ))}
          </ol>
        </article>
      ))}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="font-semibold">{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function formatMoney(amount: string, currency: string) {
  return new Intl.NumberFormat("cs-CZ", { style: "currency", currency }).format(
    Number(amount),
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("cs-CZ", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Prague",
  }).format(new Date(value));
}

function unitLabel(unit: string) {
  return cs.units[unit as keyof typeof cs.units] ?? unit;
}

function membershipLabel(
  membership: OffersDashboardResponse["groups"][number]["offers"][number]["membership"],
) {
  if (membership.kind === "none") return cs.noMembership;
  return membership.kind === "coupon"
    ? membership.description
    : membership.program;
}

function localityLabel(
  offer: OffersDashboardResponse["groups"][number]["offers"][number],
) {
  return offer.locality.kind === "physical"
    ? `${cs.physicalStore}: ${offer.localityName} · ${applicabilityLabel(offer.locality.applicability)}`
    : `${offer.locality.fulfilment === "delivery" ? cs.delivery : cs.pickup}: ${offer.localityName} · ${offer.availability.kind === "online" ? offer.availability.fulfilmentDetails : ""}`;
}

function applicabilityLabel(applicability: "store" | "region" | "national") {
  return cs.applicability[applicability];
}

function validityLabel(
  validity: OffersDashboardResponse["groups"][number]["offers"][number]["validity"],
) {
  const from = new Intl.DateTimeFormat("cs-CZ").format(
    new Date(validity.validFrom),
  );
  const to = validity.validTo
    ? new Intl.DateTimeFormat("cs-CZ").format(new Date(validity.validTo))
    : cs.untilChanged;
  return `${from}–${to}`;
}

function thresholdLabel(
  reason: OffersDashboardResponse["groups"][number]["offers"][number]["thresholdReason"],
) {
  return reason.predicate === "max-unit-price"
    ? `${cs.unitPriceThreshold}: ${reason.actual} ≤ ${reason.limit}`
    : `${cs.discountThreshold}: ${reason.actual} % ≥ ${reason.limit} %`;
}
