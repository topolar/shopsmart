# ShopSmart

ShopSmart je plánovaná veřejná služba pro personalizované hlídání nákupních nabídek. Uživatel si nastaví produkty, varianty, cenové limity, lokalitu, dostupné kamenné pobočky, e-shopy a věrnostní programy. Služba sdíleně získává a normalizuje nabídky a deterministicky je porovnává pro webový přehled a agregované e-maily.

Produktový a datový geografický rozsah je výhradně Česká republika. České regiony, prodejny, ceny v CZK a české podmínky zdrojů jsou součástí kontraktu; zdroj z jiné země není náhradou za chybějící povolený český zdroj.

## Stav

Součástí baseline je také ohraničený AI-assist candidate/review tok s
deterministickou validací, TypeORM auditem a operátorským rozhraním. Živý model
provider není nakonfigurovaný a AI kandidát nemá cestu k automatické publikaci.

Repozitář obsahuje dokumentační a architektonický základ a testovaný TypeScript baseline: deterministickou normalizaci a tenant-scoped matching, Google-only Firebase Authentication se serverovou session, český onboarding, evidence-backed dashboard, candidate-first online stock gate, verzované Zod kontrakty, TypeORM/PostgreSQL persistence, transakční notification outbox, shared connector job leasing/health a Fastify + Next.js/Tailwind vertical slice.

- [`PLAN.md`](PLAN.md) — podrobný plán, praktická zjištění z osobního pilotu, doménový model, architektura, roadmapa a hranice AI.
- [`docs/TECHNICAL_ARCHITECTURE.md`](docs/TECHNICAL_ARCHITECTURE.md) — zvolený local-first stack, porty, Docker/PostgreSQL, Cloudflare Tunnel a cesta k produkčnímu hostingu.
- [`docs/FIREBASE_AUTH.md`](docs/FIREBASE_AUTH.md) — reprodukovatelné Google-only Firebase Auth nastavení, lokální Admin credential a Cloudflare hostname.
- [`docs/CONNECTOR_OPERATIONS.md`](docs/CONNECTOR_OPERATIONS.md) — PostgreSQL leasing, TTL/early refresh, coverage manifesty a provozní stavy connectorů.
- [`docs/decisions/0004-first-retailer-source.md`](docs/decisions/0004-first-retailer-source.md) — první český source scope: Kaufland Praha-Vypich, povolené cesty, rate limit, retention a fail-closed pravidla.
- [`docs/decisions/0005-albert-leaflet-source.md`](docs/decisions/0005-albert-leaflet-source.md) — oficiální české Albert supermarket/hypermarket letáky, PDF extrakce, rate limit a fail-closed pravidla.
- [`docs/decisions/0006-globus-brno-featured-offers.md`](docs/decisions/0006-globus-brno-featured-offers.md) — povolený Globus Brno featured-offer scope a roboty zakázané cesty, které konektor nikdy nenavštěvuje.
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

Zkopírujte `.env.example` do ignorovaného `.env`, nahraďte oba password placeholdery stejným náhodným lokálním heslem a doplňte Firebase Web App hodnoty a cestu k lokálnímu Admin credentialu podle [`docs/FIREBASE_AUTH.md`](docs/FIREBASE_AUTH.md). Potom:

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

Všechny retailer konektory mají společný verzovaný manifest a operator runtime. Pro běžný provoz používejte jednotný vstup:

```powershell
pnpm connector list
pnpm connector health
pnpm connector run --connector kaufland
pnpm connector reprocess --connector kaufland --scope kaufland:cz:praha-vypich:3300:physical-offers
pnpm connector repair --connector kaufland --scope kaufland:cz:praha-vypich:3300:physical-offers --reason explicit-request
```

`list` vypíše schválené české scope, capabilities a provozní policy. `health` je read-only agregace jobu, posledního coverage manifestu, retrieval metadata a raw retention. `run` sdíleně zpracuje pouze due scope. `reprocess` použije hashově ověřený retained snapshot. `repair` pouze auditovaně naplánuje early refresh; neobchází rate limit ani ochrany zdroje. Retailer-specific `mapping:*` příkazy zůstávají pro explicitní schvalování produktové identity. Rozšiřovací a incidentní postup popisuje [`docs/CONNECTOR_OPERATIONS.md`](docs/CONNECTOR_OPERATIONS.md).

První Kaufland shared-ingestion konektor lze lokálně spustit a jeho neurčené produkty explicitně mapovat:

```powershell
pnpm ingest:kaufland
pnpm mapping:kaufland list
pnpm mapping:kaufland reprocess
pnpm mapping:kaufland classes
pnpm mapping:kaufland approve --candidate <candidate-uuid> --canonical <class-uuid> --reviewer local-operator --attribute state=fresh
```

`ingest:kaufland` respektuje sdílený due time; nespouštějte ruční opakování uvnitř šestihodinového minima z ADR 0004. Raw HTML zůstává pouze v ignorovaném `SHOPSMART_RAW_SNAPSHOT_DIR` a po 72 hodinách se maže. `--attribute key=value` lze zopakovat pro více atributů a na PowerShellu nevyžaduje JSON quoting. Schválení i explicitní `reprocess` hashově ověří a znovu zpracují nejnovější uchovaný HTML snapshot bez retailer requestu. Výstup příkazů obsahuje jen agregáty nebo review metadata, ne raw obsah.

Albert konektor sdíleně obsluhuje oba české typy letáku a zůstává v TypeScriptu:

```powershell
pnpm ingest:albert
pnpm mapping:albert list --scope supermarket
pnpm mapping:albert list --scope hypermarket
pnpm mapping:albert reprocess --scope supermarket
pnpm mapping:albert classes
pnpm mapping:albert approve --candidate <candidate-uuid> --canonical <class-uuid> --reviewer local-operator --attributes '{"state":"fresh"}'
```

`ingest:albert` načte oficiální index jednou pouze tehdy, když je alespoň jeden scope due, a každou PDF třídu nejvýše jednou za 12 hodin. Raw PDF je jen v ignorovaném `SHOPSMART_ALBERT_RAW_SNAPSHOT_DIR` a po 72 hodinách se maže. Schválení mapování okamžitě znovu zpracuje uchované PDF bez nového stažení; příkaz `reprocess` lze bezpečně zopakovat po přechodné chybě. Bez explicitního mapování vznikne pouze review kandidát; leták netvrdí skladovou dostupnost.

Globus konektor je omezený na osm zvýrazněných nabídek na oficiální stránce Brno:

```powershell
pnpm ingest:globus
pnpm mapping:globus list
pnpm mapping:globus reprocess
pnpm mapping:globus classes
pnpm mapping:globus approve --candidate <candidate-uuid> --canonical <class-uuid> --reviewer local-operator --attributes '{"state":"fresh"}'
```

Jeden shared fetch je nejvýše jednou za 12 hodin. Produktové odkazy a úplné nabídky zakázané v Globus `robots.txt` se nikdy nenačítají. Veřejná a zřetelně označená cena `Můj Globus` jsou samostatné nabídky; nejasná klubová cena se karanténuje. Raw HTML je v ignorovaném `SHOPSMART_GLOBUS_RAW_SNAPSHOT_DIR` nejvýše 72 hodin a schválení mapování ho hashově ověří a znovu zpracuje bez sítě.

Publikované nabídky se společně porovnají se všemi relevantními watch rules příkazem:

```powershell
pnpm match:run-once
```

Worker nespouští žádný source fetch ani job pro jednotlivého uživatele. Publikované nabídky načte jednou, watch rules omezí v PostgreSQL podle canonical product class a konečné rozhodnutí deleguje deterministickému matcheru. Výstup obsahuje pouze agregované počty včetně stabilních rejection reasons. Opakovaný nebo souběžný běh je idempotentní a neznámý retailer se odmítne fail-closed.

Po přihlášení lze ve webu vybrat známé kamenné zdroje, uložit onboarding a založit strukturované hlídání canonical produktu s maximální jednotkovou cenou v CZK. API odvozuje jednotku a povinné/excluded atributy ze serverového katalogu, ověřuje prodejny a členství proti tenant onboarding volbám a nepřijímá klientem oslabenou identitu produktu. Nové shody se objeví po následujícím společném `pnpm match:run-once`; vytvoření pravidla samo žádný retailer nestahuje.

Dosud nezařazené shody lze připravit do transakčního notification outboxu bez odeslání providerovi:

```powershell
pnpm digest:plan-once --interval 2026-08-01
```

Interval key musí být stabilní pro plánovanou dávku. Planner načte fakta jednou, seskupí je po tenantu, ověří publikovatelnou evidenci přes společný renderer a odmítne chybějící či nejednoznačný recipient fail-closed. CLI vypisuje jen agregované počty; e-mailové adresy ani payloady neloguje a žádný provider nevolá. Opakovaný běh nezaloží duplicitní novelty events.

Navazující krok je první provozní review zachycených kandidátů a podle GitHub Issues produkční Resend adapter s ověřenými webhooky.

## Vývojový workflow

GitHub Issues jsou závazný seznam práce i auditní stopa provedených změn. Každá změna repozitáře má před první úpravou přiřazené Issue s cílem a akceptačními kritérii; průběh, skutečné výsledky ověření a předání k review se zapisují zpět do něj. Podrobný kontrakt je v [`AGENTS.md`](AGENTS.md) a Codex workflow v [`.agents/skills/track-github-work/SKILL.md`](.agents/skills/track-github-work/SKILL.md).
