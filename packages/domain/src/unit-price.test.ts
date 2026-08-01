import { describe, expect, it } from "vitest";

import { IncompatibleUnitError, normalizeUnitPrice } from "./unit-price.js";

describe("normalizeUnitPrice", () => {
  it("normalizes a 250 g package price to currency per 100 g", () => {
    expect(
      normalizeUnitPrice({
        packagePrice: "49.90",
        packageQuantity: { amount: "250", unit: "gram" },
        comparisonUnit: "100-gram",
      }),
    ).toEqual({ amount: "19.96", unit: "100-gram" });
  });

  it("normalizes a multi-piece package to currency per piece", () => {
    expect(
      normalizeUnitPrice({
        packagePrice: "59.90",
        packageQuantity: { amount: "8", unit: "piece" },
        comparisonUnit: "piece",
      }),
    ).toEqual({ amount: "7.49", unit: "piece" });
  });

  it("fails closed when package and comparison units are incompatible", () => {
    expect(() =>
      normalizeUnitPrice({
        packagePrice: "49.90",
        packageQuantity: { amount: "250", unit: "gram" },
        comparisonUnit: "piece",
      }),
    ).toThrow(IncompatibleUnitError);
  });
});
