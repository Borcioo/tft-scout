# Database Schema Redesign — TFT Generator

## Problem

Obecny schemat ma kilka problemów:
1. Style breakpointów to magiczne inty bez lookup table, z błędnym mapowaniem w komentarzach
2. Miss Fortune (Choose Trait) i Mecha Enhanced nie istnieją jako warianty w DB — generowane w runtime
3. MetaTFT dane w wielu osobnych tabelach, importowane batch'em zamiast cache'owane organicznie
4. Brak danych kontekstowych (jakie traity pasują do jakich unitów) — graf nie uczy się z rzeczywistych gier
5. Exclusion rules hardcoded w JS zamiast w danych
6. Breakpointy bez explicit pozycji — muszą być sortowane po minUnits

## Podejście

**Flat champions** — warianty (MF Conduit, Urgot Enhanced) jako osobne rekordy w `champions`.

**Hook system** — CDragon import + post-import hooki per set w osobnym pliku. Specjalne reguły izolowane od logiki importu.

**Transparent cache** — zamiast batch importu MetaTFT, cache layer który zapisuje odpowiedzi API przy pierwszym użyciu. Baza rośnie organicznie z użyciem.

**Self-learning graph** — agregowane tabele (`unit_trait_affinity`) budowane z cache'owanych odpowiedzi Explorer API. Graf zyskuje "ukryte krawędzie" między championami, którzy nie dzielą traitów ale dobrze współgrają w praktyce.

---

## Schema

### 1. Core — CDragon (definicje)

```sql
-- Lookup table stylów breakpointów
CREATE TABLE trait_styles (
  id INTEGER PRIMARY KEY,              -- 1, 3, 4, 5, 6 (wartości z CDragon)
  name TEXT NOT NULL UNIQUE,            -- 'Bronze', 'Silver', 'Unique', 'Gold', 'Prismatic'
  fallbackScore REAL NOT NULL DEFAULT 0 -- scoring fallback gdy brak MetaTFT danych
);
-- Seed data:
-- (1, 'Bronze',    0.22)
-- (3, 'Silver',    0.44)
-- (4, 'Unique',    0.67)
-- (5, 'Gold',      1.20)
-- (6, 'Prismatic', 1.50)

-- Traity
CREATE TABLE traits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  apiName TEXT UNIQUE NOT NULL,         -- TFT17_Mecha
  name TEXT NOT NULL,                   -- Mecha
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '',
  isUnique INTEGER NOT NULL DEFAULT 0   -- 1 = single-champion trait (Bulwark, etc.)
);

-- Breakpointy traitów
CREATE TABLE trait_breakpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  traitId INTEGER NOT NULL REFERENCES traits(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,            -- 1-based, mapuje na MetaTFT suffix _1/_2/_3
  minUnits INTEGER NOT NULL,
  maxUnits INTEGER NOT NULL,
  styleId INTEGER NOT NULL REFERENCES trait_styles(id),
  effects TEXT NOT NULL DEFAULT '{}',   -- JSON z efektami
  UNIQUE(traitId, position)
);

-- Championowie (flat — warianty jako osobne rekordy)
CREATE TABLE champions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  apiName TEXT UNIQUE NOT NULL,         -- TFT17_MissFortune_Conduit
  baseApiName TEXT,                     -- TFT17_MissFortune (null = nie jest wariantem)
  name TEXT NOT NULL,                   -- Miss Fortune (Conduit)
  variant TEXT,                         -- 'conduit' / 'enhanced' / null
  cost INTEGER NOT NULL,
  slotsUsed INTEGER NOT NULL DEFAULT 1, -- Mecha Enhanced = 2
  role TEXT,
  -- staty bojowe
  hp REAL NOT NULL,
  armor REAL NOT NULL,
  magicResist REAL NOT NULL,
  attackDamage REAL NOT NULL,
  attackSpeed REAL NOT NULL,
  mana REAL NOT NULL,
  startMana REAL NOT NULL,
  range REAL NOT NULL,
  critChance REAL NOT NULL,
  critMultiplier REAL NOT NULL,
  -- meta
  icon TEXT NOT NULL DEFAULT '',
  plannerCode INTEGER,
  abilityDesc TEXT,
  abilityStats TEXT                     -- JSON array
);

-- Champion <-> Trait (M:N)
CREATE TABLE champion_traits (
  championId INTEGER NOT NULL REFERENCES champions(id) ON DELETE CASCADE,
  traitId INTEGER NOT NULL REFERENCES traits(id) ON DELETE CASCADE,
  PRIMARY KEY (championId, traitId)
);

-- Grupy wykluczające — max 1 champion z grupy w teamie
CREATE TABLE exclusion_groups (
  groupName TEXT NOT NULL,              -- 'miss_fortune', 'urgot'
  championApiName TEXT NOT NULL,
  PRIMARY KEY (groupName, championApiName)
);

-- Itemy
CREATE TABLE items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  apiName TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  component1 TEXT,
  component2 TEXT,
  effects TEXT NOT NULL DEFAULT '{}',
  tags TEXT NOT NULL DEFAULT '[]',
  isEmblem INTEGER NOT NULL DEFAULT 0,
  traitId INTEGER REFERENCES traits(id) ON DELETE SET NULL,
  icon TEXT NOT NULL DEFAULT ''
);
```

### 2. MetaTFT Cache Layer

```sql
-- Surowy cache odpowiedzi MetaTFT API
CREATE TABLE metatft_cache (
  endpoint TEXT NOT NULL,               -- 'units', 'traits', 'explorer/traits', 'unit_detail_overall'
  paramsHash TEXT NOT NULL,             -- SHA256 z posortowanych parametrów
  params TEXT NOT NULL,                 -- oryginalne parametry jako JSON (debug/UI)
  data TEXT NOT NULL,                   -- surowa odpowiedź JSON
  fetchedAt TEXT NOT NULL DEFAULT (datetime('now')),
  ttlSeconds INTEGER NOT NULL DEFAULT 3600,
  PRIMARY KEY (endpoint, paramsHash)
);

CREATE INDEX idx_metatft_cache_freshness ON metatft_cache(endpoint, fetchedAt);
```

### 3. Agregowane statystyki (auto-aktualizowane z cache)

```sql
-- Rating unitów — aktualizowane gdy cache 'units' się odświeży
CREATE TABLE unit_ratings (
  apiName TEXT PRIMARY KEY,
  avgPlace REAL NOT NULL,
  winRate REAL NOT NULL,
  top4Rate REAL NOT NULL,
  games INTEGER NOT NULL,
  score REAL NOT NULL,                  -- computed: max(0, min(1, (6-avgPlace)/3))
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Rating traitów per breakpoint
CREATE TABLE trait_ratings (
  traitApiName TEXT NOT NULL,
  breakpointPosition INTEGER NOT NULL,  -- 1-based, mapuje na MetaTFT _1/_2/_3
  avgPlace REAL NOT NULL,
  winRate REAL NOT NULL,
  top4Rate REAL NOT NULL,
  games INTEGER NOT NULL,
  score REAL NOT NULL,
  updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (traitApiName, breakpointPosition)
);

-- Trait affinity per unit — "z jakimi traitami ten champion wygrywa"
-- Rośnie organicznie z explorer queries
CREATE TABLE unit_trait_affinity (
  unitApiName TEXT NOT NULL,            -- TFT17_AurelionSol
  traitApiName TEXT NOT NULL,           -- TFT17_Mecha
  breakpointPosition INTEGER NOT NULL,  -- 3 (konsystentne z trait_ratings)
  avgPlace REAL NOT NULL,
  games INTEGER NOT NULL,
  frequency REAL NOT NULL,              -- % gier z tym unitem które mają ten trait
  updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (unitApiName, traitApiName, breakpointPosition)
);

-- Najlepsze itemy per champion — "co budować na tym champie"
-- Rośnie organicznie z unit_detail_items queries
CREATE TABLE unit_item_builds (
  unitApiName TEXT NOT NULL,            -- TFT17_AurelionSol
  itemApiName TEXT NOT NULL,            -- TFT_Item_HextechGunblade
  avgPlace REAL NOT NULL,
  games INTEGER NOT NULL,
  frequency REAL NOT NULL,              -- jak często ten item jest budowany
  updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (unitApiName, itemApiName)
);

-- Meta compy
CREATE TABLE meta_comps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clusterId TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  units TEXT NOT NULL,                  -- JSON array
  traits TEXT NOT NULL,                 -- JSON array
  avgPlace REAL NOT NULL,
  games INTEGER NOT NULL,
  levelling TEXT,
  builds TEXT,                          -- JSON array
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 4. Inne (bez zmian)

```sql
CREATE TABLE saved_teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fingerprint TEXT UNIQUE NOT NULL,
  data TEXT NOT NULL,
  note TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## Usunięte tabele

| Tabela | Powód |
|--------|-------|
| `tier_list` | Redundant — tier = pochodna z `unit_ratings.score` |
| `metatft_trait_ratings` | Zastąpiona przez `trait_ratings` |
| `metatft_unit_ratings` | Zastąpiona przez `unit_ratings` |
| `metatft_meta_comps` | Zastąpiona przez `meta_comps` |

---

## Import Architecture

### CDragon Import Flow

```
1. Fetch CDragon JSON
2. Seed trait_styles (jeśli nie istnieją)
3. Import traits → traits + trait_breakpoints
4. Import champions → champions + champion_traits
5. Import items → items
6. Run post-import hooks (set-hooks.js)
   → MF warianty, Mecha Enhanced, exclusion groups
```

### Post-Import Hooks (`server/src/set-hooks.js`)

Osobny plik per set z regułami specjalnymi. Każdy hook to funkcja z helpers API:

```js
export const SET_HOOKS = {
  "17": [
    missFortune,     // 3 warianty z Choose Trait, usuwa oryginał
    mechaEnhanced,   // enhanced wariant dla każdego Mecha champa
    augmentOnly,     // Zed = augment-only flag
  ],
};
```

**Helpers API** dostępne w hookach:
- `getChampion(apiName)` — pobierz championa z DB
- `getChampionsWithTrait(traitApiName)` — wszyscy z danym traitem
- `addVariant(baseChamp, overrides)` — dodaj wariant (kopiuje staty, nadpisuje co trzeba)
- `removeChampion(apiName)` — usuń (np. oryginalną MF z Choose Trait)
- `addExclusionGroup(name, apiNames[])` — dodaj grupę wykluczającą
- `getTrait(apiName)` — pobierz trait z DB

### MetaTFT Cache Layer (`server/src/metatft-cache.js`)

Transparent cache — single entry point dla wszystkich MetaTFT API calls:

```js
// Użycie:
const data = await metatft.fetch('units', { queue: 'PBE', patch: 'current' });
// 1. Sprawdza metatft_cache — jest i nie wygasło? → zwróć
// 2. Nie ma lub stale → fetch z MetaTFT API → zapisz w cache → zwróć
// 3. Po zapisie → trigger aggregation (np. przelicz unit_ratings)
```

**TTL per endpoint:**
| Endpoint | TTL | Aggregation target |
|----------|-----|-------------------|
| `units` | 30min | `unit_ratings` |
| `traits` | 1h | `trait_ratings` |
| `explorer/traits?unit=X` | 6h | `unit_trait_affinity` |
| `comps` | 2h | `meta_comps` |
| `unit_detail_*` | 6h | cache only |

**Background refresh:** opcjonalny cron/interval który odświeża najstarsze dane w tle, bez blokowania użytkownika.

---

## Scout jako zautomatyzowany gracz

### Filozofia

Scout robi to co gracz robi ręcznie na MetaTFT — filtruje, porównuje, analizuje. Gracz normalnie:

1. Wchodzi na MetaTFT Explorer, wpisuje swoje unity
2. Sprawdza tab Traits — "z czym to działa?"
3. Sprawdza tab Items — "co budować?"
4. Sprawdza tab Comps — "jakie kompy z tym wygrywają?"
5. Porównuje warianty — "MF Conduit czy Challenger tu lepiej pasuje?"

Scout ma te same dane w DB i robi to automatycznie w milisekundach.

### Scout decision flow (nowy)

```
Input: locked champions + constraints
    │
    ├─ 1. TRAIT DISCOVERY
    │     Dla każdego locked champ → unit_trait_affinity
    │     → "z jakimi traitami ten champ wygrywa"
    │     → rozszerz search space grafu o te traity
    │
    ├─ 2. CANDIDATE SELECTION (graf + affinity)
    │     Shared traits (jak teraz)
    │     + affinity-based candidates (nowe ukryte krawędzie)
    │     + unit_ratings score per candidate
    │
    ├─ 3. TEAM GENERATION
    │     Jak teraz — iteracyjny beam search z scoringiem
    │     Ale scoring uwzględnia:
    │       - trait_ratings per breakpoint (jak teraz)
    │       - unit_ratings per champion (jak teraz)
    │       - affinity bonus: "ten champ + ten trait = potwierdzone w danych"
    │
    ├─ 4. VARIANT SELECTION
    │     MF w kompie? → sprawdź który wariant (Conduit/Challenger/Replicator)
    │       daje najlepszy trait synergy w kontekście tego teamu
    │     Mecha champ? → enhanced czy normal? sprawdź slot budget
    │
    └─ 5. BUILD SUGGESTIONS (future)
          Dla carry champów → unit_item_builds
          → "na tym champie ludzie budują IE + Shojin, avg 3.8"
```

### Dane które scout konsumuje

| Tabela | Scout używa do | Kiedy się wypełnia |
|--------|----------------|--------------------|
| `unit_ratings` | base champion score | pierwszy fetch `units` |
| `trait_ratings` | breakpoint scoring | pierwszy fetch `traits` |
| `unit_trait_affinity` | rozszerzenie search space | gdy user lockuje champa → fetch explorer/traits |
| `unit_item_builds` | item suggestions | gdy user pyta o buildy → fetch unit_detail_items |
| `exclusion_groups` | filtrowanie wariantów | CDragon import + hooks |
| `meta_comps` | walidacja/porównanie | fetch comps |

### Przykład end-to-end

1. User lockuje **Kindred + Aurelion Sol**
2. Scout sprawdza `unit_trait_affinity` dla obu:
   - Kindred: N.O.V.A._2 (3.9), Challenger_1 (4.3), Sniper_1 (4.1)
   - ASol: Mecha_3 (3.7), Conduit_2 (3.6), Dark Star_1 (4.0)
   - Brak danych? → fetch w tle, użyj shared traits jako fallback
3. Graf rozszerza search: oprócz Challenger/N.O.V.A./Conduit/Mecha szuka też w Sniper, Dark Star
4. Generuje 3 compy:
   - Mecha 6 + N.O.V.A. 5 (ASol enhanced + Galio + Kindred + Aatrox + Urgot + Maokai)
   - Conduit 4 + N.O.V.A. 5 + Dark Star 2 (mieszany)
   - N.O.V.A. 5 + Sniper 2 + Mecha 3 (lekki splash)
5. Każdy comp ma score oparty na realnych danych, nie tylko na overlap traitów

---

## Design decisions & edge cases

### Tier list → continuous score

Obecny scorer używa discrete tiers (S/A/B/C/D) z `tier_list` tabeli. Nowy schemat
nie ma `tier_list` — tier jest **wyliczany** z `unit_ratings.score`:

```js
function scoreTier(score) {
  if (score >= 0.75) return 'S';  // avgPlace ≤ 3.75
  if (score >= 0.63) return 'A';  // avgPlace ≤ 4.10
  if (score >= 0.53) return 'B';  // avgPlace ≤ 4.40
  if (score >= 0.43) return 'C';  // avgPlace ≤ 4.70
  return 'D';
}
```

Pliki do aktualizacji: `engine.js` (tierMap build), `generator.js` (precomp), `synergy-graph.js`,
`routes/tierlist.js` (czytelny endpoint), `import-tierlist.js` (usunąć).

### Variant scoring fallback

MetaTFT nigdy nie zwróci danych dla `TFT17_Urgot_enhanced`. Lookup w `unit_ratings`
musi fallback do `baseApiName`:

```js
function getUnitScore(champion) {
  const apiName = champion.baseApiName || champion.apiName;
  return unitRatings[apiName] || null;
}
```

To samo podejście co obecny `champion.originalApiName || champion.apiName` w scorer.js:54.

### Exclusion groups enforcement

`candidates.js` egzekwuje exclusion groups przy generowaniu kandydatów:

```js
// Po pobraniu kandydatów z DB:
const exclusions = db.prepare('SELECT * FROM exclusion_groups').all();
const groupMap = {};  // groupName → Set of apiNames
for (const e of exclusions) {
  (groupMap[e.groupName] ??= new Set()).add(e.championApiName);
}

// Locked champions already chosen → exclude other variants from same group
for (const [group, members] of Object.entries(groupMap)) {
  const lockedFromGroup = lockedChampions.filter(c => members.has(c));
  if (lockedFromGroup.length > 0) {
    // Remove all other members from candidates
    for (const m of members) {
      if (!lockedFromGroup.includes(m)) excludedSet.add(m);
    }
  }
}
```

Engine.js **nie musi** wiedzieć o exclusion groups — candidates.js już filtruje.

### Stargazer trait aliasing

MetaTFT zwraca `TFT17_Stargazer_Wolf_1`, `TFT17_Stargazer_Serpent_1` etc.
CDragon ma wiele trait entries z tą samą nazwą "Stargazer".

Aliasing pozostaje w cache aggregation layer (nie w engine):

```js
// W metatft-cache.js przy aggregacji trait_ratings:
function normalizeTraitApiName(apiName) {
  // Stargazer variants → base Stargazer for scoring
  if (apiName.startsWith('TFT17_Stargazer_')) return 'TFT17_Stargazer';
  return apiName;
}
```

Engine/scorer widzi tylko `TFT17_Stargazer` — warianty konstelacji to ten sam trait mechanicznie.

### Breakpoint position source

CDragon JSON `trait.effects` jest tablicą w kolejności breakpointów.
`position` = index w tablicy + 1. Importer robi:

```js
for (let i = 0; i < trait.effects.length; i++) {
  const bp = trait.effects[i];
  insertBreakpoint.run({ traitId, position: i + 1, minUnits: bp.minUnits, ... });
}
```

### Precomp tables

`createPrecompTables(db)` nadal wywoływane z nowego `db.js` — te tabele nie zmieniają się.

### Cache stale-while-revalidate

Gdy TTL wygaśnie:
1. Zwróć stare dane natychmiast
2. Odśwież w tle (async, nie blokuje response'a)
3. Mutex per endpoint+params — zapobiega thundering herd

```js
const refreshLocks = new Map();  // endpoint+hash → Promise
```

Gdy MetaTFT API jest niedostępne — stare dane są serwowane bez limitu czasowego.
Cache nigdy nie jest usuwany automatycznie, tylko nadpisywany.

---

## Architecture — separation of layers

Kod ma być modularny — algorytm (scout/scoring) nie wie skąd przychodzą dane ani kto je konsumuje.
Cel: w przyszłości podmienić API, front, lub źródło danych bez dotykania core logiki.

### Warstwy

```
┌─────────────────────────────────────────────────┐
│  TRANSPORT (wymienialny)                        │
│  Express routes, CLI, WebSocket, cokolwiek      │
│  Tłumaczy HTTP/CLI → wywołanie serwisu          │
└──────────────────────┬──────────────────────────┘
                       │ wywołuje
┌──────────────────────▼──────────────────────────┐
│  SERVICES (orkiestracja)                        │
│  scout-service.js, data-service.js              │
│  Łączy algorytm z danymi, nie wie o HTTP        │
│  Input/output: plain JS objects                 │
└──────┬───────────────────────────┬──────────────┘
       │ czyta dane                │ generuje compy
┌──────▼──────────┐      ┌────────▼──────────────┐
│  DATA LAYER     │      │  ALGORITHM (core)      │
│  (wymienialny)  │      │  (przenośny)           │
│                 │      │                        │
│  db.js          │      │  scoring/scorer.js     │
│  metatft-cache  │      │  scoring/engine.js     │
│  importer.js    │      │  scoring/candidates.js │
│  set-hooks.js   │      │  synergy-graph.js      │
│                 │      │                        │
│  Zwraca plain   │      │  Przyjmuje plain       │
│  JS objects     │      │  JS objects            │
│  (nie SQL rows) │      │  (nie wie o DB)        │
└─────────────────┘      └────────────────────────┘
```

### Zasady

**Algorithm layer (scoring/, synergy-graph):**
- Zero importów z DB, zero SQL, zero fetch
- Przyjmuje dane jako argumenty: `generateTeam(champions, traits, breakpoints, ratings, constraints)`
- Zwraca plain objects: `{ champions: [...], traits: [...], score: 42 }`
- Można go wyciągnąć do osobnego pakietu/repo bez zmian

**Data layer (db, importer, cache):**
- Jedyne miejsce które wie o SQLite i MetaTFT API
- Eksponuje dane przez functions zwracające plain objects, nie raw SQL rows
- Np. `getChampionsWithTraits()` zwraca `[{ apiName, name, cost, traits: [...] }]`, nie `{ traitApiNames: "X,Y" }`

**Service layer:**
- Łączy dane z algorytmem: pobiera z data layer, przekazuje do algorithm, zwraca wynik
- Jedyne miejsce gdzie jest "business logic" orkiestracji (np. "jeśli brak affinity → fetch → retry")
- Transport layer (routes) tylko wywołuje service i serializuje response

**Transport layer (routes):**
- Tłumaczy HTTP request → service call → HTTP response
- Zero logiki biznesowej, zero bezpośredniego dostępu do DB

### Co to zmienia w praktyce

| Scenariusz | Co podmieniasz | Core algorithm |
|------------|---------------|----------------|
| Inny front (np. Discord bot) | Nowy transport layer | Bez zmian |
| Inny data source (Riot API zamiast MetaTFT) | Nowy data provider w data layer | Bez zmian |
| Algorytm jako npm package | Wyciągnij scoring/ + synergy-graph | Bez zmian |
| Inna baza (Postgres, JSON files) | Nowa implementacja data layer | Bez zmian |

### Kontrakty między warstwami (mappers)

Każda warstwa mówi swoim "językiem". Między nimi siedzą **mappery** — proste funkcje
które tłumaczą format danych. Cała logika konwersji w jednym miejscu.

```
DB row (SQL)  →  mapper  →  Domain object (plain JS)  →  Algorithm  →  Result object  →  mapper  →  API response
```

**`server/src/mappers/champion.mapper.js`** — tłumaczy DB ↔ Domain:

```js
// DB row → obiekt który algorytm rozumie
export function fromDb(row) {
  return {
    apiName: row.apiName,
    baseApiName: row.baseApiName || null,
    name: row.name,
    variant: row.variant || null,
    cost: row.cost,
    slotsUsed: row.slotsUsed,
    role: row.role,
    traits: row.traitApiNames ? row.traitApiNames.split(',') : [],
    stats: { hp: row.hp, armor: row.armor, attackDamage: row.attackDamage, /* ... */ },
  };
}

// Domain object → API response (co widzi frontend)
export function toApi(champ) {
  return {
    apiName: champ.apiName,
    name: champ.name,
    cost: champ.cost,
    traits: champ.traits,
    role: champ.role,
    variant: champ.variant,
  };
}
```

**`server/src/mappers/trait.mapper.js`**:

```js
export function fromDb(row, breakpointRows) {
  return {
    apiName: row.apiName,
    name: row.name,
    isUnique: row.isUnique === 1,
    breakpoints: breakpointRows.map(bp => ({
      position: bp.position,
      minUnits: bp.minUnits,
      maxUnits: bp.maxUnits,
      style: bp.styleName,        // 'Bronze', 'Gold' — nie surowy int
    })),
  };
}
```

**`server/src/mappers/ratings.mapper.js`**:

```js
// MetaTFT API response → domain rating
export function unitRatingFromApi(entry) {
  const stats = placesToStats(entry.places);
  if (!stats) return null;
  return {
    apiName: entry.unit,
    avgPlace: stats.avgPlace,
    winRate: stats.winRate,
    top4Rate: stats.top4Rate,
    games: stats.games,
    score: computeScore(stats.avgPlace),
  };
}

// DB row → domain rating (identyczny format co z API — algorytm nie widzi różnicy)
export function unitRatingFromDb(row) {
  return {
    apiName: row.apiName,
    avgPlace: row.avgPlace,
    winRate: row.winRate,
    top4Rate: row.top4Rate,
    games: row.games,
    score: row.score,
  };
}
```

**`server/src/mappers/scout-result.mapper.js`**:

```js
// Algorithm output → API response
export function toApi(result) {
  return {
    champions: result.champions.map(c => ({
      apiName: c.apiName,
      name: c.name,
      cost: c.cost,
      traits: c.traits,
      variant: c.variant,
      slotsUsed: c.slotsUsed,
    })),
    traits: result.activeTraits.map(t => ({
      apiName: t.apiName,
      name: t.name,
      count: t.count,
      style: t.activeStyle,      // 'Gold', 'Prismatic'
    })),
    score: result.score,
    level: result.level,
  };
}
```

**Zasada:** algorytm nigdy nie importuje mappera — to service layer mapuje dane
przed przekazaniem do algorytmu i po odebraniu wyniku.

```js
// scout-service.js
import { fromDb as mapChampion } from '../mappers/champion.mapper.js';
import { toApi as mapResult } from '../mappers/scout-result.mapper.js';

export function generateTeam(db, constraints) {
  // Data layer → domain objects
  const champions = getAllChampions(db).map(mapChampion);
  const traits = getAllTraits(db);
  const ratings = getRatings(db);

  // Algorithm (pure, no DB)
  const result = engine.generate(champions, traits, ratings, constraints);

  // Domain → API format
  return mapResult(result);
}
```

### Obecny stan vs cel

Teraz kod miesza warstwy — `engine.js` robi `db.prepare(SQL)`, route handlery mają logikę biznesową. Migracja to okazja żeby to rozdzielić. Nie refaktorujemy wszystkiego naraz — ale nowy kod (cache layer, hooks, service) piszemy od razu w czystej architekturze, a istniejący kod migrujemy stopniowo.

---

## Migration plan

1. Nowy `db.js` z nowym schematem + `createPrecompTables()` + seed `trait_styles`
2. Nowy `importer.js` z hook system (`set-hooks.js`)
3. Nowy `metatft-cache.js` jako replacement dla `import-metatft.js`
4. Update `candidates.js` — warianty z DB, exclusion groups enforcement
5. Update `scorer.js` — `fallbackScore` z `trait_styles`, variant fallback via `baseApiName`
6. Update `engine.js` — tierMap z `unit_ratings.score` zamiast `tier_list`
7. Update `precomp/generator.js` — tierMap z `unit_ratings`, trait ratings z `trait_ratings`
8. Update `precomp/synergy-graph.js` — tierMap z `unit_ratings`
9. Usuń: `import-tierlist.js`, `routes/tierlist.js` (lub refactor na endpoint read-only)
10. Update `set-rules.js` — uproszczony, Mecha slot count z DB (`slotsUsed`), Redeemer zostaje

---

## Nie zmienia się

- Algorytm scoringu (wagi, formuły — poza tier→score migration)
- Precomp tables (`precomp_teams`, `precomp_champ_index`)
- Frontend components (ChampionPicker, TraitPicker)
- API routes structure (GET /api/champions, etc.)
- saved_teams
