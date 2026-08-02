import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import HomePage from "./page";

describe("ShopSmart homepage", () => {
  it("offers only Google sign-in and does not expose implementation demos", () => {
    const html = renderToStaticMarkup(createElement(HomePage));

    expect(html).toContain("Přihlásit přes Google");
    expect(html).not.toContain("Vytvořit účet");
    expect(html).not.toContain("Nový účet");
    expect(html).not.toContain("Ověření jednotkové ceny");
    expect(html).not.toContain('type="password"');
  });
});
