# ShopSmart — plán veřejné služby pro hlídání nákupních nabídek

## 1. Shrnutí

ShopSmart má být veřejná víceuživatelská služba, ve které se uživatel přihlásí, nastaví svou lokalitu, dostupné kamenné prodejny a e-shopy, vybere sledované produkty a podmínky výhodnosti a dostává aktuální výsledky ve webovém rozhraní i v agregovaném e-mailu.

**Geografický produktový scope je pouze Česká republika.** Všechny regiony, prodejny, retailer zdroje, ceny a právní podmínky první i navazující implementace musí být české. Jiná země nesmí sloužit jako fallback při chybějícím povoleném českém zdroji; rozšíření mimo ČR vyžaduje nové explicitní produktové rozhodnutí.

Základní architektonická myšlenka:

> Nabídku stáhnout a normalizovat jednou pro daný obchod, region nebo pobočkový rozsah; personalizované porovnání pak provést levně a deterministicky pro všechny relevantní uživatele.

ShopSmart nemá být „jeden webový AI agent na každého uživatele“. Takové řešení by opakovalo stejné dotazy, bylo drahé, pomalé, obtížně auditovatelné a náchylné k halucinacím. AI má být pomocná vrstva pro nejednoznačná data, nikoli řídicí mechanismus celého produktu.

Tento dokument vychází z praktického pilotního hlídače nákupních akcí pro jedno české město. Případová studie je anonymizovaná: neobsahuje osobní e-mail, soukromou adresu ani přístupové údaje.

---

## 2. Co ukázal osobní pilot

### 2.1 „Produkt“ není pouze textový dotaz

Pilot začal jednoduchým požadavkem na konkrétní neparfémovaný toaletní papír a rozrostl se na 13 tříd:

1. neparfémovaný toaletní papír konkrétní značky;
2. odtučněný tvaroh;
3. kuřecí prsní řízky;
4. balkánský sýr;
5. mozzarella;
6. čerstvá rajčata;
7. čerstvé papriky;
8. salátové okurky;
9. banány;
10. skutečný řecký jogurt;
11. cheddar;
12. čerstvé borůvky;
13. čerstvá slepičí vejce.

Každá třída potřebovala jiné podmínky identity, výluky, jednotku a práh. Příklady:

- neparfémovaný produkt musí explicitně vyloučit parfémované varianty;
- odtučněný tvaroh není zaměnitelný za polotučný;
- „jogurt řeckého typu“ není stejný jako skutečný řecký jogurt;
- mozzarella v nálevu není strouhaná pizza mozzarella;
- čerstvé borůvky nejsou mražené ani sušené;
- vejce potřebují počet kusů, velikost, jakostní třídu a způsob chovu, pokud je zdroj uvádí; křepelčí, vařená, tekutá a cukrářská „vejce“ jsou false positives.

**Důsledek pro veřejný produkt:** potřebujeme tři oddělené entity:

- `CanonicalProductClass` — co obecně znamená sledovaná třída;
- `RetailerProduct` — konkrétní SKU/název u prodejce;
- `UserWatchRule` — které atributy, výluky a cenové podmínky chce uživatel.

### 2.2 Jednotková cena je hlavní porovnávací veličina

Cena balení sama o sobě často klame. Pilot potřeboval:

- Kč/role a pokud možno Kč/metr u papírového zboží;
- Kč/250 g a Kč/100 g u tvarohu;
- Kč/kg u masa, volné zeleniny a banánů;
- Kč/100 g u sýrů, jogurtu a baleného drobného ovoce;
- Kč/kus u okurek a vajec;
- u vajec doplňkově Kč/10 kusů;
- současně vždy zachovat původní cenu a balení.

**Pravidlo z pilotu:** nabídky stejného sledovaného produktu se ve webu a e-mailu seskupí a řadí vzestupně podle konfigurované normalizované jednotkové ceny. Cena balení je sekundární údaj a tie-breaker. Neexistuje-li společná porovnatelná jednotka, systém nesmí tiše seřadit neporovnatelné hodnoty; musí nabídky rozdělit nebo stav vysvětlit.

### 2.3 „Je to levné“ není dostatečné pravidlo

Pravidla pilotu kombinovala:

- maximální jednotkovou cenu;
- minimální doloženou procentní slevu;
- jiné limity pro preferovaný řetězec a přísnější limity pro ostatní;
- věrnostní ceny, pokud je jasně uvedena karta/aplikace;
- povinné zobrazení běžné ceny, pokud je známá.

Jedna nabídka mohla kvalifikovat cenou nebo slevou. `threshold_reason` musel přesně uvést podmínku, která skutečně prošla — nikdy volnější nebo zaokrouhlený limit.

**Veřejný model:** `UserWatchRule` musí podporovat kombinovatelné predikáty a preference, například:

```json
{
  "canonical_product_class": "fresh-eggs",
  "preferred_retailer_ids": ["retailer-a"],
  "preferred_rule": {
    "max_unit_price": {"unit": "piece", "amount": 4.0},
    "min_discount_percent": 30
  },
  "fallback_rule": {
    "max_unit_price": {"unit": "piece", "amount": 3.5},
    "min_discount_percent": 40
  },
  "accepted_memberships": ["clubcard"]
}
```

Čísla v ukázce jsou historickou demonstrací datového modelu, nikoli univerzální doporučení.

### 2.4 Identita, hodnota, dostupnost a čas jsou nezávislé osy

Kvalifikovaný match potřebuje čtyři oddělené důkazy:

1. **Identita:** přesný produkt a požadovaná varianta.
2. **Hodnota:** cena balení, balení a správná normalizace.
3. **Dosažitelnost:** relevantní pobočka nebo ověřený online kanál.
4. **Čas:** platnost nabídky a aktuálnost kontroly.

Levný produkt ve špatném městě, parfémovaná varianta, prošlá cena nebo online stránka zobrazující výchozí Prahu nejsou validní nabídkou.

### 2.5 Zdrojová hierarchie je zásadní

Prakticky se osvědčilo rozdělení:

- **primární:** oficiální produktová stránka, aktuální leták, lokální pobočka, věrnostní podmínka;
- **discovery:** Kupi.cz, AkcniCeny.cz a další agregátory;
- **cross-check:** druhý agregátor, výrobce varianty, oficiální locator poboček.

Poučení:

- agregátor je výborný na hledání kandidátů, ale může mít jinou lokalitu, starou cenu nebo nejasný typ letáku;
- výsledky vyhledávače mohou zachovat staré akce;
- obecná homepage nestačí jako důkaz konkrétní ceny;
- každý zveřejněný match potřebuje konkrétní klikací `source_url`;
- když je hlavním přímým zdrojem agregátor, je nutná oficiální nebo nezávislá sekundární verifikace;
- URL nepatří do novelty key — migrace stránky nesmí vytvořit falešně novou nabídku.

Každý normalizovaný záznam musí ukládat provenienci a čas stažení. U extrahovaného pole má být v budoucnu možné uložit i evidenční úsek nebo souřadnice v letáku.

### 2.6 Lokální pobočka není denní výzkumný úkol

Původní proces opakovaně hledal tytéž pobočky a adresy. To bylo drahé a zbytečné. Optimalizovaný pilot zavedl:

- registr fyzických poboček;
- 30denní TTL pro existenci, adresu, typ pobočky a oficiální URL;
- 14denní TTL pro obecnou online obslužnost lokality;
- předčasné obnovení pouze při rozbité URL, oficiálním signálu otevření/zavření/přesunu, rozporu, explicitním požadavku nebo jinak kvalifikovaném kandidátovi z neznámého řetězce;
- žádné každodenní obecné hledání „prodejny ve městě“.

Pilot také ukázal, že nový retail park či společně umístěná prodejna se může objevit nejprve v lokálních zprávách a až později v oficiálním locatoru. Cache proto nesmí být nekonečná; musí přijímat změnové signály a vést stav `unconfirmed`, dokud se nepotvrdí provoz a pobočková aplikovatelnost nabídky.

### 2.7 Fyzický leták a online dostupnost jsou různé věci

U kamenné nabídky typicky dokazujeme:

- místní pobočku;
- správný typ letáku;
- cenu a dobu platnosti.

To však ještě nemusí dokazovat kusovou skladovou zásobu.

U online nabídky bylo nutné získat navíc:

- `channel: online`;
- dostupnost konkrétního produktu;
- doručení, výdejní místo nebo box pro nastavenou lokalitu;
- nejbližší slot, pokud je dostupný;
- cenu dopravy nebo hranici dopravy zdarma;
- minimum objednávky;
- členství/předplatné;
- ověřenou lokalitu/PSČ;
- kontrolu, zda se cena po lokalizaci nezměnila.

**Candidate-first optimalizace:** katalog a ceny povinných e-shopů lze procházet pravidelně, ale drahou adresní interakci, sloty a košíkové podmínky řešit až poté, co kandidát nejprve splní produktový a cenový filtr. Obecnou obslužnost lze krátkodobě cachovat; stock konkrétního kandidáta ne.

### 2.8 Časová platnost a opakovaná kontrola

- Fyzickou nabídku s doloženým `valid_to` není nutné denně znovu načítat; může zůstat aktivní do konce platnosti, pokud zdroj nevydá změnový signál.
- Online cena bez data konce má stabilní `valid_from` odpovídající prvnímu pozorování a sentinel `valid_to` typu „do změny ceny nebo vyprodání“.
- U takové online ceny se pravidelně ověřuje cena a stock. Datum prvního pozorování se neposouvá každý den, jinak by vznikaly falešné novelty klíče.
- Prošlá nabídka se odstraní z aktivního indexu, ale historický snapshot a důkaz se uchová.

### 2.9 Deduplikace a bezpečné doručení

Pilot zavedl následující kontrakt:

- novelty key obsahuje prodejce/pobočku nebo kanál, normalizovaný produkt, balení, cenu, začátek/konec platnosti a členskou podmínku;
- změna ceny, balení, lokality/kanálu, platnosti nebo členství je materiální;
- změna URL sama o sobě materiální není;
- nové klíče se deduplikují před odesláním;
- jeden běh vytvoří nejvýše jeden agregovaný e-mail;
- při absenci nových klíčů se nic neposílá;
- nabídka se označí jako oznámená až po potvrzení poskytovatele;
- při chybě zůstane outbox zachovaný pro retry;
- odeslání používá idempotency key;
- další evaluace po úspěšném oznámení je tichá.

Veřejný systém musí tento princip přesunout z lokálního JSON stavu do transakční databáze. Doporučené řešení: outbox pattern, unikátní databázová omezení a idempotentní consumer.

### 2.10 E-mail nesmí být volný text modelu

Osvědčil se deterministický renderer z normalizovaných záznamů. Povinně zobrazí:

- přesný produkt a variantu;
- prodejnu/kanál a lokalitu;
- balení a cenu balení;
- srovnávací jednotkovou cenu;
- běžnou cenu/slevu, pokud jsou doložené;
- klubovou či aplikační podmínku;
- platnost;
- důvod kvalifikace;
- dostupnost/dopravu/minimum u online nabídky;
- konkrétní zdroj.

Pokud některý povinný údaj chybí, renderer odmítne zprávu před voláním poskytovatele.

### 2.11 Historické schéma prototypu odhalilo potřebu migrací

Během rozšiřování pilotu se objevily paralelní názvy polí, například `price_czk` versus `current_price_czk`, `pack_size` versus `package_size` nebo `membership_condition` versus `member_condition`. Kompatibilní renderer tuto situaci dočasně překlenul, ale veřejná služba musí mít:

- jedno verzované kanonické schéma;
- validační model;
- databázové migrace;
- ingest adaptéry převádějící každý zdroj do stejného tvaru;
- žádné ad-hoc duplikování polí v produkčním záznamu.

### 2.12 Skutečně těžká část není webový formulář

Největší rizika jsou:

- legální a technicky povolené získávání dat;
- dynamické weby, cookies a regionální ceny;
- různé typy letáků v rámci jednoho řetězce;
- anti-bot ochrany a rate limits;
- chybějící veřejná skladová dostupnost;
- rozdíly mezi cenou v letáku, produktovou stránkou a lokalizovaným košíkem;
- přesnost variant, balení a platnosti;
- udržování konektorů při změnách webu.

Proto musí být zdrojový konektor samostatná, monitorovaná komponenta s uloženým raw snapshotem, parser verzí, metrikami čerstvosti a možností karantény.

---

## 3. Navrhovaná uživatelská zkušenost

### 3.1 Onboarding

Uživatel:

1. vytvoří účet;
2. nastaví město/PSČ a volitelný dojezdový rádius;
3. vybere konkrétní fyzické pobočky a online kanály, kde je ochoten nakupovat;
4. označí používané věrnostní karty/aplikace;
5. přidá sledované produkty z katalogu nebo volným textem;
6. nastaví cenový práh, minimální slevu nebo režim „ukaž nejlepší dostupné“;
7. zvolí okamžité upozornění nebo denní/týdenní digest.

Volný text se převede na návrh strukturovaného pravidla a uživatel ho před aktivací potvrdí.

### 3.2 Dashboard

Dashboard má zobrazovat:

- skupiny podle sledovaného produktu;
- uvnitř skupiny nabídky od nejnižší normalizované ceny;
- cenu balení a balení vedle jednotkové ceny;
- označení `NOVÁ`, `STÁLE PLATNÁ`, `KONČÍ BRZY`, `ONLINE`, `KLUBOVÁ CENA`;
- přesnou pobočku nebo online lokalitu;
- platnost a čas posledního ověření;
- úroveň důkazu: oficiální, oficiální + cross-check, discovery-only/nezveřejnitelné;
- přímý odkaz na zdroj;
- možnost skrýt variantu, upravit pravidlo nebo nahlásit chybu.

### 3.3 E-mail

- nejvýše jeden agregovaný digest v daném intervalu;
- nové nabídky spustí e-mail, ale může obsahovat i stále platný kontext;
- skupiny a stejné řazení jako web;
- žádný e-mail bez novinky, pokud uživatel nezvolí periodický souhrn;
- unsubscribe a preference centrum;
- delivery/bounce stav a idempotence.

---

## 4. Architektura

```text
Oficiální API / feedy / HTML / PDF / obrázky / agregátory
                         │
                         ▼
                  Source connectors
                         │
                         ▼
          Raw snapshots + retrieval metadata
                         │
                         ▼
       Deterministic parsers ──► AI assist fallback
                         │             │
                         └──────┬──────┘
                                ▼
                 Normalization + validation
                                │
                                ▼
                 Canonical offers database
                         ┌──────┴──────┐
                         ▼             ▼
                    Web/API      Matching workers
                                       │
                                       ▼
                              Transactional outbox
                                ┌──────┴──────┐
                                ▼             ▼
                              Email       Web events
```

### 4.1 Zvolený technický základ

Rozhodnutí z 2026-08-01 je popsáno v [`docs/TECHNICAL_ARCHITECTURE.md`](docs/TECHNICAL_ARCHITECTURE.md) a sledováno v [GitHub Issue #2](https://github.com/topolar/shopsmart/issues/2):

- local-first monorepo s pozdější migrací stejných procesů na hosting;
- web: Next.js App Router, React, TypeScript a Tailwind CSS;
- jediný veřejný vstup vede přes web/BFF; autoritativní doménová pravidla žijí ve sdíleném TypeScript balíčku a neduplikují se v UI ani API glue kódu;
- API a workery: Node.js a TypeScript; Fastify pro HTTP API, Zod pro runtime validaci a TypeORM pro PostgreSQL a verzované migrace;
- databáze: PostgreSQL 18 v lokálním Docker kontejneru na loopback portu `57432`; produkčně managed PostgreSQL;
- první slice používá PostgreSQL také pro job leasing a transakční outbox; Redis/BullMQ nebo Temporal se přidá až při doložené provozní potřebě;
- raw snapshoty jsou lokálně v ignorovaném adresáři, produkčně v S3-compatible object storage;
- dočasný vzdálený přístup používá pojmenovaný Cloudflare Tunnel chráněný Access a vystavuje pouze web, nikdy databázi;
- e-mail: transakční poskytovatel s bounce, suppression a unsubscribe podporou;
- observability: strukturované redigované logy, Sentry/OpenTelemetry a freshness/error-rate metriky;
- CI: lint, typy, unit/integration testy, migrace na prázdné DB a secret/PII scan.

AgentMail posloužil jako funkční transport pro jednoho uživatele. Ve veřejné službě je vhodnější standardní transakční e-mailová infrastruktura a databázový outbox.

### 4.2 Sdílený ingest, nikoli crawler per user

Klíčové škálovací pravidlo:

```text
retailer × source scope × locality/branch class → jeden ingest
canonical offers × user rules                 → levné DB matching
```

Je-li cena celostátní, ingest je celostátní. Liší-li se podle regionu nebo typu letáku, scope je regionální. Vyžaduje-li konkrétní pobočku nebo adresu, konektor musí explicitně modelovat lokalizační scope a nesmí vydávat národní stránku za místní dostupnost.

První schválený scope je oficiální veřejná stránka `Kaufland Praha-Vypich`. Přístupový, rate-limit, retenční a fail-closed kontrakt je v [`ADR 0004`](docs/decisions/0004-first-retailer-source.md). Jde pouze o fyzickou letákovou aplikovatelnost pro konkrétní pobočku, nikoli o důkaz aktuálního skladového kusu.

Druhý schválený český source je oficiální Albert index supermarketových a hypermarketových letáků s přímo odkazovanými PDF. Sdílený fetch, poziční TypeScript extrakce, 12hodinové minimum, 72hodinová raw retention a hranice store-type aplikovatelnosti jsou v [`ADR 0005`](docs/decisions/0005-albert-leaflet-source.md). Ani tento leták není důkazem aktuálního skladového kusu.

Třetí schválený scope je pouze featured-offer sekce oficiální stránky `Globus Brno`. [`ADR 0006`](docs/decisions/0006-globus-brno-featured-offers.md) omezuje shared HTML fetch na `/brno/letaky`, zakazuje následování roboty vyloučených produktových a úplných nabídkových cest a odděluje veřejné ceny od cen `Můj Globus`. Jde opět jen o fyzickou letákovou aplikovatelnost, nikoli sklad.

---

## 5. Doménový model

Minimální tabulky/agregáty:

### Identita a uživatelé

- `users`
- `user_profiles`
- `locations`
- `user_store_access`
- `loyalty_memberships`
- `notification_preferences`

### Retail a zdroje

- `retailers`
- `stores`
- `online_service_areas`
- `source_connectors`
- `source_scopes`
- `source_snapshots`
- `connector_runs`

### Produkty a nabídky

- `canonical_product_classes`
- `product_attributes`
- `retailer_products`
- `product_aliases`
- `offers`
- `offer_prices`
- `offer_availability`
- `offer_evidence`
- `offer_history`

### Personalizace a doručení

- `watch_rules`
- `watch_rule_predicates`
- `matches`
- `notification_events`
- `notification_outbox`
- `notification_deliveries`

### Povinný kanonický offer contract

```json
{
  "retailer_product_id": "uuid",
  "source_scope_id": "uuid",
  "channel": "physical|online",
  "store_id": "uuid|null",
  "normalized_product_class_id": "uuid",
  "exact_name": "string",
  "variant_attributes": {},
  "package": {"declared": "8 rolls / 154.4 m", "count": 8, "total_metres": 154.4},
  "price": {"amount": 59.9, "currency": "CZK"},
  "unit_prices": [
    {"amount": 7.49, "unit": "roll"},
    {"amount": 0.39, "unit": "metre"}
  ],
  "regular_price": {"amount": 69.9, "currency": "CZK"},
  "discount_percent": 14,
  "membership_condition": "none",
  "valid_from": "ISO timestamp/date",
  "valid_to": "ISO timestamp/date or explicit ongoing sentinel",
  "availability": {},
  "source_url": "https://…",
  "verification_urls": ["https://…"],
  "retrieved_at": "ISO timestamp",
  "parser_version": "string",
  "evidence_level": "official|cross_checked|candidate_only",
  "status": "candidate|qualified|quarantined|expired"
}
```

`candidate_only` se uživateli nezobrazí jako potvrzená nabídka.

---

## 6. Pipeline

### 6.1 Connector run

1. Scheduler vybere due source scopes podle freshness policy.
2. Konektor stáhne zdroj s rate limitingem, ETag/Last-Modified a backoffem.
3. Uloží raw snapshot, HTTP metadata a hash obsahu.
4. Nezměněný obsah se znovu neparsuje.
5. Deterministický parser vytvoří kandidáty.
6. Pokud je dokument nestrukturovaný nebo parser selže, může vzniknout AI-assist úloha.
7. Kandidáti projdou schema, identity, unit, validity, locality a provenance validací.
8. Qualified nabídky se upsertují a změny se zapíší do historie.
9. Matcher zpracuje pouze nové nebo materiálně změněné nabídky.

### 6.2 Matching

Matcher je deterministický:

1. vybere uživatele, jejichž dostupné obchody/region odpovídají scope;
2. porovná canonical class a atributy;
3. aplikuje exclusions;
4. vybere správnou jednotkovou cenu;
5. aplikuje preferovaný/fallback cenový a slevový práh;
6. zkontroluje membership a channel;
7. vytvoří match s přesným důvodem;
8. deduplikuje novelty key;
9. zapíše notification event do outboxu.

### 6.3 Online candidate gate

Drahá lokalizace a stock check se spouštějí pouze pro kandidáta, který už prošel identitou a cenovým filtrem. Bez aktuálních kandidat-specifických podmínek se match nepublikuje.

Implementovaný generický kontrakt tuto hranici dělí na `prequalifyOnlineCandidate` a `confirmOnlineCandidate`. Service-area podpora má samostatný TypeORM TTL cache záznam s hrubou lokalitou; produktový stock se do statického cache neukládá. Potvrzení selže uzavřeně při jiném service area/fulfilment, neaktuální nebo budoucí kontrole, chybějícím stocku, nekompatibilní měně košíkových podmínek či nedostatečné evidenci. Live napojení zůstává závislé na schváleném zdroji #5/#8.

### 6.4 Notifikace

- renderer pracuje pouze s validovanými match záznamy;
- seskupí podle watch rule/canonical product;
- řadí podle konfigurované unit ceny;
- odešle přes provider s idempotency key;
- provider API acceptance uloží provider ID, ale novelty zůstává pending;
- teprve ověřené provider delivery potvrzení v jedné transakci uloží stav a označí novelty jako notified;
- failure zachová outbox pro retry;
- dead-letter stav je viditelný operátorovi.

---

## 7. AI versus deterministický software

### Bez AI

Běžný kód musí řešit:

- autentizaci, autorizaci, tenant isolation a GDPR lifecycle;
- scheduling a HTTP fetch;
- caching a TTL;
- stabilní API/HTML/JSON-LD parsery;
- převody jednotek a cenové výpočty;
- validity a expiraci;
- matching, sorting, grouping a threshold rules;
- membership podmínky;
- locality a geospatial filtry;
- novelty key, deduplikaci a historii;
- webové API a dashboard;
- e-mailový renderer, outbox, idempotenci, retry a unsubscribe;
- audit, observability, billing a rate limits.

### Vhodné použití AI

AI může pomoci s:

- převodem volného uživatelského textu na návrh watch rule;
- extrakcí z obrázkových/PDF letáků, pokud deterministický parser nestačí;
- mapováním rozdílných názvů retailer SKU na canonical product;
- klasifikací nejednoznačných atributů;
- detekcí konfliktu mezi zdroji a prioritizací lidského review;
- volitelným vysvětlením z již validovaných faktů.

### Bezpečnostní hranice AI

- Výstup AI je `candidate`, nikdy automaticky `qualified`.
- Každý údaj musí projít schema a deterministic validation.
- Cena, jednotkový výpočet, datum a delivery state nejsou autoritou AI.
- Ukládá se model, verze promptu, confidence, evidence spans a review state.
- Schválené stabilní mapování se cachuje; AI se nevolá znovu pro každý uživatelův match.
- Nejasný výsledek se karantenizuje nebo potlačí.

První MVP může fungovat bez generativní AI, pokud začne strukturovaným katalogem produktů a omezenými zdroji.

---

## 8. Bezpečnost, soukromí a compliance

- veřejný repozitář nesmí obsahovat produkční osobní údaje;
- minimalizovat přesné adresy: pro většinu fyzických nabídek stačí město/PSČ a vybrané veřejné pobočky;
- pokud online zdroj vyžaduje přesnou adresu, oddělit ji jako šifrovaný secret/PII a neposílat ji do logů ani AI bez právního důvodu;
- neukládat retailer hesla v MVP; nezačínat zdroji vyžadujícími obcházení loginu;
- respektovat ToS, robots, autorská práva k letákům, rate limits a deletion requests;
- source snapshot retention musí mít definovanou právní a provozní politiku;
- transakční e-mail musí podporovat consent, unsubscribe, bounce a suppression;
- všechny administrátorské zásahy a AI review jsou auditované.

---

## 9. MVP roadmapa

Implementace je rozdělená do sledovatelných GitHub Issues:

| Rozsah plánu | Issue |
|---|---|
| Technický TypeScript/PostgreSQL vertical slice | [#3](https://github.com/topolar/shopsmart/issues/3) |
| První region a povolený retailer zdroj | [#5](https://github.com/topolar/shopsmart/issues/5) |
| Kanonické product/offer/evidence kontrakty | [#6](https://github.com/topolar/shopsmart/issues/6) |
| Deterministický matching a tenant isolation | [#7](https://github.com/topolar/shopsmart/issues/7) |
| Shared ingestion a snapshot pipeline | [#8](https://github.com/topolar/shopsmart/issues/8) |
| Onboarding, lokalita, obchody a loyalty | [#9](https://github.com/topolar/shopsmart/issues/9) |
| Evidence-backed dashboard | [#10](https://github.com/topolar/shopsmart/issues/10) |
| Transakční outbox a e-mailové doručení | [#11](https://github.com/topolar/shopsmart/issues/11) |
| Robustní scheduling, freshness a connector health | [#12](https://github.com/topolar/shopsmart/issues/12) |
| Online service area a product stock | [#13](https://github.com/topolar/shopsmart/issues/13) |
| Ohraničený AI assist s review | [#14](https://github.com/topolar/shopsmart/issues/14) |
| Produkční připravenost a veřejná beta | [#15](https://github.com/topolar/shopsmart/issues/15) |
| Sdílený ingest českých Albert letáků | [#38](https://github.com/topolar/shopsmart/issues/38) |
| Sdílený matching fan-out worker | [#41](https://github.com/topolar/shopsmart/issues/41) |
| Přihlášené založení watch rule z českého katalogu | [#43](https://github.com/topolar/shopsmart/issues/43) |
| Agregované plánování matchů do notification outboxu | [#45](https://github.com/topolar/shopsmart/issues/45) |
| Globus Brno featured-offer ingestion | [#47](https://github.com/topolar/shopsmart/issues/47) |
| Sdílený connector runtime, health a repair workflow | [#51](https://github.com/topolar/shopsmart/issues/51) |

Implementované kontrakty v1 pro canonical products, retailer products, offers, evidence, tenant-owned watch rules, onboarding, dashboard, notifikace, connector operations a online stock validation jsou definované Zod schématy v `packages/contracts`; publikační, matching, grouping, sorting, TTL, early-refresh, backoff a candidate-first online pravidla zůstávají v deterministické doméně a TypeORM entity slouží pouze jako persistence mapping. Databázově validované Better Auth sessions chrání onboarding i offers API. Dashboard zobrazuje pouze znovu validované published records, odděluje nekompatibilní jednotky a rozlišuje letákovou aplikovatelnost od ověřeného online stocku. PostgreSQL connector jobs používají `FOR UPDATE SKIP LOCKED`, explicitní coverage manifesty a auditované retry/rate-limit/quarantine/dead-letter stavy. Kaufland a Globus Brno scope mají TypeScript HTML fetch/parser; Albert scope sdíleně obsluhuje oficiální supermarket/hypermarket index a přímo odkazované PDF pomocí TypeScript `unpdf` a poziční geometrie. Všechny tři konektory používají hash a HTTP-validator deduplikaci, 72hodinový raw snapshot store, deterministickou karanténu, transakční TypeORM persistence, lokální run-once command a immutable review mapování. Globus navíc nikdy nenásleduje roboty zakázané produktové cesty a cenu `Můj Globus` nesmí vydat za veřejnou. Fyzická letáková aplikovatelnost výslovně netvrdí skladovou dostupnost. Aktuální stav realizace a ověření je autoritativně vedený v odkazovaných Issues.

Connector platforma z issue #51 definuje přísný verzovaný manifest pro české scope, capabilities, parser a provozní policy a společný runtime pro registraci/lease, retention, coverage, hashově ověřený reprocess, health a auditovaný repair. Retailer adaptery nadále vlastní pouze source-specific discovery, fetch, parser a persistence překlad; společný runtime není univerzální parser. Jednotné `pnpm connector` příkazy obsluhují Albert, Globus a Kaufland bez tenant vstupu a conformance kontrakt brání duplicitním scope či nekonzistentní orchestraci.

Shared matching fan-out z issue #41 načítá published offers jednou za běh a watch rules omezuje databázovým filtrem na přítomné canonical product classes. Finální atributové, cenové, membership, locality, validity a unit rozhodnutí vždy provádí společný deterministický `matchOffer`. TypeORM zápis používá stabilní novelty a idempotentní konflikt handling, takže souběžné běhy nevytvoří duplicity ani nepřenesou výsledek mezi tenanty. Lokální `pnpm match:run-once` vypisuje pouze agregované provozní počty a rejection reasons; neprovádí source fetch ani nevytváří syntetické tenanty.

Authenticated watch-rule flow z issue #43 zpřístupňuje canonical katalog a veřejné store volby, ale pravidlo smí uložit pouze pro prodejny a membership programy potvrzené v onboardingu aktivního tenantu. Jednotka a canonical required/excluded atributy jsou server-authoritative; klient zadává strukturovaný produkt, maximální cenu v CZK a povolené scope volby. Český webový formulář nemá přímou cestu k source fetchi a po uložení vysvětluje oddělený shared matching běh.

Digest planner z issue #45 načítá pouze dosud nezařazené persisted matches pro tenanty s povoleným českým digestem, připojí published offer fakta a předá je existujícímu fail-closed rendereru a transakčnímu outboxu. Chybějící, nevalidní nebo nejednoznačný recipient a poškozená evidence se pouze započítají stabilním reason code; adresa ani payload se neobjeví v CLI výstupu. `pnpm digest:plan-once --interval <stable-key>` nevolá e-mailový provider a opakované vyhodnocení nemění notification novelty stav.

### Fáze 0 — rozhodnutí a contracts

- potvrdit stack a licenci;
- definovat canonical schemas a evidence levels;
- první český oficiální source scope byl vybrán v [`ADR 0004`](docs/decisions/0004-first-retailer-source.md), Albert letákové třídy v [`ADR 0005`](docs/decisions/0005-albert-leaflet-source.md) a Globus Brno featured nabídky v [`ADR 0006`](docs/decisions/0006-globus-brno-featured-offers.md); každý další retailer vyžaduje vlastní source review;
- threat model a PII klasifikace;
- fixture policy;
- CI skeleton vytvořit až s první testovanou vertical slice.

### Fáze 1 — jeden end-to-end vertical slice

- registrace/přihlášení;
- jedno město/region;
- několik veřejných fyzických letákových zdrojů;
- omezený katalog canonical products;
- výběr poboček a členství;
- jedna watch rule;
- ingest → normalization → match → dashboard → e-mail;
- source URL, freshness, grouping a unit sorting;
- bez generativní AI.

### Fáze 2 — robustní ingest a provoz

- více retailer connectors;
- snapshoty, parser versioning, quarantine;
- TTL registry poboček;
- změnové signály a connector health;
- outbox/retry/dead letter;
- admin UI pro konflikty a ruční opravy;
- load test shared matching.

### Fáze 3 — online dostupnost

- service-area model;
- candidate-first address/locality checks;
- stock, pickup/delivery slot, fee a minimum basket;
- jasné označení „flyer applicability“ versus „stock verified“;
- žádné uložené retailer účty v první iteraci.

### Fáze 4 — AI assist

- natural-language watch rule draft;
- PDF/image extraction fallback;
- product alias/entity-resolution queue;
- review UI, confidence a evidence spans;
- nákladové limity a cache schválených výstupů.

Implementovaný základ této fáze obsahuje verzované TypeScript/Zod kontrakty pro
product mapping a flyer extraction, provider-neutral runner s tvrdými limity,
syntetickou eval sadu, deterministickou karanténu, TypeORM auditní persistence a
operátorské review API/UI. Živý provider ani automatická publikace nejsou
součástí základu; jejich zapnutí vyžaduje samostatně schválenou provider issue.

### Fáze 5 — škálování a veřejná beta

- více regionů a lokalizací;
- uživatelské reporty chyb;
- GDPR export/delete;
- email reputation monitoring;
- connector SLO a incident runbooks;
- případné mobilní/push notifikace;
- teprve poté affiliate/revenue model s transparentním označením.

---

## 10. Testovací strategie

Minimální maintained suite:

1. normalizace kg, 100 g, 250 g, kus, role a metr;
2. odmítnutí chybějícího pack/count;
3. must-match a exclusion atributy;
4. parfemovaná versus neparfémovaná varianta;
5. skutečný řecký versus „řeckého typu“;
6. vejce: velikost/třída/chov a false positives;
7. preferred versus fallback threshold;
8. klubová cena a změna membership novelty;
9. lokální pobočka versus výchozí jiná lokalita;
10. online required fields a fail-closed;
11. aggregator bez sekundárního důkazu;
12. URL-only změna bez novelty;
13. materiální změna ceny/pack/validity s novelty;
14. seskupení a vzestupné unit-price řazení;
15. successful delivery commit;
16. failed delivery preserved outbox;
17. druhý běh po úspěchu je tichý;
18. tenant isolation;
19. cache TTL a early-refresh trigger;
20. secret/PII scan fixtures a logů.

Každý nový connector má contract fixtures z povolených snapshotů a integrační test parseru. Live smoke test je oddělen od deterministic unit suite.

---

## 11. Observability a provozní metriky

Sledovat minimálně:

- poslední úspěšný fetch každého source scope;
- HTTP/error/rate-limit stav;
- hash změny a počet extrahovaných kandidátů;
- qualified/quarantined/rejected počty s reason codes;
- parser drift a chybějící povinná pole;
- stáří aktivní nabídky;
- match fan-out;
- outbox depth a delivery success/failure;
- AI token/cost pouze u AI-assist queue;
- uživatelské reporty nesprávných nabídek.

„Job doběhl OK“ není důkaz kompletního výzkumu. Run má explicitní coverage manifest a stav každého povinného zdroje.

---

## 12. Otevřená rozhodnutí

Před implementací je potřeba rozhodnout:

- právní/licenční režim repozitáře;
- které další zdroje po Kaufland, Albert a Globus Brno scope splní source review;
- konkrétní generátor OpenAPI z TypeScript kontraktů;
- okamžik a konkrétní queue technologie po vyhodnocení PostgreSQL job leasingu;
- produkční konfigurace vybraného Resend adapteru, domény a webhooku (výběr viz [`ADR 0003`](docs/decisions/0003-transactional-email-provider.md));
- přesná definice „nejlepší nabídky“ pro pravidlo bez uživatelského prahu;
- jak před veřejným doručováním přesně přiřadit Albert store-type letáky ke konkrétním pobočkám;
- kdo a jak schvaluje AI product mappings;
- obecná retention raw snapshotů pro další konektory; Kaufland, Albert i Globus Brno mají 72hodinovou politiku v [`ADR 0004`](docs/decisions/0004-first-retailer-source.md), [`ADR 0005`](docs/decisions/0005-albert-leaflet-source.md) a [`ADR 0006`](docs/decisions/0006-globus-brno-featured-offers.md);
- obchodní model bez ovlivnění nestranného řazení.

---

## 13. Definice úspěšného MVP

MVP je hotové pouze tehdy, když reálný povolený zdroj projde celou cestou:

1. fetch a raw snapshot;
2. deterministic parsing;
3. canonical normalization;
4. evidence a locality validation;
5. matching jednoho skutečného watch rule;
6. webová skupina se správným unit-price pořadím;
7. agregovaný e-mail;
8. provider-confirmed delivery a idempotentní stav;
9. tichá následná evaluace bez změny;
10. zdroj, freshness a důvod rozhodnutí viditelný uživateli.

Pouhé UI demo, seznam úkolů nebo AI shrnutí bez živé datové a doručovací cesty není funkční MVP.
