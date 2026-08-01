# ShopSmart

ShopSmart je plánovaná veřejná služba pro personalizované hlídání nákupních nabídek. Uživatel si nastaví produkty, varianty, cenové limity, lokalitu, dostupné kamenné pobočky, e-shopy a věrnostní programy. Služba sdíleně získává a normalizuje nabídky a deterministicky je porovnává pro webový přehled a agregované e-maily.

## Stav

Repozitář obsahuje dokumentační a architektonický základ a testovaný TypeScript baseline: deterministickou normalizaci jednotkové ceny, verzované Zod kontrakty canonical products/offers/evidence, fail-closed publikační bránu, TypeORM/PostgreSQL persistence a tenký Fastify + Next.js/Tailwind vertical slice.

- [`PLAN.md`](PLAN.md) — podrobný plán, praktická zjištění z osobního pilotu, doménový model, architektura, roadmapa a hranice AI.
- [`docs/TECHNICAL_ARCHITECTURE.md`](docs/TECHNICAL_ARCHITECTURE.md) — zvolený local-first stack, porty, Docker/PostgreSQL, Cloudflare Tunnel a cesta k produkčnímu hostingu.
- [`AGENTS.md`](AGENTS.md) — závazné instrukce pro coding agenty a budoucí příspěvky.

## Hlavní princip

> Retail data stáhnout a normalizovat jednou pro daný zdroj/scope; personalizované matching rules spouštět levně nad společnou databází.

AI je pomocná vrstva pro volný text, nestrukturované letáky a nejednoznačné mapování produktů. Ceny, jednotkové výpočty, platnost, řazení, deduplikace, lokalita, oprávnění a doručení musí zůstat deterministické a testované.

## Bezpečnost a soukromí

Jde o veřejný repozitář. Nevkládejte do něj osobní e-maily, soukromé adresy, cookies, retailer účty, API klíče ani produkční snapshoty. Každá zveřejněná nabídka musí mít dohledatelný zdroj a údaj o čerstvosti.

## Lokální vývoj

Požadavky:

- Node.js `24.18.0` (soubor `.node-version`);
- pnpm `11.10.0`;
- Docker s Docker Compose.

Zkopírujte `.env.example` do ignorovaného `.env` a nahraďte oba password placeholdery stejným náhodným lokálním heslem. Potom:

```powershell
pnpm install
docker compose up -d postgres
pnpm db:migrate
```

API a web spusťte v samostatných terminálech:

```powershell
pnpm dev:api
pnpm dev:web
```

Web naslouchá na `http://127.0.0.1:3310`, privátní API na `http://127.0.0.1:8310` a PostgreSQL pouze na `127.0.0.1:57432`. OpenAPI dokument je dostupný na `http://127.0.0.1:8310/api/v1/openapi.json`.

Kontroly lokálního řezu:

```powershell
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm smoke
```

`pnpm smoke` vyžaduje běžící PostgreSQL, aplikované migrace a `DATABASE_URL` v prostředí.

## Další krok

Rozšiřovat baseline podle navazujících GitHub Issues: deterministický matching, první povolený shared-ingestion zdroj, onboarding, dashboard a přesně jednou potvrzené notifikace.

## Vývojový workflow

GitHub Issues jsou závazný seznam práce i auditní stopa provedených změn. Každá změna repozitáře má před první úpravou přiřazené Issue s cílem a akceptačními kritérii; průběh, skutečné výsledky ověření a předání k review se zapisují zpět do něj. Podrobný kontrakt je v [`AGENTS.md`](AGENTS.md) a Codex workflow v [`.agents/skills/track-github-work/SKILL.md`](.agents/skills/track-github-work/SKILL.md).
