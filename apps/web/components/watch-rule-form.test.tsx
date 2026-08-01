import type { WatchRuleOptionsResponse } from "@shopsmart/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  WatchRuleFormView,
  buildCreateWatchRuleRequest,
} from "./watch-rule-form";

describe("WatchRuleForm", () => {
  it("renders a Czech structured product, price, store, and membership form", () => {
    const html = renderToStaticMarkup(
      createElement(WatchRuleFormView, {
        options,
        rules: [],
        selectedProductId: options.products[0]!.id,
        pending: false,
      }),
    );

    expect(html).toContain("Hlídání produktu");
    expect(html).toContain("Salátové okurky");
    expect(html).toContain("Albert supermarket – celostátní leták");
    expect(html).toContain("Maximální cena za kus");
    expect(html).toContain("Věrnostní program");
  });

  it("builds the validated request from catalogue facts instead of trusting UI units", () => {
    expect(
      buildCreateWatchRuleRequest(options, {
        productId: options.products[0]!.id,
        maxUnitPriceAmount: "25.00",
        storeIds: [options.availableStores[0]!.id],
        acceptedMemberships: ["loyalty:my-club"],
      }),
    ).toEqual({
      canonicalProductClassId: options.products[0]!.id,
      maxUnitPrice: { amount: "25.00", currency: "CZK", unit: "piece" },
      acceptedMemberships: ["loyalty:my-club"],
      channel: "physical",
      storeIds: [options.availableStores[0]!.id],
    });
  });
});

const options: WatchRuleOptionsResponse = {
  tenantId: "018f5f70-7b5d-7a21-9f49-01b7f63a9501",
  products: [
    {
      contractVersion: "1",
      id: "a1000000-0000-8000-8000-000000000008",
      slug: "salad-cucumbers",
      name: "Syntetická salátová okurka",
      comparisonUnit: "piece",
      requiredAttributes: { state: "fresh" },
      excludedAttributes: {},
    },
  ],
  availableStores: [
    {
      id: "018f5f70-7b5d-7a21-9f49-01b7f63a9502",
      retailerId: "a1b30000-0000-8000-8000-000000000001",
      name: "Albert supermarket – celostátní leták",
      city: "Česko",
    },
  ],
  selectedStoreIds: ["018f5f70-7b5d-7a21-9f49-01b7f63a9502"],
  acceptedMemberships: ["loyalty:my-club"],
};
