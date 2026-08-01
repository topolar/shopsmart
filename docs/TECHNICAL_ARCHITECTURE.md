# ShopSmart — návrh technického řešení

Stav: přijatý výchozí směr pro první implementaci
Datum: 2026-08-01
Sledování práce: [GitHub Issue #2](https://github.com/topolar/shopsmart/issues/2)

## 1. Rozhodnutí

ShopSmart začne jako local-first monorepo na vývojářském počítači. PostgreSQL poběží v samostatném Docker kontejneru, zatímco web, API a workery mohou při vývoji běžet přímo na hostiteli kvůli rychlému hot reloadu. Pozdější vzdálený přístup povede přes Cloudflare Tunnel pouze na webový vstup. Produkční nasazení přesune stejné oddělené procesy do kontejnerů nebo spravovaných služeb bez změny doménových kontraktů.

Zvolený stack používá TypeScript end-to-end:

- workspace a package manager: pnpm workspace s jediným lockfilem;
- web: Next.js App Router, React, TypeScript a Tailwind CSS;
- API: Node.js, TypeScript a Fastify;
- kontrakty a runtime validace: TypeScript a Zod, na HTTP hranici publikované také jako JSON Schema/OpenAPI;
- deterministická doména, konektory a workery: čistý TypeScript;
- persistence: PostgreSQL 18, TypeORM s PostgreSQL driverem `pg` a verzované TypeORM migrace;
- lokální orchestrace infrastruktury: Docker Compose;
- testy: Vitest pro doménu, API, workery a webové jednotky, Testing Library pro komponenty a Playwright pro kritické end-to-end scénáře;
- pozdější privátní vzdálený vstup: pojmenovaný Cloudflare Tunnel chráněný Cloudflare Access;
- produkční vstup: reverzní proxy nebo ingress před webovou aplikací.

Next.js App Router je aktuální doporučená větev Next.js a výchozí generátor již podporuje TypeScript, Tailwind a ESLint. Tailwind má pro Next.js vlastní oficiální integrační cestu. pnpm podporuje monorepo workspace a explicitní `workspace:` závislosti. Viz [Next.js App Router](https://nextjs.org/docs/app), [instalace Next.js](https://nextjs.org/docs/app/getting-started/installation), [Tailwind framework guides](https://tailwindcss.com/docs/installation/framework-guides) a [pnpm workspaces](https://pnpm.io/workspaces).

## 2. Proč oddělené TypeScript procesy

Jeden Next.js proces by zjednodušil první spuštění, ale svázal by HTTP lifecycle webu s dlouho běžícími konektory, plánováním, matchingem a doručováním outboxu. Všechny části proto používají stejný jazyk a sdílené balíčky, ale běží jako samostatné procesy, které lze nezávisle restartovat a škálovat.

Zvolená hranice je:

- Next.js vlastní vykreslení, lokalizaci, formuláře a bezpečný webový vstup;
- Fastify vlastní autentizované API, autorizaci, tenant isolation a aplikační use cases;
- `packages/domain` vlastní ceny, jednotky, identity, locality gates, validity, novelty a delivery state;
- `packages/contracts` vlastní vstupní a výstupní schémata sdílená webem a API;
- workery používají stejný doménový balíček jako API;
- OpenAPI je publikovaný integrační kontrakt; ručně psané paralelní typy jsou zakázané.

Next.js Route Handlers nebo rewrites mohou sloužit jako tenká BFF/proxy vrstva. Nesmí obsahovat paralelní implementaci doménových pravidel.

## 3. Logické komponenty

```text
Browser
  │
  │ HTTPS (později Cloudflare Tunnel + Access)
  ▼
Next.js web / BFF :3310
  │ private HTTP
  ▼
Fastify API :8310
  ├── canonical domain services
  ├── authorization and tenant isolation
  └── PostgreSQL transactions
          │
          ▼
PostgreSQL container
127.0.0.1:57432 -> 5432
          ▲
          │
TypeScript workers
  ├── ingestion and deterministic parsing
  ├── matching and fan-out
  └── notification outbox delivery
```

Navržené první adresáře vzniknou až s první testovanou vertical slice:

```text
apps/
  web/                 # Next.js, TypeScript, Tailwind
  api/                 # Fastify HTTP and application services
workers/
  ingestion/
  matching/
  notifications/
packages/
  contracts/           # Zod, JSON Schema and OpenAPI contracts
  domain/              # TypeScript canonical schemas and deterministic rules
  database/            # TypeORM data source, entities, repositories and transaction helpers
  connectors/          # TypeScript source adapters
  ai_assist/           # optional candidate-only boundary
migrations/            # reviewed TypeORM migrations
tests/
docs/
```

Nevytvářet tyto adresáře prázdné. Každý musí přijít s funkčním kódem a testem.

## 4. Lokální porty a názvy

Kontrola naslouchajících portů a Docker mapování dne 2026-08-01 ukázala, že PostgreSQL porty `55432` a `56432` již používají jiné projekty. Pro ShopSmart jsou vyhrazeny:

| Služba | Hostitel | Interní port | Poznámka |
|---|---:|---:|---|
| Next.js web | `127.0.0.1:3310` | `3310` | jediný budoucí tunnel origin |
| Fastify API | `127.0.0.1:8310` | `8310` | lokálně dostupné jen z hostitele |
| PostgreSQL | `127.0.0.1:57432` | `5432` | Docker publish pouze na loopback |

Názvy lokálních Docker prostředků:

- Compose project: `shopsmart`;
- container: `shopsmart-postgres`;
- database: `shopsmart`;
- application role: `shopsmart_app`;
- named volume: `shopsmart_pgdata`.

Port je konfigurovatelný přes `SHOPSMART_POSTGRES_PORT`, ale `.env.example` má používat výchozí `57432`. Před prvním `docker compose up` musí bootstrap Issue znovu ověřit, že port zůstal volný. Kolize se řeší změnou lokální proměnné, nikoli změnou interního portu `5432`.

## 5. PostgreSQL v Dockeru

První implementace má použít podporovaný PostgreSQL 18. Aktuální minor řady je při tomto rozhodnutí 18.4; minor aktualizace mají probíhat řízeně a produkční image se později připne také digestem. PostgreSQL doporučuje provozovat aktuální minor dané podporované major verze. Viz [PostgreSQL versioning policy](https://www.postgresql.org/support/versioning/).

Budoucí `compose.yaml` má dodržet tento kontrakt:

- publish `127.0.0.1:${SHOPSMART_POSTGRES_PORT:-57432}:5432`, nikdy `0.0.0.0`;
- použít named volume, ne adresář uvnitř repozitáře;
- pro PostgreSQL 18 mountovat volume podle aktuálního kontraktu official image na `/var/lib/postgresql`;
- přidat `pg_isready` healthcheck;
- heslo načíst z ignorovaného lokálního prostředí nebo Docker secretu, nikdy je necommitovat;
- použít oddělenou aplikační roli bez superuser oprávnění;
- nastavit TypeORM `synchronize: false` a schéma měnit výhradně verzovanými a reviewovanými migracemi; automatickou synchronizaci nepoužívat v žádném trvalém prostředí;
- nevydávat init skripty za migrace, protože se spouštějí jen nad prázdným datovým adresářem.

Oficiální image popisuje změnu datového adresáře od PostgreSQL 18 i omezení init skriptů; viz [Docker Official Image: postgres](https://hub.docker.com/_/postgres). Docker Compose poskytuje service discovery uvnitř projektové sítě, takže po pozdějším přesunu aplikací do kontejnerů se mají připojovat přes jméno služby a interní port, ne přes host port; viz [Docker Compose networking](https://docs.docker.com/compose/how-tos/networking/).

Lokální připojení z hostitele bude mít tvar:

```text
postgresql://shopsmart_app:<local-secret>@127.0.0.1:57432/shopsmart
```

Hodnota patří do ignorovaného `.env`; `.env.example` smí obsahovat jen placeholder. Zálohou není samotný Docker volume. Jakmile vzniknou nenahraditelná vývojová data, přidat ověřený `pg_dump`/restore postup.

## 6. API, doména a workery

Fastify vystaví verzované `/api/v1` a OpenAPI schéma. Sdílená Zod schémata validují data na každé nedůvěryhodné hranici; Fastify route schemas musí omezit i serializované odpovědi, aby se omylem nevydala citlivá pole. Fastify doporučuje schema-based validaci a serializaci; viz [Fastify validation and serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/). Zod je TypeScript-first validační knihovna; viz [Zod](https://zod.dev/).

TypeORM poskytne PostgreSQL DataSource, entity, repositories, QueryBuilder a verzované migrace. Entity jsou pouze persistence modely; nesmí se stát kanonickou doménou ani obsahovat autoritativní výpočty, matching nebo notification state machine. `synchronize` zůstává vypnuté a každou ručně vytvořenou nebo generovanou migraci je nutné reviewovat jako běžný kód. Migrace se aplikují explicitním release krokem, nikoli automaticky při startu každé aplikační repliky. Viz [TypeORM PostgreSQL driver](https://typeorm.io/docs/drivers/postgres/), [migration setup](https://typeorm.io/docs/migrations/setup/) a [executing migrations](https://typeorm.io/docs/migrations/executing/).

Autentizaci zajišťuje Better Auth s databázově validovanými sessions; konkrétní bezpečnostní kontrakt, privacy hranice a produkční gate popisuje [ADR 0002](decisions/0002-authentication-and-sessions.md).

Každá transakční aplikační operace musí používat pouze `transactionalEntityManager` předaný TypeORM callbackem; použití globálního manageru uvnitř transakce je zakázané. Pro PostgreSQL job leasing lze použít QueryBuilder s `pessimistic_write` a `skip_locked`. Viz [TypeORM transactions](https://typeorm.io/docs/transactions/) a [QueryBuilder locking](https://typeorm.io/docs/query-builder/select-query-builder/).

První lokální slice nepřidá Redis ani obecnou task queue. PostgreSQL bude dočasně držet:

- due connector jobs a leasing záznamy;
- notification outbox;
- idempotency a novelty klíče;
- auditovatelný stav běhu.

Workery budou bezpečně claimovat práci transakčně přes TypeORM QueryBuilder nebo parametrizované SQL a musí zvládnout opakované doručení bez duplicit. Redis/BullMQ nebo Temporal se přidá teprve při doložené potřebě vyšší propustnosti, delších workflow, časovačů nebo horizontálního škálování. Stav nabídky a potvrzené doručení zůstávají v PostgreSQL i po zavedení fronty.

Connector scheduler používá jednu unikátní job řádku pro každý shared source scope a claimuje due práci přes PostgreSQL `FOR UPDATE SKIP LOCKED`. Stavový automat eviduje lease, rate-limit okno, deterministický backoff, dead letter, parser drift/quarantine, poslední úspěch, content hash a kompletnost coverage manifestu. Statický kontext má TTL; dynamická fakta se vždy revalidují a broken URL, rozpor, official change, neznámý retailer nebo explicitní požadavek vytvářejí auditovaný early-refresh trigger.

Obecná online obslužnost používá stejnou `static_context_cache`, ale pod namespacovaným klíčem `service-area:<uuid>` a s validovaným hrubým kontextem město/kraj/PSČ prefix. Neobsahuje produktový stock ani přesnou adresu. Produktová dostupnost se ověřuje až pro kandidáta, který prošel stejnými identity, atributovými, locality, membership a cenovými predikáty jako publikovaný match. Výsledek je publikovatelný jen při aktuálním `in-stock` důkazu pro shodné service area a delivery/pickup způsob; nese čas kontroly, fulfilment detail, volitelný poplatek, minimum košíku, okno a samostatnou HTTP(S) evidenční URL. Výchozí maximální stáří stock kontroly je 15 minut. Konkrétní live adaptér a jeho frekvence patří ke schválenému zdroji v Issues #5/#8.

Transakční notification outbox odděluje provider acceptance od potvrzeného doručení. Novelty event se označí jako notified pouze transakcí vyvolanou ověřeným delivery webhookem; přijatý send request čeká ve stavu `awaiting-confirmation`. Prvním plánovaným produkčním adapterem je Resend, podrobnosti a srovnání jsou v [ADR 0003](decisions/0003-transactional-email-provider.md).

Raw snapshoty mohou být lokálně v ignorovaném datovém adresáři s metadaty v databázi. Před produkcí se přesunou do S3-compatible object storage s retention policy.

## 7. Web a lokalizace

Web použije Next.js App Router, TypeScript strict mode, Tailwind CSS a přístupné komponenty. Czech bude první referenční locale, ale texty nesmí být natvrdo rozptýlené v komponentách; použít message catalog a stabilní lokalizační klíče.

Doporučené hranice:

- Server Components pro načítání a vykreslení přehledů;
- Client Components jen tam, kde je nutná interakce v prohlížeči;
- formuláře posílají data přes stejný origin na BFF/API;
- web nepočítá autoritativní jednotkové ceny ani matching;
- API odpovědi vždy nesou source URL, evidence level a verification timestamp tam, kde je UI zobrazuje.

Evidence dashboard používá stejný-origin BFF route a private API odvozuje tenant výhradně z databázově validované session. TypeORM read model načítá jen `published` offer records, každý match/offer pár znovu prožene fail-closed kontraktem a teprve potom ho seskupí a seřadí deterministickou doménovou funkcí. Candidate-only nebo nekonzistentní data se do odpovědi ani UI nedostanou.

Dashboard explicitně odlišuje fyzickou letákovou aplikovatelnost bez tvrzení o skladové zásobě od online dostupnosti konkrétního produktu. U online nabídky zobrazuje čas stock ověření a dostupné košíkové podmínky; obecný service-area cache záznam se uživateli nikdy nevydává za produktovou dostupnost.

Pro produkční self-hosting Next.js doporučuje reverzní proxy před serverem. Ta bude součástí hostingové fáze nebo ji poskytne cílová platforma; viz [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting).

## 8. Cloudflare Tunnel

Cloudflare Tunnel je pouze přístupová vrstva, ne cílový hosting a ne náhrada aplikační autorizace.

### Dočasný osobní přístup

1. Next.js naslouchá na `127.0.0.1:3310`.
2. `cloudflared` vytváří outbound-only spojení a směruje hostname pouze na `http://127.0.0.1:3310`.
3. Cloudflare Access omezí vstup na explicitně povolenou identitu.
4. Fastify API `8310` a PostgreSQL `57432` nejsou tunnel ingress a zůstávají na loopbacku.
5. Aplikační autentizace, tenant isolation, CSRF ochrana, secure cookies, trusted hosts a rate limits zůstávají povinné.

Cloudflare uvádí, že Tunnel používá outbound-only spojení bez veřejně routovatelné IP. Quick Tunnels jsou však jen pro testování; pro opakovaný přístup použít pojmenovaný spravovaný tunnel. Viz [Cloudflare connectivity options](https://developers.cloudflare.com/cloudflare-one/networks/connectivity-options/) a [Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/).

Dokud aplikace neprojde minimálně autentizací, tenant isolation, secret scanem a bezpečnostním review, tunnel nemá být přístupný obecné veřejnosti a nesmí obsahovat reálná osobní data.

## 9. Cesta k produkčnímu hostingu

Migrace nemá znamenat přepis aplikace. Má změnit způsob běhu a spravované závislosti:

1. vytvořit samostatné OCI images pro `web`, `api` a jednotlivé worker role;
2. přesunout PostgreSQL do managed služby se šifrováním, automatickými zálohami a point-in-time recovery;
3. přesunout raw snapshoty do objektového úložiště;
4. provozovat migrace jako explicitní jednorázový release krok;
5. přidat spravovaný secret store, centrální logy, metriky, tracing a alerting;
6. umístit reverzní proxy/load balancer před web a ponechat API/workery v privátní síti;
7. oddělit staging a production databáze, identity, secrets a buckets;
8. škálovat web, API a workery nezávisle podle měřených potřeb;
9. zavést queue technologii pouze tehdy, když PostgreSQL job leasing přestane vyhovovat;
10. provést restore test, migration test a end-to-end test provider-confirmed delivery před veřejnou betou.

Konkrétní hostingový provider zůstává otevřený. Výběr musí podporovat dlouho běžící workery a schedulery; čistě request-only/serverless platforma sama o sobě celý ShopSmart nepokryje.

## 10. Bezpečnostní hranice

- Veřejný je pouze webový origin; API, databáze, workery a admin rozhraní jsou privátní.
- Cloudflare Access je další obranná vrstva, nikoli autorita pro tenant data.
- Cookies musí být `Secure`, `HttpOnly` a s vhodným `SameSite`; důvěryhodné proxy hlavičky přijímat jen od známého ingressu.
- CORS není náhrada autorizace; preferovat same-origin browser flow.
- Logy musí být strukturované a redigovat PII, cookies, tokeny, adresy a request bodies s citlivými daty.
- Vývojové fixtures jsou syntetické. Žádné produkční snapshoty nebo uživatelské exporty do GitHubu.
- Retailer zdroje se načítají pouze v souladu s ToS, robots a rate limits; tunnel nesmí sloužit k obcházení přístupových kontrol.

## 11. Ověřovací strategie první slice

První implementační Issue má dodat jeden vertikální průchod a tyto důkazy:

- Vitest unit testy doménové normalizace a fail-closed validace;
- API test tenant isolation a autorizace;
- aplikace všech TypeORM migrací nad prázdnou databází a kontrolovaný revert/restore test;
- connector contract test nad syntetickým nebo povoleným fixture;
- transakční test outbox success/failure/idempotency;
- web component test a jeden Playwright happy path;
- secret/PII scan fixtures a logů;
- `docker compose config`, healthcheck a ověřené připojení přes `127.0.0.1:57432`;
- potvrzení, že `8310` a `57432` nejsou vystaveny tunelem.

## 12. Odložená rozhodnutí

Samostatná Issues jsou potřeba pro:

- produkční konfigurace Resend sender domény, webhooku a datového regionu;
- první legálně dostupné retailer zdroje a region;
- Node.js runtime policy a řízené aktualizace jediného `pnpm-lock.yaml`;
- přesná cesta generování OpenAPI z kontraktů;
- produkční hosting a region;
- okamžik a volbu queue technologie;
- retention raw snapshotů;
- cílové SLO, backup a disaster-recovery parametry.
