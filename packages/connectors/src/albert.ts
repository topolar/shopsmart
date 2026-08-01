import { load } from "cheerio";
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
import { extractTextItems, type StructuredTextItem } from "unpdf";

export const ALBERT_LEAFLET_INDEX_URL = "https://www.albert.cz/aktualni-letaky";
export const ALBERT_LEAFLET_PARSER_VERSION = "albert-leaflet-v1";

export const ALBERT_RETAILER_ID = "a1b30000-0000-8000-8000-000000000001";
export const ALBERT_SUPERMARKET_SCOPE = {
  key: "albert:cz:supermarket:physical-leaflet",
  sourceScopeId: "a1b30000-0000-8000-8000-000000000002",
  storeId: "a1b30000-0000-8000-8000-000000000003",
  storeName: "Albert supermarket leaflet class",
  kind: "supermarket",
} as const;
export const ALBERT_HYPERMARKET_SCOPE = {
  key: "albert:cz:hypermarket:physical-leaflet",
  sourceScopeId: "a1b30000-0000-8000-8000-000000000004",
  storeId: "a1b30000-0000-8000-8000-000000000005",
  storeName: "Albert hypermarket leaflet class",
  kind: "hypermarket",
} as const;

const identifiedUserAgent =
  "ShopSmart-development/0.0.0 (+https://github.com/topolar/shopsmart)";
const maximumHtmlBytes = 5 * 1_024 * 1_024;
const maximumPdfBytes = 80 * 1_024 * 1_024;
const maximumPdfPages = 100;
const rawRetentionMilliseconds = 72 * 60 * 60 * 1_000;

export type AlbertLeafletKind = "supermarket" | "hypermarket";

export type AlbertLeafletManifest = Readonly<{
  externalId: string;
  kind: AlbertLeafletKind;
  title: string;
  validFrom: string;
  validTo: string;
  viewerUrl: string;
  pdfUrl: string;
}>;

export type AlbertProductMapping = Readonly<{
  externalId: string;
  canonicalProductClassId: string;
  comparisonUnit: ComparisonUnit;
  variantAttributes: Readonly<Record<string, string>>;
}>;

export type AlbertQuarantineReason =
  | "MISSING_PRODUCT_CANDIDATES"
  | "MISSING_NAME"
  | "UNMAPPED_PRODUCT"
  | "MISSING_PACKAGE"
  | "AMBIGUOUS_PACKAGE"
  | "UNSUPPORTED_PACKAGE_UNIT"
  | "MISSING_PRICE"
  | "AMBIGUOUS_PRICE"
  | "INCOMPATIBLE_UNIT"
  | "INVALID_OFFER_CONTRACT";

export type AlbertQuarantine = Readonly<{
  externalId: string | null;
  exactName: string | null;
  declaredPackage: string | null;
  reasonCode: AlbertQuarantineReason;
  pageNumber: number | null;
}>;

export type AlbertRetailerProduct = Readonly<{
  id: string;
  retailerId: string;
  externalId: string;
  canonicalProductClassId: string;
  exactName: string;
  variantAttributes: Record<string, string>;
}>;

export type AlbertRetrieval = Readonly<{
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

export type AlbertSnapshotResult = Readonly<{
  status: "parsed" | "unchanged" | "quarantined";
  retrieval: AlbertRetrieval;
  retailerProducts: readonly AlbertRetailerProduct[];
  offers: readonly PublishedOffer[];
  quarantines: readonly AlbertQuarantine[];
}>;

export type AlbertAccessErrorCode =
  | "UNAPPROVED_RESOURCE_URL"
  | "UNAPPROVED_REDIRECT"
  | "HTTP_ERROR"
  | "ACCESS_CHALLENGE"
  | "INVALID_CONTENT_TYPE"
  | "RESPONSE_TOO_LARGE"
  | "INVALID_LEAFLET_INDEX";

export class AlbertAccessError extends Error {
  constructor(
    readonly code: AlbertAccessErrorCode,
    message: string,
    readonly httpStatus: number | null = null,
  ) {
    super(message);
    this.name = "AlbertAccessError";
  }
}

type AlbertLeafletRecord = Readonly<{
  __typename?: unknown;
  id?: unknown;
  isDefault?: unknown;
  validityStartDateFormatted?: unknown;
  validityEndDateFormatted?: unknown;
  title?: unknown;
  locationType?: unknown;
  viewUrl?: unknown;
  downloadUrl?: unknown;
  documentType?: unknown;
}>;

export function discoverAlbertLeaflets(
  html: string,
): readonly AlbertLeafletManifest[] {
  const $ = load(html);
  const serialized = $("script#__NEXT_DATA__").first().text();
  if (!serialized) {
    throw new AlbertAccessError(
      "INVALID_LEAFLET_INDEX",
      "The Albert leaflet index is missing its serialized data.",
    );
  }

  let data: unknown;
  try {
    data = JSON.parse(serialized);
  } catch {
    throw new AlbertAccessError(
      "INVALID_LEAFLET_INDEX",
      "The Albert leaflet index contains invalid serialized data.",
    );
  }

  const records = collectLeafletRecords(data).filter(
    (record) => record.documentType === "LEAFLET" && record.isDefault === true,
  );
  const leaflets = records.map(parseLeafletRecord);
  const byKind = new Map<AlbertLeafletKind, AlbertLeafletManifest>();
  for (const leaflet of leaflets) {
    if (byKind.has(leaflet.kind)) {
      throw new AlbertAccessError(
        "INVALID_LEAFLET_INDEX",
        `The Albert leaflet index contains multiple default ${leaflet.kind} leaflets.`,
      );
    }
    byKind.set(leaflet.kind, leaflet);
  }

  if (!byKind.has("supermarket") || !byKind.has("hypermarket")) {
    throw new AlbertAccessError(
      "INVALID_LEAFLET_INDEX",
      "The Albert leaflet index must expose one default leaflet for each store class.",
    );
  }

  return [byKind.get("supermarket")!, byKind.get("hypermarket")!];
}

export async function fetchAlbertResource(input: {
  url: string;
  expected: "html" | "pdf";
  etag?: string | null;
  lastModified?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<{
  body: Uint8Array | null;
  httpStatus: number;
  etag: string | null;
  lastModified: string | null;
  notModified: boolean;
}> {
  assertApprovedUrl(input.url, input.expected);
  const headers = new Headers({
    Accept:
      input.expected === "html"
        ? "text/html,application/xhtml+xml"
        : "application/pdf",
    "User-Agent": identifiedUserAgent,
  });
  if (input.etag) headers.set("If-None-Match", input.etag);
  if (input.lastModified) headers.set("If-Modified-Since", input.lastModified);

  const response = await (input.fetchImpl ?? fetch)(input.url, {
    headers,
    redirect: "manual",
  });
  if (response.status >= 300 && response.status < 400) {
    throw new AlbertAccessError(
      "UNAPPROVED_REDIRECT",
      "The Albert source returned a redirect that was not part of the reviewed path.",
      response.status,
    );
  }
  if (response.status === 304) {
    return {
      body: null,
      httpStatus: 304,
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
      notModified: true,
    };
  }
  if (!response.ok) {
    throw new AlbertAccessError(
      response.status === 403 || response.status === 429
        ? "ACCESS_CHALLENGE"
        : "HTTP_ERROR",
      `The Albert source returned HTTP ${response.status}.`,
      response.status,
    );
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const validContentType =
    input.expected === "html"
      ? contentType.includes("text/html")
      : contentType.includes("application/pdf");
  if (!validContentType) {
    throw new AlbertAccessError(
      contentType.includes("text/html") && input.expected === "pdf"
        ? "ACCESS_CHALLENGE"
        : "INVALID_CONTENT_TYPE",
      `The Albert source returned an unexpected content type: ${contentType || "missing"}.`,
      response.status,
    );
  }

  const maximumBytes =
    input.expected === "html" ? maximumHtmlBytes : maximumPdfBytes;
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new AlbertAccessError(
      "RESPONSE_TOO_LARGE",
      "The Albert source declared a response larger than the configured limit.",
      response.status,
    );
  }
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength > maximumBytes) {
    throw new AlbertAccessError(
      "RESPONSE_TOO_LARGE",
      "The Albert source returned a response larger than the configured limit.",
      response.status,
    );
  }

  return {
    body,
    httpStatus: response.status,
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
    notModified: false,
  };
}

export async function processAlbertLeafletSnapshot(input: {
  manifest: AlbertLeafletManifest;
  pdfBytes: Uint8Array;
  httpStatus: number;
  retrievedAt: string;
  etag?: string | null;
  lastModified?: string | null;
  previousContentHash?: string | null;
  previousParserVersion?: string | null;
  productMappings: readonly AlbertProductMapping[];
  extractItems?: (pdfBytes: Uint8Array) => Promise<
    Readonly<{
      totalPages: number;
      items: readonly (readonly StructuredTextItem[])[];
    }>
  >;
}): Promise<AlbertSnapshotResult> {
  const contentHash = createHash("sha256").update(input.pdfBytes).digest("hex");
  if (
    input.previousContentHash === contentHash &&
    input.previousParserVersion === ALBERT_LEAFLET_PARSER_VERSION
  ) {
    return emptyAlbertResult("unchanged", createAlbertRetrieval(input), []);
  }
  // PDF.js may transfer/detach the buffer it receives. Keep the fetched bytes
  // intact because they are hashed again and written to the evidence archive.
  installSumPreciseFallback();
  const extracted = await (input.extractItems ?? extractTextItems)(
    input.pdfBytes.slice(),
  );
  if (extracted.totalPages < 1 || extracted.totalPages > maximumPdfPages) {
    return emptyAlbertResult("quarantined", createAlbertRetrieval(input), [
      pageQuarantine("MISSING_PRODUCT_CANDIDATES"),
    ]);
  }
  return processAlbertLeafletTextItems({ ...input, pages: extracted.items });
}

function installSumPreciseFallback(): void {
  const math = Math as typeof Math & {
    sumPrecise?: (values: Iterable<number>) => number;
  };
  if (math.sumPrecise) return;
  Object.defineProperty(math, "sumPrecise", {
    configurable: true,
    value(values: Iterable<number>) {
      let sum = 0;
      let correction = 0;
      for (const value of values) {
        const next = sum + value;
        correction +=
          Math.abs(sum) >= Math.abs(value)
            ? sum - next + value
            : value - next + sum;
        sum = next;
      }
      return sum + correction;
    },
  });
}

export function createAlbertNotModifiedResult(input: {
  manifest: AlbertLeafletManifest;
  retrievedAt: string;
  contentHash: string;
  parserVersion: string;
  etag: string | null;
  lastModified: string | null;
}): AlbertSnapshotResult {
  const retrievedAt = parseCanonicalTimestamp(input.retrievedAt);
  if (!/^[a-f0-9]{64}$/.test(input.contentHash)) {
    throw new Error("An Albert 304 response requires a previous content hash.");
  }
  if (input.parserVersion !== ALBERT_LEAFLET_PARSER_VERSION) {
    throw new Error("An Albert 304 response cannot satisfy parser drift.");
  }
  const scope = scopeFor(input.manifest.kind);
  return emptyAlbertResult(
    "unchanged",
    {
      sourceScopeKey: scope.key,
      sourceUrl: input.manifest.pdfUrl,
      retrievedAt: retrievedAt.toISOString(),
      httpStatus: 304,
      contentHash: input.contentHash,
      parserVersion: ALBERT_LEAFLET_PARSER_VERSION,
      rawDeleteAt: new Date(
        retrievedAt.getTime() + rawRetentionMilliseconds,
      ).toISOString(),
      etag: input.etag,
      lastModified: input.lastModified,
    },
    [],
  );
}

export function processAlbertLeafletTextItems(input: {
  manifest: AlbertLeafletManifest;
  pages: readonly (readonly StructuredTextItem[])[];
  pdfBytes: Uint8Array;
  httpStatus: number;
  retrievedAt: string;
  etag?: string | null;
  lastModified?: string | null;
  previousContentHash?: string | null;
  previousParserVersion?: string | null;
  productMappings: readonly AlbertProductMapping[];
}): AlbertSnapshotResult {
  const retrieval = createAlbertRetrieval(input);
  if (
    input.previousContentHash === retrieval.contentHash &&
    input.previousParserVersion === ALBERT_LEAFLET_PARSER_VERSION
  ) {
    return emptyAlbertResult("unchanged", retrieval, []);
  }
  const candidates = [
    ...new Map(
      input.pages
        .flatMap((page, index) =>
          detectCandidates(page, index + 1, input.manifest.kind),
        )
        .map((candidate) => [candidate.externalId, candidate]),
    ).values(),
  ];
  if (candidates.length === 0) {
    return emptyAlbertResult("quarantined", retrieval, [
      pageQuarantine("MISSING_PRODUCT_CANDIDATES"),
    ]);
  }

  const mappings = new Map(
    input.productMappings.map((mapping) => [mapping.externalId, mapping]),
  );
  const scope = scopeFor(input.manifest.kind);
  const quarantines: AlbertQuarantine[] = [];
  const retailerProducts = new Map<string, AlbertRetailerProduct>();
  const offers: PublishedOffer[] = [];
  for (const candidate of candidates) {
    const mapping = mappings.get(candidate.externalId);
    if (!mapping) {
      quarantines.push({
        externalId: candidate.externalId,
        exactName: candidate.exactName,
        declaredPackage: candidate.declaredPackage,
        reasonCode: "UNMAPPED_PRODUCT",
        pageNumber: candidate.pageNumber,
      });
      continue;
    }
    const parsedPackage = parseAlbertPackage(candidate.declaredPackage);
    if ("reasonCode" in parsedPackage) {
      quarantines.push({
        externalId: candidate.externalId,
        exactName: candidate.exactName,
        declaredPackage: candidate.declaredPackage,
        reasonCode: parsedPackage.reasonCode,
        pageNumber: candidate.pageNumber,
      });
      continue;
    }
    if (candidate.price === null) {
      quarantines.push({
        externalId: candidate.externalId,
        exactName: candidate.exactName,
        declaredPackage: candidate.declaredPackage,
        reasonCode: "MISSING_PRICE",
        pageNumber: candidate.pageNumber,
      });
      continue;
    }

    const retailerProductId = stableUuid(
      `retailer-product:${ALBERT_RETAILER_ID}:${candidate.externalId}`,
    );
    retailerProducts.set(candidate.externalId, {
      id: retailerProductId,
      retailerId: ALBERT_RETAILER_ID,
      externalId: candidate.externalId,
      canonicalProductClassId: mapping.canonicalProductClassId,
      exactName: candidate.exactName,
      variantAttributes: { ...mapping.variantAttributes },
    });
    try {
      const unitPrice = normalizeUnitPrice({
        packagePrice: candidate.price,
        packageQuantity: parsedPackage.quantity,
        comparisonUnit: mapping.comparisonUnit,
      });
      const membership = candidate.requiresApp
        ? ({ kind: "app", program: "Můj Albert" } as const)
        : ({ kind: "none" } as const);
      const noveltyInput = [
        scope.sourceScopeId,
        candidate.externalId,
        parsedPackage.declared,
        candidate.price,
        input.manifest.validFrom,
        input.manifest.validTo,
        membership.kind,
      ].join("|");
      offers.push(
        publishOffer({
          id: stableUuid(`offer:${noveltyInput}`),
          retailerProductId,
          sourceScopeId: scope.sourceScopeId,
          canonicalProductClassId: mapping.canonicalProductClassId,
          exactName: candidate.exactName,
          variantAttributes: { ...mapping.variantAttributes },
          package: parsedPackage,
          price: { amount: candidate.price, currency: "CZK" },
          regularPrice: null,
          discountPercent: null,
          comparisonUnit: mapping.comparisonUnit,
          unitPrices: [
            {
              amount: unitPrice.amount,
              currency: "CZK",
              unit: unitPrice.unit,
            },
          ],
          membership,
          channel: "physical",
          locality: {
            kind: "physical",
            storeId: scope.storeId,
            applicability: "national",
          },
          availability: {
            kind: "physical",
            evidence: "flyer-applicability",
            stockStatus: "not-asserted",
          },
          validity: {
            validFrom: input.manifest.validFrom,
            validTo: input.manifest.validTo,
          },
          evidence: {
            level: "official",
            sourceUrl: input.manifest.pdfUrl,
            verificationUrls: [input.manifest.viewerUrl],
            retrievedAt: retrieval.retrievedAt,
          },
          parserVersion: ALBERT_LEAFLET_PARSER_VERSION,
          status: "qualified",
        }),
      );
    } catch (error) {
      quarantines.push({
        externalId: candidate.externalId,
        exactName: candidate.exactName,
        declaredPackage: candidate.declaredPackage,
        reasonCode:
          error instanceof IncompatibleUnitError
            ? "INCOMPATIBLE_UNIT"
            : error instanceof OfferPublicationError
              ? "INVALID_OFFER_CONTRACT"
              : "INVALID_OFFER_CONTRACT",
        pageNumber: candidate.pageNumber,
      });
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

export function createAlbertExternalId(input: {
  kind: AlbertLeafletKind;
  exactName: string;
  declaredPackage: string;
}): string {
  return createHash("sha256")
    .update(
      [
        input.kind,
        normalizeText(input.exactName).toLocaleLowerCase("cs-CZ"),
        normalizeText(input.declaredPackage).toLocaleLowerCase("cs-CZ"),
      ].join("|"),
    )
    .digest("hex");
}

type DetectedCandidate = Readonly<{
  externalId: string;
  exactName: string;
  declaredPackage: string;
  pageNumber: number;
  price: string | null;
  requiresApp: boolean;
}>;

type CandidateAnchor = Readonly<{
  externalId: string;
  exactName: string;
  declaredPackage: string;
  pageNumber: number;
  x: number;
  y: number;
  packageY: number;
}>;

type PriceAnchor = Readonly<{
  amount: string;
  x: number;
  y: number;
}>;

function detectCandidates(
  page: readonly StructuredTextItem[],
  pageNumber: number,
  kind: AlbertLeafletKind,
): DetectedCandidate[] {
  const anchors = new Map<string, CandidateAnchor>();
  for (const packageItem of page) {
    const declaredPackage = findDeclaredPackage(packageItem.str);
    if (!declaredPackage) continue;
    const headingItems = page
      .filter(
        (item) =>
          Math.abs(item.x - packageItem.x) <= 4 &&
          item.y > packageItem.y &&
          item.y - packageItem.y <= 45 &&
          item.fontSize >= 9.5 &&
          item.fontSize <= 15 &&
          isProductHeadingText(item.str),
      )
      .toSorted((left, right) => right.y - left.y);
    const exactName = normalizeText(
      [...new Set(headingItems.map(({ str }) => normalizeText(str)))].join(" "),
    );
    if (!exactName) continue;
    const externalId = createAlbertExternalId({
      kind,
      exactName,
      declaredPackage,
    });
    const nameKey = exactName.toLocaleLowerCase("cs-CZ");
    const existing = anchors.get(nameKey);
    if (!existing || packageItem.y > existing.packageY) {
      anchors.set(nameKey, {
        externalId,
        exactName,
        declaredPackage,
        pageNumber,
        x: headingItems[0]?.x ?? packageItem.x,
        y:
          headingItems.reduce((sum, item) => sum + item.y, 0) /
          headingItems.length,
        packageY: packageItem.y,
      });
    }
  }

  const prices = detectLargePrices(page);
  const assignments = assignPrices([...anchors.values()], prices);
  return [...anchors.values()].map((anchor) => {
    const price = assignments.get(anchor.externalId) ?? null;
    return {
      externalId: anchor.externalId,
      exactName: anchor.exactName,
      declaredPackage: anchor.declaredPackage,
      pageNumber,
      price: price?.amount ?? null,
      requiresApp: price ? hasAppLabelNear(page, price) : false,
    };
  });
}

function findDeclaredPackage(value: string): string | null {
  const normalized = normalizeText(value);
  for (const segment of normalized.split("•")) {
    const match =
      /(\d+(?:[,.]\d+)?(?:\s*[–-]\s*\d+(?:[,.]\d+)?)?)\s*(kg|g|ml|l|ks|kus|kusy|role|rolí|m)\b(?!\s*=)/iu.exec(
        segment,
      );
    if (!match) continue;
    return `${match[1]!.replace(/\s+/g, "")} ${match[2]!.toLocaleLowerCase("cs-CZ")}`;
  }
  return null;
}

function isProductHeadingText(value: string): boolean {
  const normalized = normalizeText(value);
  return (
    normalized.length >= 2 &&
    normalized.length <= 120 &&
    !normalized.startsWith("•") &&
    !normalized.includes("Kč") &&
    !/^[-+]?\d/u.test(normalized) &&
    !/^(BEZ|APLIKACE|BĚŽNÁ CENA|NEPORAZITELNÉ)$/iu.test(normalized) &&
    !normalized.includes("www.")
  );
}

function detectLargePrices(page: readonly StructuredTextItem[]): PriceAnchor[] {
  const prices: PriceAnchor[] = [];
  for (const integer of page) {
    const wholeMatch = /^(\d{1,4}),-$/.exec(normalizeText(integer.str));
    if (wholeMatch && integer.fontSize >= 28) {
      prices.push({
        amount: `${Number(wholeMatch[1])}.00`,
        x: integer.x,
        y: integer.y,
      });
      continue;
    }
    const integerMatch = /^(\d{1,3})$/.exec(normalizeText(integer.str));
    if (!integerMatch || integer.fontSize < 30) continue;
    const decimal = page
      .filter(
        (item) =>
          /^\d{2}$/.test(normalizeText(item.str)) &&
          item.fontSize >= 18 &&
          item.x > integer.x &&
          item.x - integer.x <= 55 &&
          Math.abs(item.y - integer.y) <= 25,
      )
      .toSorted(
        (left, right) => distance(integer, left) - distance(integer, right),
      )[0];
    if (!decimal) continue;
    prices.push({
      amount: `${Number(integerMatch[1])}.${normalizeText(decimal.str)}`,
      x: integer.x,
      y: integer.y,
    });
  }
  return prices;
}

function assignPrices(
  candidates: readonly CandidateAnchor[],
  prices: readonly PriceAnchor[],
): Map<string, PriceAnchor> {
  const pairs = candidates
    .flatMap((candidate) =>
      prices.map((price) => ({
        candidate,
        price,
        distance: Math.hypot(
          candidate.x - price.x,
          (candidate.y - price.y) * 1.15,
        ),
      })),
    )
    .filter(({ distance }) => distance <= 115)
    .toSorted((left, right) => left.distance - right.distance);
  const assignments = new Map<string, PriceAnchor>();
  const usedPrices = new Set<PriceAnchor>();
  for (const pair of pairs) {
    if (
      assignments.has(pair.candidate.externalId) ||
      usedPrices.has(pair.price)
    ) {
      continue;
    }
    assignments.set(pair.candidate.externalId, pair.price);
    usedPrices.add(pair.price);
  }
  return assignments;
}

function hasAppLabelNear(
  page: readonly StructuredTextItem[],
  price: PriceAnchor,
): boolean {
  const nearby = page.filter(
    (item) =>
      Math.hypot(item.x - price.x, item.y - price.y) <= 45 &&
      item.fontSize <= 8,
  );
  return (
    nearby.some((item) => normalizeText(item.str).toUpperCase() === "BEZ") &&
    nearby.some((item) =>
      normalizeText(item.str).toUpperCase().includes("APLIKACE"),
    )
  );
}

type ParsedAlbertPackage = Readonly<{
  declared: string;
  quantity: Readonly<{ amount: string; unit: PackageUnit }>;
  count: number;
}>;

function parseAlbertPackage(
  declared: string,
): ParsedAlbertPackage | Readonly<{ reasonCode: AlbertQuarantineReason }> {
  if (!declared) return { reasonCode: "MISSING_PACKAGE" };
  if (/[–-]/u.test(declared)) return { reasonCode: "AMBIGUOUS_PACKAGE" };
  const match =
    /^(\d+(?:[,.]\d+)?)\s*(kg|g|ml|l|ks|kus|kusy|role|rolí|m)$/iu.exec(
      declared,
    );
  if (!match) return { reasonCode: "UNSUPPORTED_PACKAGE_UNIT" };
  const amount = normalizeDecimal(match[1]!);
  const unit = parseAlbertPackageUnit(match[2]!);
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

function parseAlbertPackageUnit(value: string): PackageUnit | null {
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

function createAlbertRetrieval(input: {
  manifest: AlbertLeafletManifest;
  pdfBytes: Uint8Array;
  httpStatus: number;
  retrievedAt: string;
  etag?: string | null;
  lastModified?: string | null;
}): AlbertRetrieval {
  const retrievedAt = parseCanonicalTimestamp(input.retrievedAt);
  assertApprovedUrl(input.manifest.pdfUrl, "pdf");
  assertAlbertViewerUrl(input.manifest.viewerUrl);
  return {
    sourceScopeKey: scopeFor(input.manifest.kind).key,
    sourceUrl: input.manifest.pdfUrl,
    retrievedAt: retrievedAt.toISOString(),
    httpStatus: input.httpStatus,
    contentHash: createHash("sha256").update(input.pdfBytes).digest("hex"),
    parserVersion: ALBERT_LEAFLET_PARSER_VERSION,
    rawDeleteAt: new Date(
      retrievedAt.getTime() + rawRetentionMilliseconds,
    ).toISOString(),
    etag: input.etag ?? null,
    lastModified: input.lastModified ?? null,
  };
}

function scopeFor(kind: AlbertLeafletKind) {
  return kind === "supermarket"
    ? ALBERT_SUPERMARKET_SCOPE
    : ALBERT_HYPERMARKET_SCOPE;
}

function parseCanonicalTimestamp(value: string): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error("retrievedAt must be a canonical ISO timestamp.");
  }
  return parsed;
}

function normalizeDecimal(value: string): string {
  const normalized = value.replace(",", ".");
  if (!normalized.includes(".")) return String(Number(normalized));
  return normalized.replace(/0+$/, "").replace(/\.$/, "");
}

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function distance(
  left: Pick<StructuredTextItem, "x" | "y">,
  right: Pick<StructuredTextItem, "x" | "y">,
): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function stableUuid(value: string): string {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function emptyAlbertResult(
  status: "unchanged" | "quarantined",
  retrieval: AlbertRetrieval,
  quarantines: readonly AlbertQuarantine[],
): AlbertSnapshotResult {
  return {
    status,
    retrieval,
    retailerProducts: [],
    offers: [],
    quarantines,
  };
}

function pageQuarantine(reasonCode: AlbertQuarantineReason): AlbertQuarantine {
  return {
    externalId: null,
    exactName: null,
    declaredPackage: null,
    reasonCode,
    pageNumber: null,
  };
}

function collectLeafletRecords(root: unknown): AlbertLeafletRecord[] {
  const records: AlbertLeafletRecord[] = [];
  const queue: unknown[] = [root];
  const seen = new Set<object>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (typeof current !== "object" || current === null || seen.has(current)) {
      continue;
    }
    seen.add(current);
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    const record = current as Record<string, unknown>;
    if (record.__typename === "Leaflet") records.push(record);
    queue.push(...Object.values(record));
  }
  return records;
}

function parseLeafletRecord(
  record: AlbertLeafletRecord,
): AlbertLeafletManifest {
  const kind =
    record.locationType === "SUPERMARKET"
      ? "supermarket"
      : record.locationType === "HYPERMARKET"
        ? "hypermarket"
        : null;
  if (
    typeof record.id !== "string" ||
    !/^\d+$/.test(record.id) ||
    !kind ||
    typeof record.title !== "string" ||
    typeof record.validityStartDateFormatted !== "string" ||
    typeof record.validityEndDateFormatted !== "string" ||
    typeof record.viewUrl !== "string" ||
    typeof record.downloadUrl !== "string"
  ) {
    throw new AlbertAccessError(
      "INVALID_LEAFLET_INDEX",
      "The Albert leaflet index contains an incomplete default leaflet.",
    );
  }
  assertAlbertViewerUrl(record.viewUrl);
  assertApprovedUrl(record.downloadUrl, "pdf");
  return {
    externalId: record.id,
    kind,
    title: record.title,
    validFrom: parsePragueDate(record.validityStartDateFormatted, "start"),
    validTo: parsePragueDate(record.validityEndDateFormatted, "end"),
    viewerUrl: record.viewUrl,
    pdfUrl: record.downloadUrl,
  };
}

function assertApprovedUrl(urlString: string, expected: "html" | "pdf"): void {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new AlbertAccessError(
      "UNAPPROVED_RESOURCE_URL",
      "The Albert source exposed an invalid resource URL.",
    );
  }
  const approved =
    expected === "html"
      ? url.origin === "https://www.albert.cz" &&
        url.pathname === "/aktualni-letaky" &&
        url.search === ""
      : url.origin === "https://view.publitas.com" &&
        /^\/\d+\/\d+\/pdfs\/[a-zA-Z0-9-]+\.pdf$/.test(url.pathname);
  if (!approved) {
    throw new AlbertAccessError(
      "UNAPPROVED_RESOURCE_URL",
      "The Albert source exposed a resource outside the reviewed allowlist.",
    );
  }
}

function assertAlbertViewerUrl(urlString: string): void {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new AlbertAccessError(
      "UNAPPROVED_RESOURCE_URL",
      "The Albert source exposed an invalid viewer URL.",
    );
  }
  if (
    url.origin !== "https://letaky.albert.cz" ||
    !/^\/[a-zA-Z0-9_-]+\/$/.test(url.pathname) ||
    url.search !== ""
  ) {
    throw new AlbertAccessError(
      "UNAPPROVED_RESOURCE_URL",
      "The Albert source exposed a viewer URL outside the reviewed allowlist.",
    );
  }
}

function parsePragueDate(value: string, boundary: "start" | "end"): string {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  if (!match) {
    throw new AlbertAccessError(
      "INVALID_LEAFLET_INDEX",
      "The Albert leaflet contains an invalid validity date.",
    );
  }
  const [, day, month, year] = match;
  return pragueLocalToUtc(
    Number(year),
    Number(month),
    Number(day),
    boundary === "start" ? 0 : 23,
    boundary === "start" ? 0 : 59,
    boundary === "start" ? 0 : 59,
    boundary === "start" ? 0 : 999,
  ).toISOString();
}

function pragueLocalToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
): Date {
  const desiredAsUtc = Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
    second,
    millisecond,
  );
  let candidate = desiredAsUtc;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(candidate))
        .filter(({ type }) => type !== "literal")
        .map(({ type, value }) => [type, Number(value)]),
    );
    const representedAsUtc = Date.UTC(
      parts.year!,
      parts.month! - 1,
      parts.day!,
      parts.hour!,
      parts.minute!,
      parts.second!,
      millisecond,
    );
    candidate -= representedAsUtc - desiredAsUtc;
  }
  return new Date(candidate);
}
