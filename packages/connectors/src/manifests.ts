import { connectorManifestSchema } from "@shopsmart/contracts";

import {
  ALBERT_HYPERMARKET_SCOPE,
  ALBERT_LEAFLET_INDEX_URL,
  ALBERT_LEAFLET_PARSER_VERSION,
  ALBERT_SUPERMARKET_SCOPE,
} from "./albert.js";
import { GLOBUS_BRNO_SCOPE, GLOBUS_FEATURED_PARSER_VERSION } from "./globus.js";
import {
  KAUFLAND_PRAHA_VYPICH_SCOPE,
  KAUFLAND_STORE_PARSER_VERSION,
} from "./kaufland.js";

const twelveHours = 12 * 60 * 60;
const sixHours = 6 * 60 * 60;
const seventyTwoHours = 72 * 60 * 60;

export const ALBERT_CONNECTOR_MANIFEST = connectorManifestSchema.parse({
  contractVersion: "1",
  connectorId: "albert",
  displayName: "Albert Czech leaflets",
  country: "CZ",
  parserVersion: ALBERT_LEAFLET_PARSER_VERSION,
  contentKind: "pdf",
  capabilities: {
    conditionalRequests: true,
    retainedSnapshotReprocess: true,
    physicalOffers: true,
    onlineStock: false,
  },
  scopes: [ALBERT_SUPERMARKET_SCOPE, ALBERT_HYPERMARKET_SCOPE].map((scope) => ({
    key: scope.key,
    entryUrl: ALBERT_LEAFLET_INDEX_URL,
    requiredCoverageKeys: [scope.key],
    refreshIntervalSeconds: twelveHours,
    leaseSeconds: 30 * 60,
    maxAttempts: 3,
    minimumRateLimitPauseSeconds: sixHours,
    rawRetentionSeconds: seventyTwoHours,
  })),
});

export const GLOBUS_CONNECTOR_MANIFEST = connectorManifestSchema.parse({
  contractVersion: "1",
  connectorId: "globus",
  displayName: "Globus Brno featured offers",
  country: "CZ",
  parserVersion: GLOBUS_FEATURED_PARSER_VERSION,
  contentKind: "html",
  capabilities: {
    conditionalRequests: true,
    retainedSnapshotReprocess: true,
    physicalOffers: true,
    onlineStock: false,
  },
  scopes: [
    {
      key: GLOBUS_BRNO_SCOPE.key,
      entryUrl: GLOBUS_BRNO_SCOPE.sourceUrl,
      requiredCoverageKeys: [GLOBUS_BRNO_SCOPE.key],
      refreshIntervalSeconds: twelveHours,
      leaseSeconds: 15 * 60,
      maxAttempts: 3,
      minimumRateLimitPauseSeconds: sixHours,
      rawRetentionSeconds: seventyTwoHours,
    },
  ],
});

export const KAUFLAND_CONNECTOR_MANIFEST = connectorManifestSchema.parse({
  contractVersion: "1",
  connectorId: "kaufland",
  displayName: "Kaufland Praha-Vypich offers",
  country: "CZ",
  parserVersion: KAUFLAND_STORE_PARSER_VERSION,
  contentKind: "html",
  capabilities: {
    conditionalRequests: true,
    retainedSnapshotReprocess: true,
    physicalOffers: true,
    onlineStock: false,
  },
  scopes: [
    {
      key: KAUFLAND_PRAHA_VYPICH_SCOPE.key,
      entryUrl: KAUFLAND_PRAHA_VYPICH_SCOPE.sourceUrl,
      requiredCoverageKeys: [KAUFLAND_PRAHA_VYPICH_SCOPE.key],
      refreshIntervalSeconds: twelveHours,
      leaseSeconds: 15 * 60,
      maxAttempts: 3,
      minimumRateLimitPauseSeconds: sixHours,
      rawRetentionSeconds: seventyTwoHours,
    },
  ],
});

export const CONNECTOR_MANIFESTS = [
  ALBERT_CONNECTOR_MANIFEST,
  GLOBUS_CONNECTOR_MANIFEST,
  KAUFLAND_CONNECTOR_MANIFEST,
] as const;
