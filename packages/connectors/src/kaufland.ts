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
import { load } from "cheerio";

export const KAUFLAND_STORE_PARSER_VERSION = "kaufland-store-v1";

export const KAUFLAND_PRAHA_VYPICH_SCOPE = {
  key: "kaufland:cz:praha-vypich:3300:physical-offers",
  retailerId: "c897713a-b865-482b-851e-bd7352034be7",
  sourceScopeId: "913cb997-3e77-45e3-9ef0-b02f671fcf90",
  storeId: "b34e90d0-9c04-41ed-a39e-3b0c98155023",
  storeName: "Kaufland Praha-Vypich",
  city: "Praha",
  sourceUrl:
    "https://prodejny.kaufland.cz/aktualne/servis/prodejna/praha-vypich-3300.html",
  leafletUrl: "https://prodejny.kaufland.cz/letak.html",
} as const;

const rawRetentionMilliseconds = 72 * 60 * 60 * 1_000;
const maximumHtmlBytes = 5 * 1_024 * 1_024;
const identifiedUserAgent =
  "ShopSmart-development/0.0.0 (+https://github.com/topolar/shopsmart)";

export type KauflandProductMapping = Readonly<{
  externalId: string;
  canonicalProductClassId: string;
  comparisonUnit: ComparisonUnit;
  variantAttributes: Readonly<Record<string, string>>;
}>;

export type KauflandQuarantineReason =
  | "STORE_SCOPE_MISMATCH"
  | "MISSING_VALIDITY"
  | "AMBIGUOUS_VALIDITY"
  | "MISSING_OFFER_TILES"
  | "MISSING_EXTERNAL_ID"
  | "MISSING_NAME"
  | "UNMAPPED_PRODUCT"
  | "MISSING_PACKAGE"
  | "AMBIGUOUS_PACKAGE"
  | "UNSUPPORTED_PACKAGE_UNIT"
  | "MISSING_PRICE"
  | "INVALID_PRICE"
  | "AMBIGUOUS_MEMBERSHIP"
  | "INCOMPATIBLE_UNIT"
  | "INVALID_OFFER_CONTRACT";

export type KauflandQuarantine = Readonly<{
  externalId: string | null;
  exactName: string | null;
  reasonCode: KauflandQuarantineReason;
}>;

export type KauflandRetailerProduct = Readonly<{
  id: string;
  retailerId: string;
  externalId: string;
  canonicalProductClassId: string;
  exactName: string;
  variantAttributes: Record<string, string>;
}>;

export type KauflandRetrieval = Readonly<{
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

export type KauflandSnapshotResult = Readonly<{
  status: "parsed" | "unchanged" | "quarantined";
  retrieval: KauflandRetrieval;
  retailerProducts: readonly KauflandRetailerProduct[];
  offers: readonly PublishedOffer[];
  quarantines: readonly KauflandQuarantine[];
}>;

export type KauflandFetchResult = Readonly<{
  html: string | null;
  httpStatus: number;
  etag: string | null;
  lastModified: string | null;
  notModified: boolean;
}>;

export type KauflandAccessErrorCode =
  | "UNAPPROVED_REDIRECT"
  | "TOO_MANY_REDIRECTS"
  | "RATE_LIMITED"
  | "ACCESS_CHALLENGE"
  | "HTTP_ERROR"
  | "INVALID_CONTENT_TYPE"
  | "RESPONSE_TOO_LARGE";

export class KauflandAccessError extends Error {
  constructor(
    readonly code: KauflandAccessErrorCode,
    message: string,
    readonly httpStatus: number | null = null,
    readonly retryAt: string | null = null,
  ) {
    super(message);
    this.name = "KauflandAccessError";
  }
}

export function createKauflandNotModifiedResult(input: {
  retrievedAt: string;
  contentHash: string;
  parserVersion: string;
  etag: string | null;
  lastModified: string | null;
}): KauflandSnapshotResult {
  const retrievedAt = parseIsoTimestamp(input.retrievedAt);
  if (!/^[a-f0-9]{64}$/.test(input.contentHash)) {
    throw new Error("A 304 response requires a previous SHA-256 content hash.");
  }
  if (input.parserVersion !== KAUFLAND_STORE_PARSER_VERSION) {
    throw new Error("A 304 response cannot satisfy a changed parser version.");
  }
  return emptyResult(
    "unchanged",
    {
      sourceScopeKey: KAUFLAND_PRAHA_VYPICH_SCOPE.key,
      sourceUrl: KAUFLAND_PRAHA_VYPICH_SCOPE.sourceUrl,
      retrievedAt: retrievedAt.toISOString(),
      httpStatus: 304,
      contentHash: input.contentHash,
      parserVersion: KAUFLAND_STORE_PARSER_VERSION,
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
  productMappings: readonly KauflandProductMapping[];
}>;

export function processKauflandStoreSnapshot(
  input: ProcessSnapshotInput,
): KauflandSnapshotResult {
  const retrievedAt = parseIsoTimestamp(input.retrievedAt);
  const contentHash = createHash("sha256").update(input.html).digest("hex");
  const retrieval: KauflandRetrieval = {
    sourceScopeKey: KAUFLAND_PRAHA_VYPICH_SCOPE.key,
    sourceUrl: KAUFLAND_PRAHA_VYPICH_SCOPE.sourceUrl,
    retrievedAt: retrievedAt.toISOString(),
    httpStatus: input.httpStatus,
    contentHash,
    parserVersion: KAUFLAND_STORE_PARSER_VERSION,
    rawDeleteAt: new Date(
      retrievedAt.getTime() + rawRetentionMilliseconds,
    ).toISOString(),
    etag: input.etag ?? null,
    lastModified: input.lastModified ?? null,
  };

  if (
    input.previousContentHash === contentHash &&
    input.previousParserVersion === KAUFLAND_STORE_PARSER_VERSION
  ) {
    return emptyResult("unchanged", retrieval, []);
  }

  const $ = load(input.html);
  const pageStoreName = normalizeText($("main h1").first().text());
  if (pageStoreName !== KAUFLAND_PRAHA_VYPICH_SCOPE.storeName) {
    return emptyResult("quarantined", retrieval, [
      pageQuarantine("STORE_SCOPE_MISMATCH"),
    ]);
  }

  const offerSections = $(".t-tiles-slider")
    .filter((_index, element) =>
      normalizeText($(element).find("h2").first().text()).includes(
        "Akční nabídka z aktuálního letáku pro tuto prodejnu",
      ),
    )
    .toArray();
  if (offerSections.length === 0) {
    return emptyResult("quarantined", retrieval, [
      pageQuarantine("MISSING_VALIDITY"),
    ]);
  }
  if (offerSections.length > 1) {
    return emptyResult("quarantined", retrieval, [
      pageQuarantine("AMBIGUOUS_VALIDITY"),
    ]);
  }

  const offerSection = $(offerSections[0]!);
  const validityText = normalizeText(offerSection.find("h3").first().text());
  const validity = parseValidity(validityText);
  if (!validity) {
    return emptyResult("quarantined", retrieval, [
      pageQuarantine("MISSING_VALIDITY"),
    ]);
  }

  const tiles = offerSection.find("a.k-product-tile").toArray();
  if (tiles.length === 0) {
    return emptyResult("quarantined", retrieval, [
      pageQuarantine("MISSING_OFFER_TILES"),
    ]);
  }

  const mappings = new Map(
    input.productMappings.map((mapping) => [mapping.externalId, mapping]),
  );
  const offers: PublishedOffer[] = [];
  const retailerProducts = new Map<string, KauflandRetailerProduct>();
  const quarantines: KauflandQuarantine[] = [];

  for (const tileElement of tiles) {
    const tile = $(tileElement);
    const href = tile.attr("href") ?? "";
    const externalId = parseExternalId(href);
    const exactName = normalizeText(
      [
        tile.find(".k-product-tile__title").first().text(),
        tile.find(".k-product-tile__subtitle").first().text(),
      ].join(" "),
    );

    if (!externalId) {
      quarantines.push({
        externalId: null,
        exactName: exactName || null,
        reasonCode: "MISSING_EXTERNAL_ID",
      });
      continue;
    }
    if (!exactName) {
      quarantines.push({
        externalId,
        exactName: null,
        reasonCode: "MISSING_NAME",
      });
      continue;
    }

    const mapping = mappings.get(externalId);
    if (!mapping) {
      quarantines.push({
        externalId,
        exactName,
        reasonCode: "UNMAPPED_PRODUCT",
      });
      continue;
    }

    const packageResult = parsePackage(
      normalizeText(tile.find(".k-product-tile__unit-price").first().text()),
    );
    if ("reasonCode" in packageResult) {
      quarantines.push({ externalId, exactName, ...packageResult });
      continue;
    }

    const retailerProductId = stableUuid(
      `retailer-product:${KAUFLAND_PRAHA_VYPICH_SCOPE.retailerId}:${externalId}`,
    );
    retailerProducts.set(externalId, {
      id: retailerProductId,
      retailerId: KAUFLAND_PRAHA_VYPICH_SCOPE.retailerId,
      externalId,
      canonicalProductClassId: mapping.canonicalProductClassId,
      exactName,
      variantAttributes: { ...mapping.variantAttributes },
    });

    const regularPrice = optionalCzechPrice(
      tile
        .find(".k-product-tile__pricetags-normal")
        .find(".k-price-tag__old-price-line-through")
        .first()
        .text(),
    );
    const normalOutcome = buildOffer({
      externalId,
      exactName,
      priceText: tile
        .find(".k-product-tile__pricetags-normal")
        .find(".k-price-tag__price")
        .first()
        .text(),
      discountText: tile
        .find(".k-product-tile__pricetags-normal")
        .find(".k-price-tag__discount")
        .first()
        .text(),
      regularPrice,
      membership: { kind: "none" },
      mapping,
      retailerProductId,
      packageResult,
      validity,
      retrievedAt: retrieval.retrievedAt,
    });
    if ("reasonCode" in normalOutcome) {
      quarantines.push({ externalId, exactName, ...normalOutcome });
      continue;
    }
    offers.push(normalOutcome.offer);

    const loyaltyContainer = tile.find(".k-product-tile__pricetags-loyalty");
    if (loyaltyContainer.length > 0) {
      const loyaltyLabel = normalizeText(
        tile.find(".k-product-tile__promo").first().text(),
      );
      if (!loyaltyLabel.includes("Kaufland Card")) {
        quarantines.push({
          externalId,
          exactName,
          reasonCode: "AMBIGUOUS_MEMBERSHIP",
        });
        continue;
      }
      const loyaltyOutcome = buildOffer({
        externalId,
        exactName,
        priceText: loyaltyContainer.find(".k-price-tag__price").first().text(),
        discountText: loyaltyContainer
          .find(".k-price-tag__discount")
          .first()
          .text(),
        regularPrice:
          optionalCzechPrice(
            loyaltyContainer
              .find(".k-price-tag__old-price-line-through")
              .first()
              .text(),
          ) ?? regularPrice,
        membership: { kind: "loyalty", program: "Kaufland Card" },
        mapping,
        retailerProductId,
        packageResult,
        validity,
        retrievedAt: retrieval.retrievedAt,
      });
      if ("reasonCode" in loyaltyOutcome) {
        quarantines.push({ externalId, exactName, ...loyaltyOutcome });
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

type BuildOfferInput = Readonly<{
  externalId: string;
  exactName: string;
  priceText: string;
  discountText: string;
  regularPrice: string | null;
  membership:
    Readonly<{ kind: "none" }> | Readonly<{ kind: "loyalty"; program: string }>;
  mapping: KauflandProductMapping;
  retailerProductId: string;
  packageResult: ParsedPackage;
  validity: Readonly<{ validFrom: string; validTo: string }>;
  retrievedAt: string;
}>;

function buildOffer(
  input: BuildOfferInput,
): Readonly<{ offer: PublishedOffer }> | QuarantineFailure {
  const price = parseCzechPrice(input.priceText);
  if (!price) {
    return {
      reasonCode: normalizeText(input.priceText)
        ? "INVALID_PRICE"
        : "MISSING_PRICE",
    };
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

  const discountPercent = parseDiscountPercent(input.discountText);
  const noveltyInput = [
    KAUFLAND_PRAHA_VYPICH_SCOPE.sourceScopeId,
    input.externalId,
    input.packageResult.declared,
    price,
    input.validity.validFrom,
    input.validity.validTo,
    input.membership.kind,
    input.membership.kind === "loyalty" ? input.membership.program : "",
  ].join("|");

  try {
    return {
      offer: publishOffer({
        id: stableUuid(`offer:${noveltyInput}`),
        retailerProductId: input.retailerProductId,
        sourceScopeId: KAUFLAND_PRAHA_VYPICH_SCOPE.sourceScopeId,
        canonicalProductClassId: input.mapping.canonicalProductClassId,
        exactName: input.exactName,
        variantAttributes: { ...input.mapping.variantAttributes },
        package: input.packageResult,
        price: { amount: price, currency: "CZK" },
        regularPrice:
          input.regularPrice === null
            ? null
            : { amount: input.regularPrice, currency: "CZK" },
        discountPercent:
          discountPercent === null || input.regularPrice === null
            ? null
            : discountPercent,
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
          storeId: KAUFLAND_PRAHA_VYPICH_SCOPE.storeId,
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
          sourceUrl: KAUFLAND_PRAHA_VYPICH_SCOPE.sourceUrl,
          verificationUrls: [KAUFLAND_PRAHA_VYPICH_SCOPE.leafletUrl],
          retrievedAt: input.retrievedAt,
        },
        parserVersion: KAUFLAND_STORE_PARSER_VERSION,
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

type FetchKauflandInput = Readonly<{
  fetchImpl?: typeof fetch;
  retrievedAt: string;
  etag?: string | null;
  lastModified?: string | null;
}>;

export async function fetchKauflandStorePage(
  input: FetchKauflandInput,
): Promise<KauflandFetchResult> {
  parseIsoTimestamp(input.retrievedAt);
  const fetchImpl = input.fetchImpl ?? fetch;
  let currentUrl: string = KAUFLAND_PRAHA_VYPICH_SCOPE.sourceUrl;

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
      if (!location) {
        throw new KauflandAccessError(
          "UNAPPROVED_REDIRECT",
          "Redirect response did not provide an approved location.",
          response.status,
        );
      }
      const nextUrl = new URL(location, currentUrl);
      if (!isApprovedRedirect(nextUrl)) {
        throw new KauflandAccessError(
          "UNAPPROVED_REDIRECT",
          "Kaufland redirected outside the approved source path.",
          response.status,
        );
      }
      currentUrl = nextUrl.toString();
      continue;
    }
    if (response.status === 429) {
      throw new KauflandAccessError(
        "RATE_LIMITED",
        "Kaufland rate-limited the shared connector.",
        response.status,
        parseRetryAfter(response.headers.get("retry-after"), input.retrievedAt),
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new KauflandAccessError(
        "ACCESS_CHALLENGE",
        "Kaufland requires access that this connector must not bypass.",
        response.status,
      );
    }
    if (!response.ok) {
      throw new KauflandAccessError(
        "HTTP_ERROR",
        `Kaufland returned HTTP ${response.status}.`,
        response.status,
      );
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("text/html")) {
      throw new KauflandAccessError(
        "INVALID_CONTENT_TYPE",
        "Kaufland did not return ordinary HTML.",
        response.status,
      );
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maximumHtmlBytes) {
      throw new KauflandAccessError(
        "RESPONSE_TOO_LARGE",
        "Kaufland HTML exceeded the connector response limit.",
        response.status,
      );
    }
    const html = await response.text();
    if (Buffer.byteLength(html, "utf8") > maximumHtmlBytes) {
      throw new KauflandAccessError(
        "RESPONSE_TOO_LARGE",
        "Kaufland HTML exceeded the connector response limit.",
        response.status,
      );
    }
    if (looksLikeAccessChallenge(html)) {
      throw new KauflandAccessError(
        "ACCESS_CHALLENGE",
        "Kaufland returned an access challenge that must not be bypassed.",
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

  throw new KauflandAccessError(
    "TOO_MANY_REDIRECTS",
    "Kaufland exceeded the approved redirect limit.",
  );
}

type ParsedPackage = Readonly<{
  declared: string;
  quantity: Readonly<{ amount: string; unit: PackageUnit }>;
  count: number;
}>;

type QuarantineFailure = Readonly<{
  reasonCode: KauflandQuarantineReason;
}>;

function parsePackage(declared: string): ParsedPackage | QuarantineFailure {
  if (!declared) return { reasonCode: "MISSING_PACKAGE" };
  if (declared.includes("/")) return { reasonCode: "AMBIGUOUS_PACKAGE" };
  const match =
    /^(\d+(?:[,.]\d+)?)\s*(kg|g|ml|l|ks|kus|kusy|kusů|role|rolí|m)\b/iu.exec(
      declared,
    );
  if (!match) return { reasonCode: "UNSUPPORTED_PACKAGE_UNIT" };
  const amount = normalizeDecimal(match[1]!);
  const unit = parsePackageUnit(match[2]!);
  if (!unit) return { reasonCode: "UNSUPPORTED_PACKAGE_UNIT" };
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return { reasonCode: "MISSING_PACKAGE" };
  }
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
    case "kusy":
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

function parseValidity(
  value: string,
): Readonly<{ validFrom: string; validTo: string }> | null {
  const match =
    /^Platí od\s+(\d{2})\.(\d{2})\.(\d{4})\s+do\s+(\d{2})\.(\d{2})\.(\d{4})$/u.exec(
      value,
    );
  if (!match) return null;
  const start = parseDateParts(match[1]!, match[2]!, match[3]!);
  const end = parseDateParts(match[4]!, match[5]!, match[6]!);
  if (!start || !end) return null;
  const validFrom = zonedLocalToUtc({ ...start, endOfDay: false });
  const validTo = zonedLocalToUtc({ ...end, endOfDay: true });
  if (Date.parse(validTo) < Date.parse(validFrom)) return null;
  return { validFrom, validTo };
}

function parseDateParts(day: string, month: string, year: string) {
  const parts = { day: Number(day), month: Number(month), year: Number(year) };
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (
    date.getUTCFullYear() !== parts.year ||
    date.getUTCMonth() + 1 !== parts.month ||
    date.getUTCDate() !== parts.day
  ) {
    return null;
  }
  return parts;
}

function zonedLocalToUtc(input: {
  year: number;
  month: number;
  day: number;
  endOfDay: boolean;
}): string {
  const hour = input.endOfDay ? 23 : 0;
  const minute = input.endOfDay ? 59 : 0;
  const second = input.endOfDay ? 59 : 0;
  const millisecond = input.endOfDay ? 999 : 0;
  const targetAsUtc = Date.UTC(
    input.year,
    input.month - 1,
    input.day,
    hour,
    minute,
    second,
    millisecond,
  );
  let instant = targetAsUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    instant = targetAsUtc - timeZoneOffsetMilliseconds(instant);
  }
  return new Date(instant).toISOString();
}

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

function timeZoneOffsetMilliseconds(instant: number): number {
  const parts = Object.fromEntries(
    pragueDateTime
      .formatToParts(new Date(instant))
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, Number(value)]),
  ) as Record<string, number>;
  const representedAsUtc = Date.UTC(
    parts.year!,
    parts.month! - 1,
    parts.day!,
    parts.hour!,
    parts.minute!,
    parts.second!,
  );
  return representedAsUtc - Math.floor(instant / 1_000) * 1_000;
}

function parseExternalId(href: string): string | null {
  try {
    const value = new URL(
      href,
      KAUFLAND_PRAHA_VYPICH_SCOPE.sourceUrl,
    ).searchParams.get("kloffer-articleID");
    return value?.trim() || null;
  } catch {
    return null;
  }
}

function parseCzechPrice(value: string): string | null {
  const normalized = normalizeText(value).replace(/\s/g, "");
  const match = /^(\d{1,9})(?:,(\d{1,2}))?$/.exec(normalized);
  if (!match) return null;
  const price = `${match[1]}.${(match[2] ?? "0").padEnd(2, "0")}`;
  return Number(price) > 0 ? price : null;
}

function optionalCzechPrice(value: string): string | null {
  return normalizeText(value) ? parseCzechPrice(value) : null;
}

function parseDiscountPercent(value: string): number | null {
  const match = /^-(\d{1,3})%$/.exec(normalizeText(value));
  if (!match) return null;
  const discount = Number(match[1]);
  return discount >= 0 && discount <= 100 ? discount : null;
}

function normalizeDecimal(value: string): string {
  const normalized = value.replace(",", ".");
  if (!normalized.includes(".")) return String(Number(normalized));
  return normalized.replace(/0+$/, "").replace(/\.$/, "");
}

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function stableUuid(value: string): string {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function emptyResult(
  status: "unchanged" | "quarantined",
  retrieval: KauflandRetrieval,
  quarantines: readonly KauflandQuarantine[],
): KauflandSnapshotResult {
  return {
    status,
    retrieval,
    retailerProducts: [],
    offers: [],
    quarantines,
  };
}

function pageQuarantine(
  reasonCode: KauflandQuarantineReason,
): KauflandQuarantine {
  return { externalId: null, exactName: null, reasonCode };
}

function parseIsoTimestamp(value: string): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error("retrievedAt must be a canonical ISO timestamp.");
  }
  return parsed;
}

function isApprovedRedirect(url: URL): boolean {
  const approved = new URL(KAUFLAND_PRAHA_VYPICH_SCOPE.sourceUrl);
  return (
    url.protocol === "https:" &&
    url.hostname === approved.hostname &&
    url.pathname.replace(/\/$/, "") === approved.pathname.replace(/\/$/, "")
  );
}

function looksLikeAccessChallenge(html: string): boolean {
  return (
    /<form[^>]+id=["']challenge-form["']/iu.test(html) ||
    /<title>[^<]*(?:captcha|access denied|přístup odepřen)/iu.test(html)
  );
}

function parseRetryAfter(
  value: string | null,
  retrievedAt: string,
): string | null {
  if (!value) return null;
  const seconds = /^\d+$/.test(value.trim()) ? Number(value.trim()) : null;
  if (seconds !== null && Number.isSafeInteger(seconds)) {
    return new Date(Date.parse(retrievedAt) + seconds * 1_000).toISOString();
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}
