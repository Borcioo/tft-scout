# Plan schematu bazy — TFT Scout (Laravel 13 + PostgreSQL 18)

**Status:** ✅ FINAL — wszystkie decyzje podjęte, gotowe do implementacji
**Źródło danych:** audyt `D:\Projekty\tft-generator\server\tft.db` (Set 17, ~3500 rekordów łącznie)
**Cel:** czyste, znormalizowane fundamenty pod migrację z Node/SQLite na Laravel/Postgres

---

## Spis treści

1. [Stan obecny — audyt danych](#1-stan-obecny--audyt-danych)
2. [Zidentyfikowane problemy](#2-zidentyfikowane-problemy)
3. [Proponowany schemat docelowy](#3-proponowany-schemat-docelowy)
4. [Mapa migracji pól](#4-mapa-migracji-pól-stare--nowe)
5. [Rzeczy do wywalenia](#5-rzeczy-do-wywalenia)
6. [Decyzje wymagające Twojego wkładu](#6-decyzje-wymagające-twojego-wkładu)

---

## 1. Stan obecny — audyt danych

### Liczności tabel (Set 17)

| Tabela                | Rekordów | Uwagi                                      |
| --------------------- | -------- | ------------------------------------------ |
| `champions`           | 68       | 56 base + 12 wariantów                     |
| `champion_traits`     | 144      | pivot M:N                                  |
| `traits`              | 44       | z czego 12 `isUnique`                      |
| `trait_breakpoints`   | 106      | ~2.4 na trait                              |
| `trait_styles`        | 5        | seed (Bronze/Silver/Gold/Prismatic/Unique) |
| `items`               | **3538** | **z czego tylko ~227 to faktyczne itemy**  |
| `exclusion_groups`    | 9        | dla 4 championów z wariantami              |
| `metatft_cache`       | 217      | raw API responses                          |
| `unit_ratings`        | 63       | 1 osierocony (MissFortune)                 |
| `trait_ratings`       | 89       | (trait, position) z MetaTFT                |
| `unit_trait_affinity` | 3035     | champion × trait × breakpoint              |
| `unit_item_builds`    | 2042     | champion × singleItem                      |
| `unit_item_sets`      | 2516     | champion × (item1, item2, item3)           |
| `unit_companions`     | 2891     | champion × companion champion              |
| `meta_comps`          | 41       | metowe composy z MetaTFT                   |
| `saved_teams`         | 0        | pusty (user używał localStorage)           |

### Rozkład `items` po prefixach apiName

| Prefix                   | Liczba   | Co to                                                                           |
| ------------------------ | -------- | ------------------------------------------------------------------------------- |
| `TFT_Item_*`             | 183      | **Bazowe itemy TFT** (cross-set, evergreen) — Bloodthirster, Infinity Edge etc. |
| `TFT17_Item_*`           | 44       | **Set-specific itemy** (Set 17)                                                 |
| `TFT17_*` (bez `_Item_`) | 357      | Mechaniki Setu 17 (prawdopodobnie trait effects, carousel items, hex effects)   |
| **`OTHER`**              | **2954** | **HISTORICAL CRUFT** — augmenty i itemy z setów 6, 10, 11, 12... + 783 emblemów |

**~84% zawartości tej tabeli to śmieci historyczne z poprzednich setów.**

---

## 2. Zidentyfikowane problemy

### 🔴 Problem #1 — `items` miesza 5 różnych typów encji

Obecnie jedna tabela zawiera:

- Craftable itemy (2-component combiny jak Bloodthirster)
- Set-specific itemy (np. Radiant items z Set 17)
- **Augmenty** (Silver/Gold/Prismatic) — ze wszystkich historycznych setów
- **Emblemy** (Trait emblemy)
- **Consumables** (Item Remover, Reroller)
- **Mechaniki setu** (carousel items, hex effects, trait effects)

To są **5 odrębnych koncepcji** z różnymi atrybutami i znaczeniem.

**Dowód:** `TFT10_Augment_BigGains`, `TFT6_Merc_X_Fish`, `TFT17_CarouselMarket_EmpoweredHexTrait` — wszystkie w jednej tabeli obok `TFT_Item_Bloodthirster`.

### 🔴 Problem #2 — Tagi itemów są w 80% zhashowanymi kluczami

```json
"tags": ["{ce1fd21c}", "{b72bd3bf}", "{d12ae4b6}", "AttackDamage"]
```

Z ~130 distinct tagów, **tylko 9 jest czytelnych**:
`AbilityPower, AttackDamage, AttackSpeed, Consumable, CritChance, Heal, Health, Mana, component`

Pozostałe ~121 to hash translation keys z CDragona (format `{hex}`) — nie niosą informacji użytkowej.

### 🔴 Problem #3 — `effects` w trait_breakpoints i items to raw JSON TEXT

```sql
-- trait_breakpoints.effects
{"DamageInstances": 10, "HealthThreshold": 0.4, "{fefec6fb}": 1}
```

Nie query-owalne, niekontrolowane klucze, czasem mieszane z hash keys. W Postgresie → `JSONB` z zachowaniem struktury + możliwością query-owania operatorami `@>`, `?`, `#>`.

### 🔴 Problem #4 — Role championów to enum-like string bez kontraktu

12 unikalnych wartości: `ADFighter, APCaster, ADCarry, APTank, ADSpecialist, APReaper, ADCaster, ADTank, ADReaper, APCarry, APFighter, HFighter`.

Format: `[AD|AP|H]<RoleType>`. Mieszają dwie osi: **damage type** (AD/AP/Hybrid) + **role category** (Fighter, Caster, Carry, Tank, Specialist, Reaper).

### 🔴 Problem #5 — `champions.variant` (TEXT) + `baseApiName` + `exclusion_groups` — trzy mechanizmy robiące to samo

- `champions.baseApiName` → nullable FK-like (stringowy) na bazową wersję championa
- `champions.variant` → etykieta wariantu (`'conduit'`, `'challenger'`, `'enhanced'`)
- `exclusion_groups(groupName, championApiName)` → oddzielna tabela

Wszystkie trzy kodują tę samą informację: **„ci champions są alternatywnymi formami tego samego bytu i wykluczają się na planszy"**.

### 🔴 Problem #6 — `abilityStats` jako JSON TEXT z tablicami 7 wartości

```json
[
    { "name": "HealHP", "value": [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1] },
    { "name": "DamageAD", "value": [200, 80, 120, 180, 300, 600, 600] }
]
```

Array ma **7 pozycji** — star levels 1-5 + 2 dodatkowe (prawdopodobnie chibi/enhanced/augment-modified warianty). Nieudokumentowane. Zerowe query-owanie.

### 🔴 Problem #7 — `meta_comps.units_string` i `traits_string` jako comma-joined TEXT

W oryginale MetaTFT: `"TFT17_Mecha, TFT17_AurelionSol, TFT17_Rammus"` — splitowane regexem. Parsowane do JSON arrays przy zapisie do bazy, ale wewnątrz JSON-a jako TEXT. Postgres ma natywny `text[]` — lepszy.

### 🔴 Problem #8 — `traits` miesza 3 różne koncepty

Gdy patrzę na `meta_comps.traits`:

```
["TFT17_Astronaut_1", "TFT17_FlexTrait_1", "TFT17_HPTank_1", "TFT17_ManaTrait_1",
 "TFT17_Mecha_1", "TFT17_MorganaUniqueTrait_1", "TFT17_ResistTank_1",
 "TFT17_ShenUniqueTrait_1", "TFT17_TahmKenchUniqueTrait_1"]
```

Widzę **trzy kategorie traitów**:

1. **Public traits** (widoczne w UI) — `Astronaut, Mecha, DarkStar, Stargazer...`
2. **Unique traits** (widoczne ale indywidualne) — `ShenUniqueTrait, MorganaUniqueTrait`, `TahmKenchUniqueTrait` — 12 takich
3. **Hidden categorical traits** (używane przez MetaTFT/algorytmy do grupowania) — `HPTank, ResistTank, ManaTrait, FlexTrait`

Obecny schemat traktuje wszystkie jednakowo — kolumna `isUnique` rozróżnia kategorię 2 od reszty, ale kategoria 3 (hidden) nie jest oznaczona.

### 🔴 Problem #9 — Osierocone ratings: MissFortune

`unit_ratings` ma wpis dla `TFT17_MissFortune` który **nie istnieje w `champions`** (tam są tylko warianty `_conduit`, `_challenger`, `_replicator`). MetaTFT agreguje ratings na poziomie base championa.

**Implikacja**: w nowym schemacie base champion (Miss Fortune) musi istnieć jako wiersz — nawet jeśli gracz go nigdy nie wystawi — żeby ratings miały FK integrity.

### 🔴 Problem #10 — `champion_traits` jako pivot M:N dla 44 traitów × 68 championów

Postgres `text[]` na kolumnie `champions.trait_api_names` + GIN index byłby mniejszy, szybszy i prostszy w query (`WHERE 'TFT17_Vanguard' = ANY(trait_api_names)`). Eloquent potrzebuje tylko castu na `array`.

### 🔴 Problem #11 — `items.component1, component2` jako raw strings bez FK

Recipe itemów (`component1 = 'TFT_Item_BFSword'`) zapisane jako text apiName, brak FK. Przy zmianie nazwy itemu — rozspójnienie.

### 🔴 Problem #12 — Brak audytu importów

Po każdym imporcie CDragona **nie wiesz**: kiedy był, ile rekordów zostało dotkniętych, z jakiej wersji CDragona, czy się udał. Debugowanie "dlaczego ten champion ma takie statystyki" — niemożliwe bez loga.

---

## 3. Proponowany schemat docelowy

### Część A: CDragon data (immutable per set)

#### Tabela `sets`

```
id                bigint PK
number            smallint UNIQUE       -- 17, 18, etc.
name              varchar(100)           -- "Into the Arcane"
mutator           varchar(50)            -- CDragon "mutator" field
is_active         boolean DEFAULT false  -- tylko jeden może być true
released_at       date
retired_at        date NULL
imported_at       timestamptz NULL       -- ostatni udany import
cdragon_version   varchar(50) NULL       -- z meta.json CDragona
```

**Uzasadnienie**: jawna tabela setów otwiera drogę do multi-set w przyszłości bez refaktoru. Na teraz tylko Set 17 jest `is_active=true`.

#### Tabela `champions`

```
id                    bigint PK
set_id                bigint FK → sets.id ON DELETE CASCADE
api_name              varchar(100) UNIQUE           -- "TFT17_Aatrox"
name                  varchar(100)                   -- "Aatrox"
cost                  smallint                       -- 1-5 (rzadziej 6-10 dla specjalnych)
slots_used            smallint DEFAULT 1             -- 1 dla wszystkich oprócz Mecha Enhanced (2)
role                  varchar(30)                    -- "ADFighter" (jako enum-string)
damage_type           char(2)                        -- "AD" | "AP" | "H" (wyciągnięte z role)
role_category         varchar(20)                    -- "Fighter" | "Caster" | "Carry" | "Tank" | "Specialist" | "Reaper"

-- Grywalność (Decyzja #3a)
is_playable           boolean DEFAULT true           -- false tylko dla base MissFortune (gracz wybiera wariant)

-- Stats (kolumny — query-owane)
hp                    real
armor                 real
magic_resist          real
attack_damage         real
attack_speed          real
mana                  real
start_mana            real
range                 real
crit_chance           real DEFAULT 0.25
crit_multiplier       real DEFAULT 1.4

-- Ability (zachowane ale lepiej typowane)
ability_desc          text                            -- raw HTML/template z CDragon
ability_stats         jsonb                           -- strukturalne: [{name, values: [...]}]

-- Variants (self-FK zamiast exclusion_groups)
base_champion_id      bigint NULL FK → champions.id  -- Miss Fortune wariant → Miss Fortune base
variant_label         varchar(50) NULL               -- "challenger", "conduit", "enhanced"

-- External
planner_code          integer NULL                   -- numer do Team Planner
icon_path             varchar(500)                   -- ASSETS/... z CDragon

-- Meta
created_at, updated_at (standard Laravel timestamps)

INDEXES:
  UNIQUE (set_id, api_name)
  INDEX (cost)
  INDEX (base_champion_id)
  INDEX (is_playable)                                -- dla filtrów listujących championów w planerze
```

**Uzasadnienie**:

- `damage_type + role_category` zastępuje pojedynczy `role` — możesz filtrować „wszyscy AD Carry" bez string matchingu
- `base_champion_id` self-FK — eliminuje `exclusion_groups` i `baseApiName`
- `is_playable` flag — rozwiązuje problem Miss Fortune (base MF zostaje w tabeli dla FK ratings, ale frontend nie pokazuje go do wyboru)
- `ability_stats jsonb` — query-owalne („pokaż championów gdzie HealAP[2] > 300")
- Stats jako kolumny — query-owalne, mogą iść do indeksu (np. „sorted by attack_damage desc")
- **Traity nie są kolumną** — są w pivot tabeli `champion_trait` (Decyzja #4 → A)

#### Tabela `champion_trait` (pivot M:N)

```
champion_id       bigint FK → champions.id ON DELETE CASCADE
trait_id          bigint FK → traits.id ON DELETE CASCADE

PRIMARY KEY (champion_id, trait_id)
INDEX (trait_id)                                      -- reverse lookup: „kto ma ten trait"
```

**Uzasadnienie (Decyzja #4 → A)**:

- Klasyczny Laravelowy wzorzec `belongsToMany` — `$champion->traits()->get()` out of the box
- Elastyczny: można dodać kolumny metadanych w przyszłości (np. `is_from_emblem`, `bonus_level` dla hipotetycznych mechanik)
- Inertia + Eloquent eager loading: `Champion::with('traits')->get()` → w React `champion.traits[]` array obiektów Trait bezpośrednio
- Dla 68 championów × 144 pivotów wydajność jest bez znaczenia
- Filtrowanie: `Champion::whereHas('traits', fn($q) => $q->where('api_name', 'TFT17_Mecha'))`

#### Tabela `traits`

```
id                bigint PK
set_id            bigint FK → sets.id
api_name          varchar(100)                  -- "TFT17_Vanguard"
name              varchar(100)                  -- "Vanguard"
description       text
icon_path         varchar(500)
category          varchar(20) NOT NULL          -- "public" | "unique" | "hidden"
is_unique         boolean DEFAULT false         -- legacy alias dla category='unique'

created_at, updated_at

UNIQUE (set_id, api_name)
INDEX (category)
```

**Uzasadnienie**:

- `category` rozróżnia 3 typy traitów (patrz Problem #8)
- Backward-compatible `is_unique` dla prostych query

#### Tabela `trait_breakpoints`

```
id                bigint PK
trait_id          bigint FK → traits.id ON DELETE CASCADE
position          smallint                      -- 1, 2, 3... kolejność
min_units         smallint
max_units         smallint
style_id          smallint                      -- FK → trait_styles.id (Bronze=1, Silver=3...)
effects           jsonb                         -- {"DamageInstances": 10, ...}

UNIQUE (trait_id, position)
```

#### Tabela `trait_styles`

```
id                smallint PK                   -- 1, 3, 4, 5, 6 (z CDragona)
name              varchar(20) UNIQUE            -- Bronze, Silver, Unique, Gold, Prismatic
fallback_score    real DEFAULT 0                -- dla algorytmu scoutingu
color             varchar(10) NULL              -- dla UI (#cd7f32 dla Bronze itp.)
```

#### Tabela `items` (teraz czysta — tylko faktyczne itemy)

```
id                bigint PK
set_id            bigint FK → sets.id NULL      -- NULL dla base items cross-set
api_name          varchar(100) UNIQUE           -- "TFT_Item_Bloodthirster"
name              varchar(100)                  -- "Bloodthirster"
type              varchar(20) NOT NULL          -- "base" | "craftable" | "radiant" | "support" | "artifact" | ...
tier              varchar(20) NULL              -- dla radiant/artifact
component_1_id    bigint FK → items.id NULL    -- self-FK dla recipe
component_2_id    bigint FK → items.id NULL
effects           jsonb DEFAULT '{}'            -- strukturalne stats itemu
tags              text[] DEFAULT '{}'           -- tylko czytelne: ["AttackDamage", "Health"]
icon_path         varchar(500)

created_at, updated_at

INDEX (type)
INDEX (component_1_id)
INDEX (component_2_id)
```

**Uzasadnienie**:

- `component_*_id` jako prawdziwe FK (self-reference) — integralność
- `tags text[]` z filtrowaniem przy imporcie — wywalamy `{hex}` śmieci
- `type` rozróżnia podkategorie itemów

#### Tabela `augments` (NOWA — wydzielona z items)

```
id                bigint PK
set_id            bigint FK → sets.id ON DELETE CASCADE
api_name          varchar(100) UNIQUE           -- "TFT17_Augment_Determined"
name              varchar(100)
description       text
tier              varchar(20)                   -- "silver" | "gold" | "prismatic" | "hero"
effects           jsonb
associated_trait_id bigint FK → traits.id NULL  -- dla trait-gated augments
icon_path         varchar(500)

created_at, updated_at

INDEX (tier)
INDEX (associated_trait_id)
```

**Uzasadnienie**: augmenty to zupełnie inna kategoria — mają tier (silver/gold/prismatic), są wybierane na etapach 2-1, 3-2, 4-2, nie mają recipe, nie idą na championów. **W MVP mogą zostać puste** (import tylko jeśli zdecydujesz Decyzja #2 = TAK).

#### Tabela `emblems` (NOWA — wydzielona z items)

```
id                bigint PK
set_id            bigint FK → sets.id
api_name          varchar(100) UNIQUE
name              varchar(100)
trait_id          bigint FK → traits.id ON DELETE CASCADE
icon_path         varchar(500)
```

**Uzasadnienie**: emblemy to osobna kategoria — zawsze 1:1 z traitem, często istnieje kilka form (Spatula + X = Emblem). 783 emblemów w obecnej bazie to hash-duplikaty z wielu setów — po filtracji będzie ~20-30 dla Set 17.

### Część B: MetaTFT ratings (volatile, time-based)

#### Tabela `metatft_cache`

```
id                bigint PK
endpoint          varchar(50) NOT NULL          -- "units" | "traits" | "comps" | "explorer/traits"
params_hash       varchar(16) NOT NULL          -- SHA256 slice pierwszych parametrów
params            jsonb                         -- oryginalne parametry dla debugu
data              jsonb                         -- raw response
fetched_at        timestamptz NOT NULL
ttl_seconds       integer NOT NULL

UNIQUE (endpoint, params_hash)
INDEX (endpoint, fetched_at)
```

> **Decyzja #3 → B + FK (Decyzja 3a → A):** wszystkie tabele ratingów mają **prawdziwe FK** do `champions.id` / `traits.id` / `items.id`. Base Miss Fortune istnieje w `champions` z `is_playable=false`, więc nie ma osieroconych rekordów.

#### Tabela `champion_ratings` (zamiast `unit_ratings`)

```
id                bigint PK
champion_id       bigint FK → champions.id ON DELETE CASCADE
set_id            bigint FK → sets.id
patch             varchar(20) NULL              -- "14.3" jeśli dostępne z MetaTFT
avg_place         real
win_rate          real
top4_rate         real
games             integer
score             real                          -- computed (6 - avgPlace) / 3
updated_at        timestamptz

UNIQUE (champion_id, patch)
INDEX (set_id, score DESC)
INDEX (champion_id)
```

#### Tabela `trait_ratings`

```
id                      bigint PK
trait_id                bigint FK → traits.id ON DELETE CASCADE
breakpoint_position     smallint NOT NULL      -- 1, 2, 3...
set_id                  bigint FK → sets.id
avg_place               real
win_rate                real
top4_rate               real
games                   integer
score                   real
updated_at              timestamptz

UNIQUE (trait_id, breakpoint_position)
INDEX (set_id, score DESC)
```

#### Tabela `champion_trait_affinity`

```
id                      bigint PK
champion_id             bigint FK → champions.id ON DELETE CASCADE
trait_id                bigint FK → traits.id ON DELETE CASCADE
breakpoint_position     smallint NOT NULL
set_id                  bigint FK → sets.id
avg_place               real
games                   integer
frequency               real
updated_at              timestamptz

UNIQUE (champion_id, trait_id, breakpoint_position)
INDEX (champion_id)
INDEX (trait_id)
```

#### Tabela `champion_item_builds`

```
id                bigint PK
champion_id       bigint FK → champions.id ON DELETE CASCADE
item_id           bigint FK → items.id ON DELETE CASCADE
set_id            bigint FK → sets.id
avg_place         real
games             integer
frequency         real
updated_at        timestamptz

UNIQUE (champion_id, item_id)
INDEX (champion_id)
INDEX (item_id)
```

#### Tabela `champion_item_sets` (3-item builds)

```
id                bigint PK
champion_id       bigint FK → champions.id ON DELETE CASCADE
item_api_names    text[] NOT NULL               -- ["TFT_Item_A", "TFT_Item_B", "TFT_Item_C"]
set_id            bigint FK → sets.id
avg_place         real
games             integer
updated_at        timestamptz

INDEX (champion_id)
GIN   (item_api_names)                          -- query "które sety zawierają ten item"
```

**Uwaga**: `item_api_names` zostaje jako `text[]` (nie pivot), bo **kombinacja 3 itemów jest wartością atomową dla statystyki** — nie interesuje nas relacja pojedynczego itemu z setem, tylko konkretny zestaw jako całość. GIN index na tablicy daje szybkie query po zawartości.

#### Tabela `champion_companions`

```
id                      bigint PK
champion_id             bigint FK → champions.id ON DELETE CASCADE
companion_champion_id   bigint FK → champions.id ON DELETE CASCADE
set_id                  bigint FK → sets.id
avg_place               real
games                   integer
frequency               real
updated_at              timestamptz

UNIQUE (champion_id, companion_champion_id)
INDEX (champion_id)
INDEX (companion_champion_id)
CHECK (champion_id != companion_champion_id)
```

#### Tabela `meta_comps`

```
id                bigint PK
cluster_id        varchar(50) UNIQUE           -- z MetaTFT
set_id            bigint FK → sets.id
name              varchar(255)                  -- auto-generowana etykieta
active_traits     jsonb                         -- [{trait_id, breakpoint_position, count}]
levelling         varchar(50)                   -- "Fast 8", "Slow Roll 7" etc.
top_builds        jsonb                         -- [{champion_id, items[], avg}]
avg_place         real
games             integer
updated_at        timestamptz

INDEX (set_id, avg_place ASC)
```

#### Tabela `meta_comp_champions` (pivot M:N dla meta_comps ↔ champions)

```
meta_comp_id      bigint FK → meta_comps.id ON DELETE CASCADE
champion_id       bigint FK → champions.id ON DELETE CASCADE
star_level        smallint NULL                 -- jeśli MetaTFT podaje
is_carry          boolean DEFAULT false         -- jeśli ma itemy w top_builds

PRIMARY KEY (meta_comp_id, champion_id)
INDEX (champion_id)                              -- reverse: „wszystkie composy z Aatroxem"
```

**Uzasadnienie**: pivot zamiast `champion_ids text[]` daje FK integrity i proste query „pokaż composy z championem X". Active traits i top_builds pozostają jako JSONB bo są zagnieżdżonymi strukturami (breakpoint, item list) — rozbijanie ich na pivoty to over-engineering.

### Część C: User data (MVP: saved plans)

#### Tabela `users` (już istnieje ze starter kita)

```
id, name, email, email_verified_at, password, two_factor_*, remember_token, timestamps
```

#### Tabela `plans`

```
id                bigint PK
user_id           bigint FK → users.id ON DELETE CASCADE
set_id            bigint FK → sets.id
name              varchar(150) NOT NULL         -- edytowalny tytuł
notes             text NULL
slots             jsonb NOT NULL                -- [{x,y, champion_api_name, star_level, items[], augment?}]
                                                -- rozbijamy na plan_slots gdy będzie potrzeba (Faza 2)
is_public         boolean DEFAULT false
share_token       varchar(32) UNIQUE NULL       -- dla public plans (shareable URL)

created_at, updated_at

INDEX (user_id, updated_at DESC)
INDEX (share_token) WHERE share_token IS NOT NULL
```

**Uzasadnienie**: JSONB `slots` w MVP — najprostsza forma, jeden INSERT na save, łatwa deserializacja. Gdy dojdziesz do potrzeby „kto używa tego championa w swoich planach" → faza 2, rozbijasz na `plan_slots` tabelę z FK na champions.

### Część D: Audit / housekeeping

#### Tabela `data_imports`

```
id                bigint PK
source            varchar(30) NOT NULL          -- "cdragon" | "metatft"
endpoint          varchar(50) NULL              -- dla metatft
set_id            bigint FK → sets.id NULL
started_at        timestamptz NOT NULL
completed_at      timestamptz NULL
status            varchar(20) NOT NULL          -- "running" | "success" | "failed"
records_affected  integer DEFAULT 0
error_message    text NULL
metadata          jsonb                         -- liczby per tabela, cdragon version etc.

INDEX (source, started_at DESC)
```

**Uzasadnienie**: audit trail importów — wiadomo kiedy, co, ile.

### Część E: SetHooks — architektura set-specific logiki importu (Decyzja #7 → A)

**Kontekst**: CDragon API **nie wystawia** wariantów championów ani mechaniki Enhanced Mecha. Zweryfikowane bezpośrednio w API — zwraca tylko `TFT17_MissFortune` (jedna jednostka) i 3 base mecha champions bez enhanced wariantów. Cała logika wariantowania jest **game logic interpretation** po stronie importera, specyficzna per set.

**Struktura katalogów:**

```
app/Services/Import/
├── CDragonImporter.php                    (główny serwis importu)
├── Contracts/
│   └── PostImportHook.php                 (interfejs)
└── SetHooks/
    └── Set17/
        ├── RemoveNonPlayableHook.php      (usuwa TFT17_DarkStar_FakeUnit itp.)
        ├── MissFortuneVariantsHook.php    (tworzy 3 warianty + base MF is_playable=false)
        └── MechaEnhancedHook.php          (tworzy _enhanced variants, slots_used=2)
```

**Interfejs:**

```php
namespace App\Services\Import\Contracts;

use App\Models\Set;

interface PostImportHook
{
    public function run(Set $set): void;
}
```

**Każdy hook** to klasa implementująca `PostImportHook`, z `run()` otrzymującym aktywny set i operującym na modelach Eloquent. Hooki są uruchamiane przez `CDragonImporter` po bazowym imporcie w ramach transakcji DB.

**Rejestracja hooków per set** (w `CDragonImporter` lub config):

```php
const SET_HOOKS = [
    17 => [
        RemoveNonPlayableHook::class,
        MissFortuneVariantsHook::class,
        MechaEnhancedHook::class,
    ],
    // 18 => [...] w przyszłości
];
```

**Dlaczego osobne klasy per hook (Opcja A z Decyzji #7):**

- **Testowalne w izolacji** — każdy hook ma osobny test `tests/Feature/Import/Set17/MechaEnhancedHookTest.php`
- **Rozszerzalne** — nowa mechanika Set 18 = nowy plik hooka, bez dotykania istniejących
- **Autoload-friendly** — Laravel service container może automatycznie instancjonować przez injection
- **Jasna organizacja** — zobaczysz w repo od razu „jakie hooki mamy dla Set 17"
- **Chronologia mechanik** — przyszłe Set 18+ `SetHooks/Set18/` nie miesza się z Set 17

**Przykład `MechaEnhancedHook`:**

```php
namespace App\Services\Import\SetHooks\Set17;

use App\Models\Champion;
use App\Models\Set;
use App\Services\Import\Contracts\PostImportHook;

class MechaEnhancedHook implements PostImportHook
{
    public function run(Set $set): void
    {
        $mechaChamps = Champion::query()
            ->where('set_id', $set->id)
            ->whereNull('base_champion_id')           // tylko baseowe
            ->whereHas('traits', fn($q) => $q->where('api_name', 'TFT17_Mecha'))
            ->get();

        foreach ($mechaChamps as $base) {
            $enhanced = $base->replicate(['api_name', 'name', 'variant_label', 'slots_used']);
            $enhanced->api_name = $base->api_name . '_enhanced';
            $enhanced->name = $base->name . ' (Enhanced)';
            $enhanced->variant_label = 'enhanced';
            $enhanced->slots_used = 2;
            $enhanced->base_champion_id = $base->id;
            $enhanced->is_playable = true;
            $enhanced->save();

            // Skopiuj te same traity
            $enhanced->traits()->sync($base->traits->pluck('id'));
        }
    }
}
```

`MissFortuneVariantsHook` będzie podobny ale bardziej skomplikowany — tworzy 3 warianty z różnymi rolami i dodatkowymi traitami, a base MF ma `is_playable=false`.

---

## 4. Mapa migracji pól (stare → nowe)

| Stare (tft.db SQLite)            | Nowe (tft-scout Postgres)                                | Notatki                                          |
| -------------------------------- | -------------------------------------------------------- | ------------------------------------------------ |
| `trait_styles.*`                 | `trait_styles.*`                                         | 1:1, seed                                        |
| `traits.apiName`                 | `traits.api_name`                                        | + kolumna `set_id`                               |
| `traits.isUnique`                | `traits.category='unique'` + `is_unique` backward compat |                                                  |
| —                                | `traits.category` (NEW)                                  | derived: unique/public/hidden                    |
| `trait_breakpoints.effects TEXT` | `trait_breakpoints.effects jsonb`                        | + filtracja `{hex}` kluczy                       |
| `champions.apiName`              | `champions.api_name`                                     | + `set_id`                                       |
| `champions.baseApiName`          | `champions.base_champion_id`                             | self-FK, nie string                              |
| `champions.variant`              | `champions.variant_label`                                | zachowane                                        |
| `champions.role`                 | `champions.role` + `damage_type` + `role_category`       | rozbite                                          |
| `champions.{hp,armor,...}`       | `champions.{hp,armor,...}`                               | kolumny (query-owane)                            |
| `champions.abilityDesc TEXT`     | `champions.ability_desc text`                            | raw jak było                                     |
| `champions.abilityStats TEXT`    | `champions.ability_stats jsonb`                          | + walidacja shape                                |
| `champions.plannerCode`          | `champions.planner_code`                                 |                                                  |
| `champions.icon`                 | `champions.icon_path`                                    |                                                  |
| `champion_traits` (pivot)        | `champion_trait` (pivot Laravelowy)                      | zachowana, tylko rename kolumn na snake_case     |
| —                                | `champions.is_playable` (NEW)                            | flaga dla MF base (Decyzja 3a)                   |
| `exclusion_groups`               | —                                                        | usunięte, zastąpione `base_champion_id`          |
| `items.apiName`                  | `items.api_name` + filtr importer                        | tylko prawdziwe itemy                            |
| `items.component1,2 TEXT`        | `items.component_1_id, component_2_id`                   | FK self-ref                                      |
| `items.effects TEXT`             | `items.effects jsonb`                                    |                                                  |
| `items.tags TEXT`                | `items.tags text[]`                                      | + filtr `{hex}` tagów                            |
| `items.isEmblem`                 | — → tabela `emblems`                                     | emblem wypada do osobnej tabeli                  |
| `items.traitId` (dla emblems)    | `emblems.trait_id`                                       |                                                  |
| —                                | `augments.*` (NEW)                                       | import z CDragon filtrowany po `TFT17_Augment_*` |
| `metatft_cache.*`                | `metatft_cache.*` + `jsonb` dla data/params              |                                                  |
| `unit_ratings.*`                 | `champion_ratings.*`                                     | + `set_id`, + opcjonalnie `patch`                |
| `trait_ratings.*`                | `trait_ratings.*`                                        | + `set_id`                                       |
| `unit_trait_affinity.*`          | `champion_trait_affinity.*`                              | + `set_id`                                       |
| `unit_item_builds.*`             | `champion_item_builds.*`                                 | + `set_id`                                       |
| `unit_item_sets.items TEXT`      | `champion_item_sets.item_api_names text[]`               | native array                                     |
| `unit_companions.*`              | `champion_companions.*`                                  | + `set_id`                                       |
| `meta_comps.units TEXT`          | `meta_comps.champion_api_names text[]`                   | native array                                     |
| `meta_comps.traits TEXT`         | `meta_comps.active_traits jsonb`                         | struktura [{api_name, position, count}]          |
| `meta_comps.builds TEXT`         | `meta_comps.top_builds jsonb`                            | już było JSON                                    |
| `saved_teams.fingerprint`        | —                                                        | pomijamy (localStorage legacy)                   |
| `saved_teams.data TEXT`          | → `plans.slots jsonb` (nowa tabela)                      | przez migrację user accounts                     |
| —                                | `users.*` (starter kit)                                  |                                                  |
| —                                | `plans.*` (NEW)                                          |                                                  |
| —                                | `data_imports.*` (NEW)                                   | audit trail                                      |
| —                                | `sets.*` (NEW)                                           | metadane setów                                   |

---

## 5. Rzeczy do wywalenia

### Wywalane całkowicie (importer ich nie ściąga / nie zapisuje)

- **`items` z OTHER prefix** (~2954 rekordów) — wszystkie augmenty i itemy historyczne z innych setów
- **Tagi `{hex}` z items.tags** — ~121 distinct hash tagów, zero wartości
- **`exclusion_groups` tabela** — zastąpiona self-FK `champions.base_champion_id`
- **`saved_teams` tabela** — pusty, kompletnie nieużywany (user ma w localStorage)
- **Dead ability stats > star 5** — pozycje `abilityStats[].value[5,6]` są duplikatami lub fallbackami; importer obcina do 5 gwiazd

### Zachowane (zmiana vs wcześniejszy plan)

- ✅ **`champion_trait` pivot tabela** — **zachowana** (Decyzja #4 → A), Laravel idiomatic belongsToMany
- ✅ **Base Miss Fortune** — zachowany w `champions` z `is_playable=false` (Decyzja #3a → A), dla FK integrity ratings

---

## 6. Decyzje — ✅ FINAL

> **Status:** wszystkie decyzje podjęte i finalizowane. Wersja poniżej to źródło prawdy dla implementacji migracji, modeli i importera.

### ✅ Decyzja #1 — Multi-set czy current-set-only?

**Kontekst:** obecny schemat zakłada 1 aktywny set, re-import nadpisuje. Schemat docelowy powyżej **już ma `set_id` FK wszędzie** — to jest de facto multi-set ready, tylko z 1 rekordem w tabeli `sets` dla Set 17.

**Opcje:**

- **(A)** Multi-set z tabelą `sets` i `set_id` FK wszędzie — trochę więcej kodu, ale otwiera historię setów na przyszłość
- **(B)** Current-set-only — pomijamy tabelę `sets`, wszystkie kolumny `set_id` też, prosty schemat dla jednego aktywnego setu, przy zmianie setu TRUNCATE

**Rekomendacja:** (A) — koszt minimalny, korzyść duża.

**✅ FINAL: A** — tabela `sets` + `set_id` FK wszędzie, multi-set ready.

---

### ✅ Decyzja #2 — Augmenty w MVP?

**Kontekst:** w obecnej bazie nie ma osobnej tabeli `augments` — są rozrzucone w `items` jako śmieci. W nowym schemacie proponuję osobną tabelę.

**Opcje:**

- **(A)** TAK — od razu dodajemy tabelę `augments`, importujemy w `ImportCDragon` filtrując po `TFT17_Augment_*`, frontend może je wyświetlać
- **(B)** NIE — tabela powstaje ale pusta, import augmentów dodajemy w osobnej fazie (po MVP)
- **(C)** Całkowicie pomijamy — tabeli nie tworzymy

**Rekomendacja:** (A) — augmenty są sercem planera, import jest prosty.

**✅ FINAL: A** — tabela `augments` + import z CDragon filtrowany po `TFT17_Augment_*` w MVP.

---

### ✅ Decyzja #3 — Warstwa MetaTFT (ratings/comps) w MVP?

**Kontekst:** obecna aplikacja bardzo mocno korzysta z MetaTFT — ratings, affinity, item builds, companion champions, meta comps. To są **7 tabel** z ~10500 rekordami łącznie (2891 + 2042 + 2516 + 3035 + 89 + 63 + 41).

**Opcje:**

- **(A)** MVP bez MetaTFT — najpierw CDragon → Laravel → Inertia → konta → plan saving. Ratings dokładamy w Fazie 2. **Szybciej dostarczymy działającą apkę.**
- **(B)** Od razu pełna warstwa MetaTFT — 7 dodatkowych tabel + przepisanie agregatorów + endpoints + cache layer. Więcej kodu w MVP, ale feature-parity z obecną wersją od startu.
- **(C)** Pomijamy MetaTFT całkowicie, czekamy na własny pipeline meczowy z Riot API (długoterminowy cel). Oznacza utratę obecnej funkcjonalności ratingów na jakiś czas.

**Rekomendacja pierwotna:** (A) — odsunięcie MetaTFT na Fazę 2 dla szybszego MVP.

**✅ FINAL: B + FK wymóg** — pełna warstwa MetaTFT w MVP, bo dane są sercem scoringu/algorytmu. Wszystkie tabele ratingów mają **prawdziwe FK** do `champions.id`, `traits.id`, `items.id` (nie soft refs). Rozwiązanie dla problemu Miss Fortune: **Decyzja #3a**.

---

### ✅ Decyzja #3a — Strategia FK dla ratingów vs osierocone base championy (Miss Fortune)

**Kontekst**: MetaTFT zwraca rating dla `TFT17_MissFortune` (base), ale w obecnej bazie base MF jest usunięty (tylko warianty istnieją). Jak pogodzić FK integrity z tym?

**Opcje:**

- **(A)** Base MF zostaje w tabeli `champions` z flagą `is_playable = false`. Frontend pokazuje do wyboru tylko `is_playable=true` (warianty). Ratings mają FK na base MF. **Pełna integralność FK.**
- **(B)** Hybrid: `champion_id` nullable FK + `champion_api_name` soft ref. Gdy match, FK ustawiony; gdy nie, tylko api_name. Część ratingów bez FK.
- **(C)** Odrzucamy osierocone ratings przy imporcie. Tracimy dane MF ratings.

**Rekomendacja:** (A) — zachowuje wszystkie dane i FK integrity kosztem jednej flagi i jednego filtra w query.

**✅ FINAL: A** — `champions.is_playable boolean DEFAULT true`. Base MF ma `is_playable=false`, warianty MF mają `is_playable=true`. Mecha base i enhanced wszystkie mają `is_playable=true`. Wszystkie ratings/affinity/builds/companions tabele mają **twarde FK** na `champions.id`.

---

### ✅ Decyzja #4 — Pivot `champion_trait` vs `text[]`?

**Kontekst:** klasyczne Laravelowe podejście to tabela pivot `champion_trait` z `belongsToMany`. Postgres-natywne to `text[]` z castem na array w modelu.

**Opcje:**

- **(A)** Pivot `champion_trait` + `belongsToMany` w Eloquent — standardowy wzorzec Laravela, wszystko "po bożemu", ale osobna tabela, JOIN-y
- **(B)** Postgres `text[]` + cast `'array'` w modelu Champion — jedna kolumna, szybsze query (`WHERE 'X' = ANY(trait_api_names)`), GIN index

**Rekomendacja zmieniona na:** (A) — pivot `champion_trait` z `belongsToMany`. Powody: elastyczność pod kątem przyszłych mechanik (można dodać kolumny metadanych), idiomatic Laravel, Inertia + Eloquent eager loading działa out of the box, zero wydajnościowej różnicy dla małych liczb TFT.

**✅ FINAL: A** — klasyczny pivot `champion_trait(champion_id, trait_id)` z `belongsToMany` w modelu Champion.

---

### ✅ Decyzja #5 — `plans.slots` jako JSONB vs osobna tabela `plan_slots`?

**Kontekst:** plan to plansza 4×7 = 28 slotów. Każdy slot ma championa, star level, itemy (0-3), opcjonalnie augment-gated info.

**Opcje:**

- **(A)** JSONB: `plans.slots jsonb` — jedno pole, cały stan planu jako obiekt, jeden INSERT na save, brak JOINów, idealne dla MVP
- **(B)** Relacyjnie: tabela `plan_slots` z FK na `plans.id` i `champions.id` — pozwala na query „kto używa tego championa w swoich planach", ale więcej kodu, osobne operacje przy save
- **(C)** Hybrid: JSONB w MVP, potem Faza 2 rozbija na `plan_slots` gdy pojawi się realna potrzeba analityki

**Rekomendacja:** (C) — hybrid: zacznij od JSONB, rozbij gdy realna potrzeba.

**✅ FINAL: C** — `plans.slots jsonb` w MVP, migracja do tabeli `plan_slots` w Fazie 2.

---

### ✅ Decyzja #6 — Role championów: rozbijamy na `damage_type` + `role_category`?

**Kontekst:** obecnie jeden string `"ADFighter"`, mieszający 2 osi.

**Opcje:**

- **(A)** Zostawiamy jak jest — kolumna `role varchar(30)` — prosty enum-string
- **(B)** Rozbijamy na 2 kolumny: `damage_type char(2)` (`AD`/`AP`/`H`) + `role_category varchar(20)` — filtrowanie „wszyscy AD tanks" = `WHERE damage_type='AD' AND role_category='Tank'`
- **(C)** Trzymamy obie kolumny: `role` (oryginalny string dla backward compat) + `damage_type` + `role_category` (derived przy imporcie)

**Rekomendacja:** (C) — 3 kolumny, koszt zerowy, maksymalna elastyczność.

**✅ FINAL: C** — `role varchar(30)` + `damage_type char(2)` + `role_category varchar(20)`. Przy imporcie parsujemy string `ADFighter` → `role='ADFighter', damage_type='AD', role_category='Fighter'`.

---

### ✅ Decyzja #7 — Organizacja SetHooks w Laravelu

**Kontekst**: Node importer ma `set-hooks.js` z hookami specyficznymi dla Set 17 (MissFortune variants, Mecha enhanced). CDragon nie wystawia tych mechanik, trzeba je sztucznie tworzyć. Jak zorganizować w Laravelu?

**Opcje:**

- **(A)** Osobne klasy per hook: `app/Services/Import/SetHooks/Set17/MechaEnhancedHook.php`, `MissFortuneVariantsHook.php` + interfejs `PostImportHook`
- **(B)** Jedna klasa per set: `Set17Hooks.php` z metodami
- **(C)** Jobs (dispatch per hook)

**Rekomendacja:** (A) — testowalne, rozszerzalne, autoload-friendly.

**✅ FINAL: A** — struktura `app/Services/Import/SetHooks/Set17/*Hook.php`. Szczegóły w sekcji [3E SetHooks](#część-e-sethooks--architektura-set-specific-logiki-importu-decyzja-7--a).

---

## Co dalej

Po wypełnieniu 6 decyzji powyżej:

1. **Aktualizuję ten dokument** — sekcje zostają, decyzje przechodzą z „DRAFT" w „FINAL"
2. **Piszę migracje Laravel** (Task #5) — `database/migrations/*.php` zgodnie z finalnym schematem
3. **Piszę modele Eloquent** (Task #6) — `app/Models/*.php` z relacjami, castami, scopes
4. **Piszę importer** (Task #7) — `app/Console/Commands/ImportCDragon.php` z filtrowaniem
5. **Uruchamiam `php artisan migrate` + `php artisan tft:import`** — weryfikujemy że dane idą
6. **Przechodzimy do UI** — Inertia pages dla list championów/traitów/itemów

Szacowana kolejność sesji: każdy z kroków 2-5 to jedno posiedzenie wieczorne, razem ~3-4 wieczory do działającej bazy z importowanym Set 17.
