import { ALBERT_RETAILER_ID } from "./albert.js";
import { GLOBUS_BRNO_SCOPE } from "./globus.js";
import { KAUFLAND_PRAHA_VYPICH_SCOPE } from "./kaufland.js";

export type RetailerIdentity = Readonly<{ id: string; name: string }>;

const RETAILERS = new Map<string, RetailerIdentity>([
  [ALBERT_RETAILER_ID, { id: ALBERT_RETAILER_ID, name: "Albert" }],
  [
    GLOBUS_BRNO_SCOPE.retailerId,
    { id: GLOBUS_BRNO_SCOPE.retailerId, name: "Globus" },
  ],
  [
    KAUFLAND_PRAHA_VYPICH_SCOPE.retailerId,
    { id: KAUFLAND_PRAHA_VYPICH_SCOPE.retailerId, name: "Kaufland" },
  ],
]);

export function resolveRetailerIdentity(
  retailerId: string,
): RetailerIdentity | null {
  return RETAILERS.get(retailerId) ?? null;
}
