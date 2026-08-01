# ShopSmart

ShopSmart je plánovaná veřejná služba pro personalizované hlídání nákupních nabídek. Uživatel si nastaví produkty, varianty, cenové limity, lokalitu, dostupné kamenné pobočky, e-shopy a věrnostní programy. Služba sdíleně získává a normalizuje nabídky a deterministicky je porovnává pro webový přehled a agregované e-maily.

Produktový a datový geografický rozsah je výhradně Česká republika. České regiony, prodejny, ceny v CZK a české podmínky zdrojů jsou součástí kontraktu; zdroj z jiné země není náhradou za chybějící povolený český zdroj.

## Stav

Součástí baseline je také ohraničený AI-assist candidate/review tok s
deterministickou validací, TypeORM auditem a operátorským rozhraním. Živý model
provider není nakonfigurovaný a AI kandidát nemá cestu k automatické publikaci.

Repozitář obsahuje dokumentační a architektonický základ a testovaný TypeScript baseline: deterministickou normalizaci a tenant-scoped matching, Better Auth sessions, český onboarding, evidence-backed dashboard, candidate-first online stock gate, verzované Zod kontrakty, TypeORM/PostgreSQL persistence, transakční notification outbox, shared connector job leasing/health a Fastify + Next.js/Tailwind vertical slice.

- [`PLAN.md`](PLAN.md) — podrobný plán, praktická zjištění z osobního pilotu, doménový model, architektura, roadmapa a hranice AI.
- [`docs/TECHNICAL_ARCHITECTURE.md`](docs/TECHNICAL_ARCHITECTURE.md) — zvolený local-first stack, porty, Docker/PostgreSQL, Cloudflare Tunnel a cesta k produkčnímu hostingu.
- [`docs/CONNECTOR_OPERATIONS.md`](docs/CONNECTOR_OPERATIONS.md) — PostgreSQL leasing, TTL/early refresh, coverage manifesty a provozní stavy connectorů.
- [`docs/decisions/0004-first-retailer-source.md`](docs/decisions/0004-first-retailer-source.md) — první český source scope: Kaufland Praha-Vypich, povolené cesty, rate limit, retention a fail-closed pravidla.
- [`docs/decisions/0005-albert-leaflet-source.md`](docs/decisions/0005-albert-leaflet-source.md) — oficiální české Albert supermarket/hypermarket letáky, PDF extrakce, rate limit a fail-closed pravidla.
- [`docs/AI_ASSIST_OPERATIONS.md`](docs/AI_ASSIST_OPERATIONS.md) — verzované AI candidate kontrakty, deterministické brány, nákladové limity, cache a operátorské review.
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

Zkopírujte `.env.example` do ignorovaného `.env`, nahraďte oba password placeholdery stejným náhodným lokálním heslem a nastavte nejméně 32znakový náhodný `BETTER_AUTH_SECRET`. Potom:

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

`pnpm smoke` vyžaduje běžící PostgreSQL, aplikované migrace a `DATABASE_URL` v prostředí. Integrační testy používají výhradně jednorázovou databázi z `DATABASE_TEST_URL`; lokální `DATABASE_URL` se nikdy testovacím cleanupem nemaže. V kontejneru ji jednorázově vytvoříte příkazem `docker exec shopsmart-postgres createdb -U shopsmart_app shopsmart_test`.

## Další krok

První Kaufland shared-ingestion konektor lze lokálně spustit a jeho neurčené produkty explicitně mapovat:

```powershell
pnpm ingest:kaufland
pnpm mapping:kaufland list
pnpm mapping:kaufland classes
pnpm mapping:kaufland approve --candidate <candidate-uuid> --canonical <class-uuid> --reviewer local-operator --attributes '{"state":"fresh"}'
```

`ingest:kaufland` respektuje sdílený due time; nespouštějte ruční opakování uvnitř šestihodinového minima z ADR 0004. Raw HTML zůstává pouze v ignorovaném `SHOPSMART_RAW_SNAPSHOT_DIR` a po 72 hodinách se maže. Výstup příkazů obsahuje jen agregáty nebo review metadata, ne raw obsah.

Albert konektor sdíleně obsluhuje oba české typy letáku a zůstává v TypeScriptu:

```powershell
pnpm ingest:albert
pnpm mapping:albert list --scope supermarket
pnpm mapping:albert list --scope hypermarket
pnpm mapping:albert classes
pnpm mapping:albert approve --candidate <candidate-uuid> --canonical <class-uuid> --reviewer local-operator --attributes '{"state":"fresh"}'
```

`ingest:albert` načte oficiální index jednou pouze tehdy, když je alespoň jeden scope due, a každou PDF třídu nejvýše jednou za 12 hodin. Raw PDF je jen v ignorovaném `SHOPSMART_ALBERT_RAW_SNAPSHOT_DIR` a po 72 hodinách se maže. Bez explicitního mapování vznikne pouze review kandidát; leták netvrdí skladovou dostupnost.

Navazující krok je první provozní review zachycených kandidátů a podle GitHub Issues produkční Resend adapter s ověřenými webhooky.

## Vývojový workflow

GitHub Issues jsou závazný seznam práce i auditní stopa provedených změn. Každá změna repozitáře má před první úpravou přiřazené Issue s cílem a akceptačními kritérii; průběh, skutečné výsledky ověření a předání k review se zapisují zpět do něj. Podrobný kontrakt je v [`AGENTS.md`](AGENTS.md) a Codex workflow v [`.agents/skills/track-github-work/SKILL.md`](.agents/skills/track-github-work/SKILL.md).
