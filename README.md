# ShopSmart

ShopSmart je plánovaná veřejná služba pro personalizované hlídání nákupních nabídek. Uživatel si nastaví produkty, varianty, cenové limity, lokalitu, dostupné kamenné pobočky, e-shopy a věrnostní programy. Služba sdíleně získává a normalizuje nabídky a deterministicky je porovnává pro webový přehled a agregované e-maily.

## Stav

Repozitář nyní obsahuje dokumentační a architektonický základ. Aplikace zatím není implementována.

- [`PLAN.md`](PLAN.md) — podrobný plán, praktická zjištění z osobního pilotu, doménový model, architektura, roadmapa a hranice AI.
- [`AGENTS.md`](AGENTS.md) — závazné instrukce pro coding agenty a budoucí příspěvky.

## Hlavní princip

> Retail data stáhnout a normalizovat jednou pro daný zdroj/scope; personalizované matching rules spouštět levně nad společnou databází.

AI je pomocná vrstva pro volný text, nestrukturované letáky a nejednoznačné mapování produktů. Ceny, jednotkové výpočty, platnost, řazení, deduplikace, lokalita, oprávnění a doručení musí zůstat deterministické a testované.

## Bezpečnost a soukromí

Jde o veřejný repozitář. Nevkládejte do něj osobní e-maily, soukromé adresy, cookies, retailer účty, API klíče ani produkční snapshoty. Každá zveřejněná nabídka musí mít dohledatelný zdroj a údaj o čerstvosti.

## Další krok

Potvrdit otevřená rozhodnutí ve fázi 0 plánu a poté implementovat jedinou testovanou end-to-end vertical slice namísto prázdného scaffoldingu.
