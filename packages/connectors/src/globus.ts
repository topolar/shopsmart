import { createHash } from "node:crypto";

import { type PublishedOffer } from "@shopsmart/contracts";
import {
  type ComparisonUnit,
  IncompatibleUnitError,
  normalizeUnitPrice,
  OfferPublicationError,
  type PackageUnit,
  publishOffer,
} from "@shopsmart/domain";
import { load, type CheerioAPI } from "cheerio";

type Selection = ReturnType<CheerioAPI>;

export const GLOBUS_FEATURED_PARSER_VERSION = "globus-featured-v1";

export const GLOBUS_BRNO_SCOPE = {
  key: "globus:cz:brno:featured-offers",
  retailerId: "610b5ac8-22fb-4fa0-b7d1-f41c05e2e79c",
  sourceScopeId: "871778a5-a395-4d92-a4db-b64ec02fd06a",
  storeId: "c3914142-4ea9-42f7-b2d2-f1e71f479e50",
  storeName: "Globus Brno",
  city: "Brno",
  sourceUrl: "https://www.globus.cz/brno/letaky",
  storeUrl: "https://www.globus.cz/brno",
} as const;

const rawRetentionMilliseconds = 72 * 60 * 60 * 1_000;
const maximumHtmlBytes = 5 * 1_024 * 1_024;
const identifiedUserAgent =
  "ShopSmart-development/0.0.0 (+https://github.com/topolar/shopsmart)";

export type GlobusProductMapping = Readonly<{
  externalId: string;
  canonicalProductClassId: string;
  comparisonUnit: ComparisonUnit;
  variantAttributes: Readonly<Record<string, string>>;
}>;

export type GlobusQuarantineReason =
  | "STORE_SCOPE_MISMATCH"
  | "MISSING_OFFER_TILES"
  | "MISSING_NAME"
  | "MISSING_PACKAGE"
  | "AMBIGUOUS_PACKAGE"
  | "UNSUPPORTED_PACKAGE_UNIT"
  | "UNMAPPED_PRODUCT"
  | "MISSING_PRICE"
  | "INVALID_PRICE"
  | "MISSING_UNIT_PRICE"
  | "UNIT_PRICE_MISMATCH"
  | "MISSING_VALIDITY"
  | "AMBIGUOUS_VALIDITY"
  | "AMBIGUOUS_MEMBERSHIP"
  | "INCOMPATIBLE_UNIT"
  | "INVALID_OFFER_CONTRACT";

export type GlobusQuarantine = Readonly<{
  externalId: string | null;
  exactName: string | null;
  declaredPackage: string | null;
  reasonCode: GlobusQuarantineReason;
}>;

export type GlobusRetailerProduct = Readonly<{
  id: string;
  retailerId: string;
  externalId: string;
  canonicalProductClassId: string;
  exactName: string;
  variantAttributes: Record<string, string>;
}>;

export type GlobusRetrieval = Readonly<{
  sourceScopeKey: string;
  sourceUrl: string;
  retrievedAt: string;
  httpStatus: number;
  contentHash: string;
  parserVersion: string;
  rawDeleteAt: string;
  etag: string | null;
  lastModified: string | null;
}>;

export type GlobusSnapshotResult = Readonly<{
  status: "parsed" | "unchanged" | "quarantined";
  retrieval: GlobusRetrieval;
  retailerProducts: readonly GlobusRetailerProduct[];
  offers: readonly PublishedOffer[];
  quarantines: readonly GlobusQuarantine[];
}>;

export type GlobusFetchResult = Readonly<{
  html: string | null;
  httpStatus: number;
  etag: string | null;
  lastModified: string | null;
  notModified: boolean;
}>;

export type GlobusAccessErrorCode =
  | "UNAPPROVED_REDIRECT"
  | "TOO_MANY_REDIRECTS"
  | "RATE_LIMITED"
  | "ACCESS_CHALLENGE"
  | "HTTP_ERROR"
  | "INVALID_CONTENT_TYPE"
  | "RESPONSE_TOO_LARGE";

export class GlobusAccessError extends Error {
  constructor(
    readonly code: GlobusAccessErrorCode,
    message: string,
    readonly httpStatus: number | null = null,
    readonly retryAt: string | null = null,
  ) {
    super(message);
    this.name = "GlobusAccessError";
  }
}

export function createGlobusNotModifiedResult(input: {
  retrievedAt: string;
  contentHash: string;
  parserVersion: string;
  etag: string | null;
  lastModified: string | null;
}): GlobusSnapshotResult {
  const retrievedAt = parseIsoTimestamp(input.retrievedAt);
  if (!/^[a-f0-9]{64}$/.test(input.contentHash)) {
    throw new Error("A 304 response requires a previous SHA-256 content hash.");
  }
  if (input.parserVersion !== GLOBUS_FEATURED_PARSER_VERSION) {
    throw new Error("A 304 response cannot satisfy a changed parser version.");
  }
  return emptyResult(
    "unchanged",
    {
      sourceScopeKey: GLOBUS_BRNO_SCOPE.key,
      sourceUrl: GLOBUS_BRNO_SCOPE.sourceUrl,
      retrievedAt: retrievedAt.toISOString(),
      httpStatus: 304,
      contentHash: input.contentHash,
      parserVersion: GLOBUS_FEATURED_PARSER_VERSION,
      rawDeleteAt: new Date(
        retrievedAt.getTime() + rawRetentionMilliseconds,
      ).toISOString(),
      etag: input.etag,
      lastModified: input.lastModified,
    },
    [],
  );
}

type ProcessSnapshotInput = Readonly<{
  html: string;
  httpStatus: number;
  retrievedAt: string;
  etag?: string | null;
  lastModified?: string | null;
  previousContentHash?: string | null;
  previousParserVersion?: string | null;
  productMappings: readonly GlobusProductMapping[];
}>;

export function createGlobusExternalId(input: {
  exactName: string;
  declaredPackage: string;
}): string {
  return createHash("sha256")
    .update(
      `globus-brno|${normalizeKey(input.exactName)}|${normalizeKey(input.declaredPackage)}`,
    )
    .digest("hex")
    .slice(0, 32);
}

export function processGlobusFeaturedSnapshot(
  input: ProcessSnapshotInput,
): GlobusSnapshotResult {
  const retrievedAt = parseIsoTimestamp(input.retrievedAt);
  const contentHash = createHash("sha256").update(input.html).digest("hex");
  const retrieval: GlobusRetrieval = {
    sourceScopeKey: GLOBUS_BRNO_SCOPE.key,
    sourceUrl: GLOBUS_BRNO_SCOPE.sourceUrl,
    retrievedAt: retrievedAt.toISOString(),
    httpStatus: input.httpStatus,
    contentHash,
    parserVersion: GLOBUS_FEATURED_PARSER_VERSION,
    rawDeleteAt: new Date(
      retrievedAt.getTime() + rawRetentionMilliseconds,
    ).toISOString(),
    etag: input.etag ?? null,
    lastModified: input.lastModified ?? null,
  };
  if (
    input.previousContentHash === contentHash &&
    input.previousParserVersion === GLOBUS_FEATURED_PARSER_VERSION
  ) {
    return emptyResult("unchanged", retrieval, []);
  }

  const $ = load(input.html);
  const headings = $("h1,h2,h3")
    .filter((_index, element) =>
      normalizeKey($(element).text())
        .replace(/\s/gu, "")
        .includes("akčnínabídkabrno"),
    )
    .toArray();
  if (headings.length !== 1) {
    return emptyResult("quarantined", retrieval, [
      pageQuarantine("STORE_SCOPE_MISMATCH"),
    ]);
  }

  const section = findSection($, $(headings[0]!));
  let cards = section.find("[data-featured-offer], article").toArray();
  if (cards.length === 0) {
    const grid = section
      .children("div")
      .filter((_index, element) =>
        ($(element).attr("class") ?? "").split(/\s+/u).includes("grid"),
      )
      .first();
    cards = grid
      .children("div")
      .filter(
        (_index, element) =>
          $(element).find("h3").length === 1 &&
          $(element).find("img[alt]").length === 1,
      )
      .toArray();
  }
  if (cards.length === 0) {
    return emptyResult("quarantined", retrieval, [
      pageQuarantine("MISSING_OFFER_TILES"),
    ]);
  }

  const mappings = new Map(
    input.productMappings.map((mapping) => [mapping.externalId, mapping]),
  );
  const offers: PublishedOffer[] = [];
  const retailerProducts = new Map<string, GlobusRetailerProduct>();
  const quarantines: GlobusQuarantine[] = [];

  for (const cardElement of cards) {
    const card = $(cardElement);
    const exactName = normalizeText(card.find("h3,h4").first().text());
    const declaredPackage = parseDeclaredPackage(card, exactName);
    if (!exactName) {
      quarantines.push(candidateQuarantine(null, null, null, "MISSING_NAME"));
      continue;
    }
    if (!declaredPackage) {
      quarantines.push(
        candidateQuarantine(null, exactName, null, "MISSING_PACKAGE"),
      );
      continue;
    }
    const externalId = createGlobusExternalId({ exactName, declaredPackage });
    const mapping = mappings.get(externalId);
    if (!mapping) {
      quarantines.push(
        candidateQuarantine(
          externalId,
          exactName,
          declaredPackage,
          "UNMAPPED_PRODUCT",
        ),
      );
      continue;
    }

    const packageResult = parsePackage(declaredPackage);
    if ("reasonCode" in packageResult) {
      quarantines.push(
        candidateQuarantine(
          externalId,
          exactName,
          declaredPackage,
          packageResult.reasonCode,
        ),
      );
      continue;
    }
    const explicitValidity = card.find("[data-validity]");
    const validityElements = explicitValidity.length
      ? explicitValidity
      : card
          .find("span")
          .filter((_index, element) =>
            normalizeText($(element).text()).startsWith("Platné do:"),
          );
    const validityTexts = validityElements
      .toArray()
      .map((element) => normalizeText($(element).text()))
      .filter(Boolean);
    if (validityTexts.length !== 1) {
      quarantines.push(
        candidateQuarantine(
          externalId,
          exactName,
          declaredPackage,
          validityTexts.length ? "AMBIGUOUS_VALIDITY" : "MISSING_VALIDITY",
        ),
      );
      continue;
    }
    const validity = parseValidity(validityTexts[0]!, retrievedAt);
    if (!validity) {
      quarantines.push(
        candidateQuarantine(
          externalId,
          exactName,
          declaredPackage,
          "AMBIGUOUS_VALIDITY",
        ),
      );
      continue;
    }

    const retailerProductId = stableUuid(
      `retailer-product:${GLOBUS_BRNO_SCOPE.retailerId}:${externalId}`,
    );
    retailerProducts.set(externalId, {
      id: retailerProductId,
      retailerId: GLOBUS_BRNO_SCOPE.retailerId,
      externalId,
      canonicalProductClassId: mapping.canonicalProductClassId,
      exactName,
      variantAttributes: { ...mapping.variantAttributes },
    });

    const publicOutcome = buildOffer({
      $,
      card,
      externalId,
      exactName,
      membership: { kind: "none" },
      priceKind: "public",
      mapping,
      retailerProductId,
      packageResult,
      validity,
      retrievedAt: retrieval.retrievedAt,
    });
    if ("reasonCode" in publicOutcome) {
      quarantines.push(
        candidateQuarantine(
          externalId,
          exactName,
          declaredPackage,
          publicOutcome.reasonCode,
        ),
      );
      continue;
    }
    offers.push(publicOutcome.offer);

    const loyaltyPrice = findLoyaltyPrice(card);
    if (loyaltyPrice.length > 0) {
      const explicitLabel = normalizeText(loyaltyPrice.text()).includes(
        "Můj Globus",
      );
      const officialLoyaltyStyling =
        loyaltyPrice.closest('[class*="brand-globus-green"]').length > 0 &&
        normalizeText($("body").text()).includes("Můj Globus");
      if (!explicitLabel && !officialLoyaltyStyling) {
        quarantines.push(
          candidateQuarantine(
            externalId,
            exactName,
            declaredPackage,
            "AMBIGUOUS_MEMBERSHIP",
          ),
        );
        continue;
      }
      const loyaltyOutcome = buildOffer({
        $,
        card,
        externalId,
        exactName,
        membership: { kind: "loyalty", program: "Můj Globus" },
        priceKind: "loyalty",
        mapping,
        retailerProductId,
        packageResult,
        validity,
        retrievedAt: retrieval.retrievedAt,
      });
      if ("reasonCode" in loyaltyOutcome) {
        quarantines.push(
          candidateQuarantine(
            externalId,
            exactName,
            declaredPackage,
            loyaltyOutcome.reasonCode,
          ),
        );
      } else {
        offers.push(loyaltyOutcome.offer);
      }
    }
  }

  return {
    status: "parsed",
    retrieval,
    retailerProducts: [...retailerProducts.values()],
    offers,
    quarantines,
  };
}

type ParsedPackage = Readonly<{
  declared: string;
  quantity: Readonly<{ amount: string; unit: PackageUnit }>;
  count: number;
}>;
type Failure = Readonly<{ reasonCode: GlobusQuarantineReason }>;

function buildOffer(input: {
  $: CheerioAPI;
  card: Selection;
  externalId: string;
  exactName: string;
  priceKind: "public" | "loyalty";
  membership:
    Readonly<{ kind: "none" }> | Readonly<{ kind: "loyalty"; program: string }>;
  mapping: GlobusProductMapping;
  retailerProductId: string;
  packageResult: ParsedPackage;
  validity: Readonly<{ validFrom: string; validTo: string }>;
  retrievedAt: string;
}): Readonly<{ offer: PublishedOffer }> | Failure {
  const priceText = priceTextFor(input.card, input.priceKind);
  const price = parseCzechPrice(priceText);
  if (!price) {
    return { reasonCode: priceText ? "INVALID_PRICE" : "MISSING_PRICE" };
  }
  let normalizedPrice;
  try {
    normalizedPrice = normalizeUnitPrice({
      packagePrice: price,
      packageQuantity: input.packageResult.quantity,
      comparisonUnit: input.mapping.comparisonUnit,
    });
  } catch (error) {
    if (error instanceof IncompatibleUnitError) {
      return { reasonCode: "INCOMPATIBLE_UNIT" };
    }
    return { reasonCode: "INVALID_OFFER_CONTRACT" };
  }
  const declaredUnitPriceText = unitPriceTextFor(input.card, input.priceKind);
  const declaredUnitPrice = parseUnitPrice(declaredUnitPriceText);
  if (!declaredUnitPrice) return { reasonCode: "MISSING_UNIT_PRICE" };
  if (
    declaredUnitPrice.amount !== normalizedPrice.amount ||
    declaredUnitPrice.unit !== normalizedPrice.unit
  ) {
    return { reasonCode: "UNIT_PRICE_MISMATCH" };
  }

  try {
    return {
      offer: publishOffer({
        id: stableUuid(
          `offer:${GLOBUS_BRNO_SCOPE.sourceScopeId}|${input.externalId}|${input.packageResult.declared}|${price}|${input.validity.validFrom}|${input.validity.validTo}|${input.membership.kind}`,
        ),
        retailerProductId: input.retailerProductId,
        sourceScopeId: GLOBUS_BRNO_SCOPE.sourceScopeId,
        canonicalProductClassId: input.mapping.canonicalProductClassId,
        exactName: input.exactName,
        variantAttributes: { ...input.mapping.variantAttributes },
        package: input.packageResult,
        price: { amount: price, currency: "CZK" },
        regularPrice: null,
        discountPercent: null,
        comparisonUnit: input.mapping.comparisonUnit,
        unitPrices: [
          {
            amount: normalizedPrice.amount,
            currency: "CZK",
            unit: normalizedPrice.unit,
          },
        ],
        membership: input.membership,
        channel: "physical",
        locality: {
          kind: "physical",
          storeId: GLOBUS_BRNO_SCOPE.storeId,
          applicability: "store",
        },
        availability: {
          kind: "physical",
          evidence: "flyer-applicability",
          stockStatus: "not-asserted",
        },
        validity: input.validity,
        evidence: {
          level: "official",
          sourceUrl: GLOBUS_BRNO_SCOPE.sourceUrl,
          verificationUrls: [GLOBUS_BRNO_SCOPE.storeUrl],
          retrievedAt: input.retrievedAt,
        },
        parserVersion: GLOBUS_FEATURED_PARSER_VERSION,
        status: "qualified",
      }),
    };
  } catch (error) {
    if (error instanceof OfferPublicationError) {
      return { reasonCode: "INVALID_OFFER_CONTRACT" };
    }
    throw error;
  }
}

export async function fetchGlobusFeaturedPage(input: {
  fetchImpl?: typeof fetch;
  retrievedAt: string;
  etag?: string | null;
  lastModified?: string | null;
}): Promise<GlobusFetchResult> {
  parseIsoTimestamp(input.retrievedAt);
  const fetchImpl = input.fetchImpl ?? fetch;
  let currentUrl: string = GLOBUS_BRNO_SCOPE.sourceUrl;
  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    const headers: Record<string, string> = {
      accept: "text/html",
      "accept-language": "cs-CZ,cs;q=0.9",
      "user-agent": identifiedUserAgent,
    };
    if (input.etag) headers["if-none-match"] = input.etag;
    if (input.lastModified) headers["if-modified-since"] = input.lastModified;
    const response = await fetchImpl(currentUrl, {
      method: "GET",
      redirect: "manual",
      headers,
    });
    if (response.status === 304) {
      return {
        html: null,
        httpStatus: 304,
        etag: response.headers.get("etag") ?? input.etag ?? null,
        lastModified:
          response.headers.get("last-modified") ?? input.lastModified ?? null,
        notModified: true,
      };
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      const nextUrl = location ? new URL(location, currentUrl) : null;
      if (!nextUrl || !isApprovedUrl(nextUrl)) {
        throw new GlobusAccessError(
          "UNAPPROVED_REDIRECT",
          "Globus redirected outside the approved Brno leaflet page.",
          response.status,
        );
      }
      currentUrl = nextUrl.toString();
      continue;
    }
    if (response.status === 429) {
      throw new GlobusAccessError(
        "RATE_LIMITED",
        "Globus rate-limited the shared connector.",
        response.status,
        parseRetryAfter(response.headers.get("retry-after"), input.retrievedAt),
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new GlobusAccessError(
        "ACCESS_CHALLENGE",
        "Globus requires access that this connector must not bypass.",
        response.status,
      );
    }
    if (!response.ok) {
      throw new GlobusAccessError(
        "HTTP_ERROR",
        `Globus returned HTTP ${response.status}.`,
        response.status,
      );
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("text/html")) {
      throw new GlobusAccessError(
        "INVALID_CONTENT_TYPE",
        "Globus did not return ordinary HTML.",
        response.status,
      );
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maximumHtmlBytes) {
      throw new GlobusAccessError(
        "RESPONSE_TOO_LARGE",
        "Globus HTML exceeded the connector response limit.",
        response.status,
      );
    }
    const html = await response.text();
    if (Buffer.byteLength(html, "utf8") > maximumHtmlBytes) {
      throw new GlobusAccessError(
        "RESPONSE_TOO_LARGE",
        "Globus HTML exceeded the connector response limit.",
        response.status,
      );
    }
    if (looksLikeAccessChallenge(html)) {
      throw new GlobusAccessError(
        "ACCESS_CHALLENGE",
        "Globus returned an access challenge that must not be bypassed.",
        response.status,
      );
    }
    return {
      html,
      httpStatus: response.status,
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
      notModified: false,
    };
  }
  throw new GlobusAccessError(
    "TOO_MANY_REDIRECTS",
    "Globus exceeded the approved redirect limit.",
  );
}

function findSection($: CheerioAPI, heading: Selection) {
  const explicit = heading.closest("[data-featured-offers]");
  return explicit.length ? explicit : heading.closest("section");
}

function parseDeclaredPackage(
  card: Selection,
  exactName: string,
): string | null {
  const explicit = normalizeText(card.find("[data-package]").first().text());
  if (explicit) return normalizePackage(explicit);
  const composite =
    /\b(\d+\s*[x×]\s*\d+(?:[,.]\d+)?\s*(?:kg|g|ml|l|ks))\b/iu.exec(exactName);
  if (composite) return normalizePackage(composite[1]!);
  const namePackage =
    /\b(\d+(?:[,.]\d+)?\s*(?:kg|g|ml|l|ks|kusů?|role|rolí|m))\b/iu.exec(
      exactName,
    );
  if (namePackage) return normalizePackage(namePackage[1]!);
  const publicUnit = unitPriceTextFor(card, "public");
  const saleUnit = /\/\s*1\s*(kg|g|ml|l|ks|kus|role|m)\b/iu.exec(publicUnit);
  return saleUnit ? normalizePackage(`1 ${saleUnit[1]}`) : null;
}

function normalizePackage(value: string): string {
  return normalizeText(value)
    .replace(/\s*[x×]\s*/giu, " × ")
    .replace(/(\d)(kg|g|ml|l|ks|m)\b/giu, "$1 $2")
    .replace(/(\d),(\d)/g, "$1,$2");
}

function parsePackage(declared: string): ParsedPackage | Failure {
  if (declared.includes("/")) return { reasonCode: "AMBIGUOUS_PACKAGE" };
  const composite = /^(\d+)\s*×\s*(\d+(?:[,.]\d+)?)\s*(kg|g|ml|l|ks)$/iu.exec(
    declared,
  );
  if (composite) {
    const count = Number(composite[1]);
    const itemAmount = Number(normalizeDecimal(composite[2]!));
    const unit = parsePackageUnit(composite[3]!);
    if (
      !Number.isSafeInteger(count) ||
      count <= 0 ||
      !Number.isFinite(itemAmount) ||
      itemAmount <= 0 ||
      !unit
    ) {
      return { reasonCode: "AMBIGUOUS_PACKAGE" };
    }
    return {
      declared,
      quantity: { amount: normalizeDecimal(String(count * itemAmount)), unit },
      count,
    };
  }
  const match =
    /^(\d+(?:[,.]\d+)?)\s*(kg|g|ml|l|ks|kus|kusů|role|rolí|m)$/iu.exec(
      declared,
    );
  if (!match) return { reasonCode: "UNSUPPORTED_PACKAGE_UNIT" };
  const amount = normalizeDecimal(match[1]!);
  const unit = parsePackageUnit(match[2]!);
  if (!unit) return { reasonCode: "UNSUPPORTED_PACKAGE_UNIT" };
  const numericAmount = Number(amount);
  const count = unit === "piece" || unit === "roll" ? numericAmount : 1;
  if (!Number.isInteger(count) || count <= 0) {
    return { reasonCode: "AMBIGUOUS_PACKAGE" };
  }
  return { declared, quantity: { amount, unit }, count };
}

function parsePackageUnit(value: string): PackageUnit | null {
  switch (value.toLocaleLowerCase("cs-CZ")) {
    case "kg":
      return "kilogram";
    case "g":
      return "gram";
    case "ml":
      return "millilitre";
    case "l":
      return "litre";
    case "ks":
    case "kus":
    case "kusů":
      return "piece";
    case "role":
    case "rolí":
      return "roll";
    case "m":
      return "metre";
    default:
      return null;
  }
}

function parseValidity(value: string, retrievedAt: Date) {
  const matches = [...value.matchAll(/(\d{1,2})\.\s*(\d{1,2})\./gu)];
  if (matches.length < 1 || matches.length > 2) return null;
  const endMatch = matches.at(-1)!;
  const startMatch = matches.length === 2 ? matches[0]! : null;
  const end = inferDate(Number(endMatch[1]), Number(endMatch[2]), retrievedAt);
  const start = startMatch
    ? inferDate(Number(startMatch[1]), Number(startMatch[2]), retrievedAt)
    : pragueDateParts(retrievedAt);
  if (!start || !end) return null;
  const validFrom = zonedLocalToUtc({ ...start, endOfDay: false });
  const validTo = zonedLocalToUtc({ ...end, endOfDay: true });
  return Date.parse(validTo) >= Date.parse(validFrom)
    ? { validFrom, validTo }
    : null;
}

function inferDate(day: number, month: number, retrievedAt: Date) {
  const current = pragueDateParts(retrievedAt);
  for (const year of [current.year, current.year + 1]) {
    const candidate = new Date(Date.UTC(year, month - 1, day));
    if (
      candidate.getUTCFullYear() === year &&
      candidate.getUTCMonth() === month - 1 &&
      candidate.getUTCDate() === day
    )
      return { year, month, day };
  }
  return null;
}

const pragueDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Prague",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const pragueDateTime = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Prague",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function pragueDateParts(date: Date) {
  const parts = Object.fromEntries(
    pragueDate
      .formatToParts(date)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, Number(value)]),
  ) as Record<string, number>;
  return { year: parts.year!, month: parts.month!, day: parts.day! };
}

function zonedLocalToUtc(input: {
  year: number;
  month: number;
  day: number;
  endOfDay: boolean;
}) {
  const target = Date.UTC(
    input.year,
    input.month - 1,
    input.day,
    input.endOfDay ? 23 : 0,
    input.endOfDay ? 59 : 0,
    input.endOfDay ? 59 : 0,
    input.endOfDay ? 999 : 0,
  );
  let instant = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    instant = target - timeZoneOffsetMilliseconds(instant);
  }
  return new Date(instant).toISOString();
}

function timeZoneOffsetMilliseconds(instant: number): number {
  const parts = Object.fromEntries(
    pragueDateTime
      .formatToParts(new Date(instant))
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, Number(value)]),
  ) as Record<string, number>;
  return (
    Date.UTC(
      parts.year!,
      parts.month! - 1,
      parts.day!,
      parts.hour!,
      parts.minute!,
      parts.second!,
    ) -
    Math.floor(instant / 1_000) * 1_000
  );
}

function parseCzechPrice(value: string): string | null {
  const normalized = normalizeText(value)
    .replace(/Kč/giu, "")
    .replace(/\s/g, "");
  const match = /^(\d{1,9})(?:[,.](\d{1,2}))?/.exec(normalized);
  if (!match) return null;
  const price = `${match[1]}.${(match[2] ?? "0").padEnd(2, "0")}`;
  return Number(price) > 0 ? price : null;
}

function parseUnitPrice(
  value: string,
): { amount: string; unit: ComparisonUnit } | null {
  const match =
    /^(.*?)\s*\/\s*(?:1\s*)?(kg|100\s*g|250\s*g|ks|kus|roli?|m|l)(?:\s*\|)?$/iu.exec(
      normalizeText(value).replace(/Kč/giu, ""),
    );
  if (!match) return null;
  const amount = parseCzechPrice(match[1]!);
  if (!amount) return null;
  const rawUnit = match[2]!.toLocaleLowerCase("cs-CZ").replace(/\s/g, "");
  const unit: ComparisonUnit | null =
    rawUnit === "kg"
      ? "kilogram"
      : rawUnit === "100g"
        ? "100-gram"
        : rawUnit === "250g"
          ? "250-gram"
          : rawUnit === "ks" || rawUnit === "kus"
            ? "piece"
            : rawUnit === "role" || rawUnit === "roli"
              ? "roll"
              : rawUnit === "m"
                ? "metre"
                : rawUnit === "l"
                  ? "litre"
                  : null;
  return unit ? { amount, unit } : null;
}

function normalizeDecimal(value: string) {
  return value.replace(",", ".").replace(/\.0+$/, "");
}
function normalizeText(value: string) {
  return value.replace(/\s+/gu, " ").trim();
}
function normalizeKey(value: string) {
  return normalizeText(value).normalize("NFKC").toLocaleLowerCase("cs-CZ");
}
function findLoyaltyPrice(card: Selection): Selection {
  const explicit = card.find('[data-price-kind="loyalty"]');
  if (explicit.length) return explicit;
  return card.find('[class*="brand-globus-green"] [aria-label*="Kč"]').first();
}
function priceTextFor(
  card: Selection,
  priceKind: "public" | "loyalty",
): string {
  const explicit = card
    .find(`[data-price-kind="${priceKind}"]:not([data-unit-price])`)
    .first();
  if (explicit.length) {
    return normalizeText(explicit.clone().children().remove().end().text());
  }
  const actual =
    priceKind === "public"
      ? card.find('.text-price-sale[aria-label*="Kč"]').first()
      : findLoyaltyPrice(card);
  return normalizeText(actual.attr("aria-label") ?? "");
}
function unitPriceTextFor(
  card: Selection,
  priceKind: "public" | "loyalty",
): string {
  const explicit = card
    .find(`[data-unit-price][data-price-kind="${priceKind}"]`)
    .first();
  if (explicit.length) return normalizeText(explicit.text());
  const unitPrices = card
    .find("h3")
    .first()
    .next("div")
    .children("span")
    .filter(':contains("Kč/")');
  const selected =
    priceKind === "public" ? unitPrices.first() : unitPrices.eq(1);
  return normalizeText(selected.text());
}
function stableUuid(value: string) {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function parseIsoTimestamp(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error("retrievedAt must be a canonical ISO timestamp.");
  }
  return parsed;
}
function isApprovedUrl(url: URL) {
  return (
    url.protocol === "https:" &&
    url.hostname === "www.globus.cz" &&
    url.pathname.replace(/\/$/, "") === "/brno/letaky"
  );
}
function looksLikeAccessChallenge(html: string) {
  return (
    /<form[^>]+id=["']challenge-form["']/iu.test(html) ||
    /<title>[^<]*(?:captcha|access denied|attention required|přístup odepřen)/iu.test(
      html,
    )
  );
}
function parseRetryAfter(value: string | null, retrievedAt: string) {
  if (!value) return null;
  const seconds = /^\d+$/.test(value.trim()) ? Number(value.trim()) : null;
  if (seconds !== null && Number.isSafeInteger(seconds)) {
    return new Date(Date.parse(retrievedAt) + seconds * 1_000).toISOString();
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}
function candidateQuarantine(
  externalId: string | null,
  exactName: string | null,
  declaredPackage: string | null,
  reasonCode: GlobusQuarantineReason,
): GlobusQuarantine {
  return { externalId, exactName, declaredPackage, reasonCode };
}
function pageQuarantine(reasonCode: GlobusQuarantineReason): GlobusQuarantine {
  return candidateQuarantine(null, null, null, reasonCode);
}
function emptyResult(
  status: "unchanged" | "quarantined",
  retrieval: GlobusRetrieval,
  quarantines: readonly GlobusQuarantine[],
): GlobusSnapshotResult {
  return { status, retrieval, retailerProducts: [], offers: [], quarantines };
}
