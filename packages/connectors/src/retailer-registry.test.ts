import { describe, expect, it } from "vitest";

import { ALBERT_RETAILER_ID } from "./albert.js";
import { KAUFLAND_PRAHA_VYPICH_SCOPE } from "./kaufland.js";
import { resolveRetailerIdentity } from "./retailer-registry.js";

describe("retailer identity registry", () => {
  it("resolves every approved connector and fails closed for unknown ids", () => {
    expect(resolveRetailerIdentity(ALBERT_RETAILER_ID)).toEqual({
      id: ALBERT_RETAILER_ID,
      name: "Albert",
    });
    expect(
      resolveRetailerIdentity(KAUFLAND_PRAHA_VYPICH_SCOPE.retailerId),
    ).toEqual({
      id: KAUFLAND_PRAHA_VYPICH_SCOPE.retailerId,
      name: "Kaufland",
    });
    expect(
      resolveRetailerIdentity("018f5f70-7b5d-7a21-9f49-01b7f63a9999"),
    ).toBeNull();
  });
});
