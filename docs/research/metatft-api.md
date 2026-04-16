# MetaTFT API reference

**Status:** reverse-engineered 2026-04-15 z metatft.com/explorer (React bundle `index-YruYdlEj.js` + live network capture przez Chrome DevTools MCP). Zastępuje `docs/superpowers/plans/metatft-api-notes.md` jako źródło prawdy.

Wszystkie endpointy GET, bez autoryzacji (oprócz `/tft-usercontent/user` dla JWT).

## Hosty

| Host | Cel |
|---|---|
| `api-hc.metatft.com/tft-stat-api` | bulk stat histograms (units, traits, items, games) |
| `api-hc.metatft.com/tft-comps-api` | meta comps clustering + cluster detail |
| `api-hc.metatft.com/tft-explorer-api` | per-unit/trait filtered explorer (użwa `rank`, `queue`, `unit_unique`) |
| `api-hc.metatft.com/tft-explorer-predictions` | ML comp predictions (Set 17, probably WIP) |
| `api.metatft.com` | user/auth, profiles, leaderboard, match data (nie-stat) |
| `data.metatft.com/lookups` | static i18n lookups per set |

## Standardowe parametry

Zaobserwowane w explorerze, default filter state:

```js
{
  queue: ["1100"],                                    // int queue id, array-form w state
  patch: ["current"],                                 // "current" albo "17.1", "16.8" itp.
  days: [3],                                          // bulk 3, explorer 1, games 7
  rank: ["CHALLENGER","DIAMOND","EMERALD","GRANDMASTER","MASTER","PLATINUM"],
  permit_filter_adjustment: ["true"]
}
```

Serializowane do URL jako CSV:
`queue=1100&patch=current&days=3&rank=CHALLENGER,DIAMOND,EMERALD,GRANDMASTER,MASTER,PLATINUM&permit_filter_adjustment=true`

### Queue IDs (z `QueueMapping` const)

| ID | Nazwa |
|---|---|
| `0` | All |
| `1090` | Normal |
| `1091` | 1v0 |
| `1092` | 2v0 |
| **`1100`** | **Ranked** (use this for Set 17 live retail) |
| `1130` | Hyper Roll |
| `1160` | Double Up |
| `1170` | Fortune's Favor |
| `1180` | Soul Fighter |
| `1210` | Choncc's Treasure |
| `6000` | Galaxies |
| `6110` | Remix Rumble / Uncharted Realms |
| `6120` | Pengu's Party |

API akceptuje alias `queue=RANKED` **TYLKO na `/tft-stat-api` i `/tft-comps-api`**. Explorer (`/tft-explorer-api`) **wymaga integer ID `1100`** — alias `RANKED` silently zwraca `data:[], sample_size:0` bez błędu HTTP. Zawsze używaj `1100`.

### Rank values

`IRON, BRONZE, SILVER, GOLD, PLATINUM, EMERALD, DIAMOND, MASTER, GRANDMASTER, CHALLENGER` — CSV.
Default explorer filter = `PLATINUM+` (6 topowych ranków).

### `permit_filter_adjustment=true`

Serwer może auto-relaxować rank filter gdy sample <~2320. Response zawiera:
```json
"filter_adjustment": {
  "override_applied": true,
  "original_rank_filter": "...",
  "original_sample_size": 2320,
  "new_rank_filter": "...",
  "new_sample_size": 95102
}
```

### Response format toggles (explorer only)

- `formatnoarray=true` + `compact=true` — używane zawsze przez explorer frontend
- Histogramy: `places` / `placement_count` = array 8 intów (finishes 1..8)
- `comps_stats` wyjątek: 9-element, index [8] = total

---

## `tft-stat-api` — bulk histograms

Wszystkie przyjmują: `queue`, `patch`, `days`, `permit_filter_adjustment`. Opcjonalnie `rank`.

| Endpoint | Response |
|---|---|
| `GET /units` | `{results: [{unit: "TFT17_X", places: [8]}]}` — 63 rows Set 17 |
| `GET /traits` | `{results: [{trait: "TFT17_X_N", places: [8]}]}` — N = breakpoint, 102 rows |
| `GET /items` | `{results: [{itemName: "TFT17_X", places: [8]}]}` — unique items (artefakty, setowe itemy) |
| `GET /items_matches` | `{results: [{itemName: "TFT_Item_X", places: [8]}]}` — standard items |
| `GET /units_distribution` | `{results: [{unit, numItems: "0".."3", places: [8]}]}` — units × itemCount breakdown |
| `GET /percentiles` | `{percentiles: [{board_strength: "[...]", ...}]}` — board strength percentiles per level |
| `GET /games?days=7` | `{games: [{day, srq: [region, rank, queueId], patch: [patch, ""], count}]}` — sample breakdown |

Aggregation:
```
games    = Σ places[i]
avgPlace = Σ (i+1)*places[i] / games
winRate  = places[0] / games
top4Rate = Σ(places[0..3]) / games
```

---

## `tft-comps-api` — meta comps

### `GET /latest_cluster_id?queue=1100`
```json
{"updated": 1776263562743, "tft_set": "TFTSet17", "cluster_id": 400}
```
Lekki ping — zwraca aktualny cluster generation ID. Dobre do cache invalidation.

### `GET /latest_cluster_info?queue=1100`
387KB — meta dla cluster generation (state, created_at, failed flags, cluster listy). Pre-check przed ciężkim `comps_data`.

### `GET /comps_data?queue=1100&region_hint=eun1`
```json
{
  "results": {
    "data": {
      "cluster_id": 400,
      "tft_set": "TFTSet17",
      "cluster_details": {
        "400000": {
          "Cluster": 400000,
          "units_string": "TFT17_X, TFT17_Y, ...",  // CSV apiName
          "traits_string": "TFT17_Trait_N, ...",     // N = breakpoint suffix
          "name_string": "Display Name",
          "overall": {"count": 27476, "avg": 4.21},
          "levelling": "lvl 7",                      // regex: /\d+/
          "builds": { ... },
          "stars": { ... },
          "trends": [ ... ],
          ...
        }
      }
    }
  }
}
```

### `GET /comps_stats?queue=1100&region_hint=eun1`
Per-cluster placement histogram (9-el: [0..7] = buckets, [8] = total count).

### `GET /comp_builds?cluster_id={id}` `GET /comp_options?cluster_id={id}` `GET /comp_augments?cluster_id={id}`
Cluster-detail endpointy. **Wymagają** poprawnego cluster_id z aktualnej generacji (`latest_cluster_id`). Frontend wysyła je tylko na stronie comp detail — na explorerze nie. Omijają `queue=` w URL gdy `queue=1100` (default).

### `GET /unit_items_processed` — ❌ DEPRECATED
Stały snapshot, mix TFT16+TFT17 (106+64 units), ignoruje wszystkie parametry. Nie używać.

---

## `tft-explorer-api` — filtered explorer

Wszystkie przyjmują full filter set (`queue`, `patch`, `days`, `rank`, `permit_filter_adjustment`) + opcjonalnie `formatnoarray=true&compact=true`. Obsługują **entity filter** (`unit_unique`, `unit_tier_numitems_unique`, itd.) z negacją prefiksu `!`.

### `GET /total`
Overall aggregate po filtrach. Response:
```json
{
  "data": [{
    "total_games": 95102,
    "win_percentage": 12.52,
    "top4_percentage": 50.05,
    "avg_placement": 4.50,
    "placement_count": [8]
  }],
  "filter_adjustment": { ... }
}
```
Użycie: **denominator** do frequency calcs (frequency = unit_games / total_games).

### `GET /units_unique`
```json
{"data": [
  {"units_unique": null, "placement_count": [8]},      // overall (denominator row)
  {"units_unique": "TFT17_Aatrox-1", "placement_count": [8]},
  {"units_unique": "TFT17_Aatrox-2", "placement_count": [8]},  // 2-star
  {"units_unique": "TFT17_Aatrox-3", "placement_count": [8]}
]}
```
Suffix `-1/-2/-3` = tier (1/2/3-star). Strip przed foldowaniem.

### `GET /traits?unit_unique=TFT17_X-1`
Per-unit trait affinity. Response:
```json
{"data": [
  {"traits": null, "placement_count": [8]},             // unit total
  {"traits": "TFT17_ADMIN_1", "placement_count": [8]},  // trait_N
  ...
]}
```

### `GET /unit_items_unique/{apiName}-1`
Path-based. Per-unit item pick distribution (pojedyncze itemy).
```json
{"data": [
  {"unit_items_unique": null, "placement_count": [8]},
  {"unit_items_unique": "TFT17_MissFortune-1&TFT_Item_GuinsoosRageblade-1", "placement_count": [8]}
]}
```
Klucz: `{unitApiName}-{star}&{itemApiName}-{slot}`.

### `GET /unit_builds/{apiName}`
Path-based (bez `-1`). Full 3-item build combinations.
```json
{"data": [
  {"unit_builds": "TFT17_MissFortune&TFT_Item_BlueBuff|TFT_Item_InfinityEdge|TFT_Item_PowerGauntlet", "placement_count": [8]}
]}
```
Klucz: `{unitApiName}&{item1}|{item2}|{item3}`.

### `GET /rank`
Breakdown po ranku po filtrach.
```json
{"data": [{"rank": "GOLD", "placement_count": [8]}, {"rank": "PLATINUM", ...}]}
```

### `GET /server`
Breakdown po regionie (BR1, EUN1, EUW1, ...).

### Filter registry — kompletny (z `Explorer-CgUHPXlA.js`)

Explorer trzyma filtry jako obiekty `{type, key, options[], included}` a serializer (w bundle: `buildPredictionParams` / analog dla stat calls) konwertuje na URL param. **Prefix `!` jeśli `included===false`** (negacja).

#### Typy filtrów → URL param

| Filter type | URL param | Format value | Uwagi |
|---|---|---|---|
| `unit` | **`unit_tier_numitems_unique`** | `{api}-{star}_{tier}_{numItems}` | Domyślnie `.*_.*` jeśli brak opcji level/items. `star` = 1/2/3. `tier` = 1/2/3 (item tier build). `numItems` = 0..3. Obsługuje regex `.*` i CSV `1,2`. |
| `item` (standalone) | **`item_unique`** | `{itemApi}` | Bez unit context |
| `item` z opcją unit | **`unit_item_unique`** | `{unitApi}-{star}%26{itemKey}` | `%26` = URL-encoded `&` |
| `augment` | **`augment`** lub **`augment{slotIdx}`** | `{augmentApi}` | Gdy option.value set → `augment0/1/2` dla slotu |
| `headliner_trait` | **`headliner_trait`** | `{apiName}` lub `{key}` | TFT set mechanic |
| `portal` | **`portal`** | `{key}` | Set-specific |
| `encounter` | **`encounter`** | `{key}` | Set-specific |
| `level` (range) | **`level`** | `{min}-{max}` | Np. `7-any`, `8-8`, `6-8`. `any` = wildcard. |
| `level` (single) | **`level`** | `{key}` | Fallback |
| `extra_traits` | **`extra_traits`** | `{traitKey}_{count}` lub `{key}` | Dodatkowe traity (nie-base) |
| `tags` | **`tags`** | `{key}` | Meta tags (fast9, reroll, …) |
| `no_traits` | **`no_traits`** | `{key}` | Wykluczenie traitu |
| `no_filter` | **`no_filter`** | `{key}` | Exclusion marker |
| `trait` | **`trait`** | `{traitApi}_{breakpoint}` lub CSV | Split `,` → multiple `{key}_N` entries |
| `count` (see below) | `{count_type}` | `{min}-{max}` | Każdy count-type to osobny param |
| dowolny inny | `{type}` | `{key}` | **Passthrough**: `p.append(b.type, prefix+b.key)` |

#### Count filters (min-max range)

Każdy jest osobnym URL paramem; format value = `{min}-{max}` (`any` = unlimited). Domyślnie `1-any`.

| Param | Opis |
|---|---|
| `1_cost_count` … `5_cost_count` | Liczba unitów danego kosztu |
| `3_star_count`, `4_star_count` | Ilość 3★/4★ unitów |
| `radiant_count` | Radiant items |
| `artifact_count` | Artifact items |
| `emblem_count` | Emblem items (craftowane spatulą) |
| `normal_item_count` | Zwykłe 3-component items |
| `tactician_item_count` | Tactician (hatbox) items |
| `duplicate_unit_count` | Duplikaty na boardzie |
| `bronze_trait_count` | Active bronze-tier traits |
| `extra_traits_count` | Niebazowych traitów |
| `trait_item_count` | Trait-specific items |
| `unit_item_count` | Total itemów na unitach |
| `unit_itemtype_count` | Distinct item types |

Przykład: `?3_cost_count=2-4&4_star_count=1-any&radiant_count=0-0`

#### AND / OR / NOT groups (filter composition)

Filter state ma strukturę drzewa z grupami:
```js
{
  type: "or_group" | "and_group",
  id: "or_abc123",
  included: true | false,      // false = whole group negated
  filters: [ ...child filters or nested groups ]
}
```

- `or_group` → wszystkie child filters są OR-owane
- `and_group` → AND (default toplevel)
- `included: false` na grupie = NOT całej grupy
- Nesting dowolnie głęboki

URL encoding grup to osobna ścieżka — używa `FilterGroupOr` / `FilterGroupAnd` markerów + `START_OR` tokenów (widziane w `b.type==="or_group"` handlerze, ale dokładny format trzeba wyciągnąć z dodatkowej analizy gdyby trzeba było składać złożone zapytania programowo).

#### Patch comparison mode (`b_patch`)

Explorer ma tryb A/B między patchami. Filter value jest w formacie `{normal_value}_{patch_b}`, serializer splituje:
```js
Ue.push(F + "=" + jt[0]);        // normal filter
Ue.push("b_patch=" + jt[1]);     // second patch for comparison
```
Serwer zwraca dwa histogramy — jeden dla current `patch`, drugi dla `b_patch`. Użycie: porównanie win rate unitów między patchami.

#### Negacja `!` prefix

Wszystkie filtry honorują `!` prefix w value gdy `b.included===false`:
- `unit_tier_numitems_unique=!TFT17_X-1_.*_.*` = "wszystko oprócz X"
- `trait=!TFT17_ADMIN_2` = "bez ADMIN breakpoint 2"
- Działa też dla count filters, augmentów, itd.

---

### Region filter

Widziane jako osobny parametr / wartości `server` filtra. **15 regionów** (z `serverReverseMapping` w bundle):

`BR1, EUN1, EUW1, JP1, KR, LA1, LA2, ME1, NA1, OC1, PH2, RU, SG2, TH2, TR1, TW2, VN2`

Użycie w `/tft-explorer-api/server` response (breakdown) albo jako filtr `server={region}` (po analogii do `rank`).

### Explorer tabs (frontend)

Explorer UI (`/explorer`) ma taby: `units`, `items`, `traits`, `augments`. **Brak osobnego taba "comps" / "builds"** — "Builds (3 items)" to wynik filtrów na unit tier/numitems (`unit_tier_numitems_unique=X-1_.*_3`), a comps live pod osobną route `/comps` używając `tft-comps-api`, nie explorera.

---

## `tft-explorer-predictions` — ML predictions (WIP?)

### `GET /popular?tft_set=TFTSet17`
Cached popular filter suggestions:
```json
{
  "current_filters": {"parsed": [], "raw": []},
  "metadata": {"avg_frequency": 237, "days_analyzed": 2, "tft_set": "TFTSet17", "total_frequency": 711, "total_suggestions": 3},
  "popular_queries": {"parsed": [...], "raw": [...]}
}
```

### `GET /prediction?tft_set=TFTSet17&unit_tier_numitems_unique={filter}&top_k=3&format=full&composite=true`

**Status: niestabilne na Set 17.**
- `composite=true` → 500 `"No predictions from either model"`
- `composite=false` → 200 ale `predictions.parsed: []` (pusto)

Model prawdopodobnie jeszcze się nie wytrenował dla Set 17.

---

## `data.metatft.com/lookups` — static i18n + game data

| URL | Zawartość |
|---|---|
| `/lookups/TFTSet17_latest_en_us.json` | 1MB — items, units, traits, augments (apiName → name, desc, icon). **Live Set 17.** |
| `/lookups/TFTSet17_pbe_en_us.json` | PBE wariant |
| `/lookups/latest_TFTSet17_tables.json` | 400KB — augmentOdds, gameplay tables |
| `/lookups/pbe_TFTSet17_tables.json` | PBE tables |
| `/lookups/latest_TFTSet{N}_tables.json` | historia set 10..16 |
| `/lookups/trait_mapping.json` | human → apiName alias (np. `shepherd → TFT17_SummonTrait`) |
| `/unit_descriptions.json` | cross-set unit descriptions (legacy format) |
| `/locales/` | `en_us`, `en_gb`, ... lokalizacje |

---

## `api.metatft.com` — user/profile/spectate

Nie używane przez scout, tylko dla kompletności:

| Endpoint | Cel |
|---|---|
| `/tft-usercontent/user` | anonymous JWT (1h exp) |
| `/tft-usercontent/user/patreon*` | linkowanie Patreon |
| `/tft-usercontent/session/generate_code` | cross-device sync |
| `/public/profile/lookup/` | profile search |
| `/public/profile/lookup_by_puuid/` | puuid lookup |
| `/public/profile/lookup_by_riotid/` | riotid lookup |
| `/public/profile/refresh/` | force refresh match history |
| `/public/profile/rating_changes/` | LP history |
| `/public/search/` | global search |
| `/public/promotion_thresholds/latest` | LP dla promocji ranku |
| `/tft-leaderboard/v1` | leaderboard (pusty list gdy brak params) |
| `/tft-spectate/launch/`, `/launch_replay/`, `/summoner_by_puuid/` | spectate integration |
| `/tft-vods/latest` | vods |
| `/match_data` | POST-only (405 na GET) |
| `/referral`, `/error`, `/get_uuid` | meta |
| `/live-translations-api/locales/` | dynamic i18n |

---

## Port guidance dla `MetaTftClient.php`

**Obecne bugi (2026-04-15 sync result: units=63, traits=102, comps=59, affinity=0, companions=0):**

1. **Queue = `RANKED`** działa dla bulk, ale semantycznie poprawna wartość to `"1100"`. Obie dają Set 17 live.
2. **Brak `rank` param w explorer calls** → `/traits`, `/units_unique`, `/unit_items_unique` zwracają mały/pusty sample → `affinity=0, companions=0`. Fix: dodać `rank=CHALLENGER,DIAMOND,EMERALD,GRANDMASTER,MASTER,PLATINUM` do explorer.
3. **Brak `formatnoarray=true&compact=true`** w explorer. Frontend wysyła zawsze — nie wiadomo czy wpływa na shape, ale warto zgodność.
4. **Brak `days=1`** override dla explorer calls (memory wspominała, sprawdzić czy jest w kodzie).

**Nowe możliwości do integracji:**
- `/latest_cluster_id` — tanie sprawdzenie czy wygenerowano nowy cluster → rebuild meta comps tylko na zmianę.
- `/units_distribution` — units × numItems histogram bezpośrednio z serwera (zamiast aggregacji z explorer).
- `/total` — poprawny denominator dla frequency calc (obecnie liczymy z `/units_unique` null-row, co działa ale jest mniej explicit).

---

## Data recipes — testowane zapytania per use case

Wszystkie zweryfikowane live 2026-04-15, wartości liczbowe to real sample. `BASE` = `formatnoarray=true&compact=true&queue=1100&patch=current&days=3&rank=CHALLENGER,DIAMOND,EMERALD,GRANDMASTER,MASTER,PLATINUM&permit_filter_adjustment=true`.

### Pułapki agregacji

- **`/total` z filtrem zwraca `placement_count[]` ale `total_games/avg_placement=null`** — klient MUSI sam agregować (`games = Σ places`, `avg = Σ(i+1)*places[i]/games`).
- **`/tft-stat-api/units` liczy pickups (turn-level)**, nie unique games. Ivern 729k "games" to pickups w całej grze, nie 729k unikalnych matchy. Do denominatora frequency **nie używać** bulk — użyć `/tft-explorer-api/units_unique` (unique per match) lub `/total`.
- **Level filter (`level=7-7`) nie działa na `/total`** — zwraca 0. Prawdopodobnie obsługiwane tylko w `comps_data` clusteringu, nie w per-game explorer.

### Champion page (przykład: Aatrox)

| Dana | Endpoint + filter | Przykład |
|---|---|---|
| Overall games/avg/win% | `GET /tft-explorer-api/total?$BASE&unit_unique=TFT17_Aatrox-1` | `games=30018, Σ places` |
| Per-star tier breakdown | `GET /tft-explorer-api/units_unique?$BASE&unit_unique=TFT17_Aatrox-1` | `Aatrox-1: 30018, -2: 66, -3: 1` |
| Top trait synergies | `GET /tft-explorer-api/traits?$BASE&unit_unique=TFT17_Aatrox-1` | `ResistTank:21975, HPTank:18069, DRX:17734, Shen:13583, Melee:12662` |
| Top single items (1-slot) | `GET /tft-explorer-api/unit_items_unique/TFT17_Aatrox-1?$BASE` | RedBuff, ThiefsGloves, GargoyleStoneplate |
| Top 3-item builds | `GET /tft-explorer-api/unit_builds/TFT17_Aatrox?$BASE` | `Bloodthirster\|SteraksGage\|TitansResolve` (151 games, avg 4.1) |
| Meta comps containing | `GET /tft-comps-api/comps_data?queue=1100&region_hint=eun1` + filter `units_string contains "TFT17_Aatrox"` | 5+ clusters |

**Uwaga o `unit_builds`:** klucz może mieć 1, 2 lub 3 itemy split `|`. ThiefsGloves i Emblem itemy występują solo (`TFT17_Aatrox&TFT_Item_ThiefsGloves` bez `|`). Reguła: liczba itemów = `(key.split("|").length)` dla części po `&`.

### Trait page (przykład: TFT17_ADMIN)

| Dana | Endpoint + filter |
|---|---|
| Overall per breakpoint | `GET /tft-explorer-api/traits?$BASE` → filter `traits.startsWith("TFT17_ADMIN")` → [`ADMIN_1: 8853, ADMIN_2: 8700`] |
| Total trait any-breakpoint | `GET /tft-explorer-api/total?$BASE&trait=TFT17_ADMIN_.*` (regex wildcard) → 16586 games |
| Exact breakpoint | `GET /tft-explorer-api/total?$BASE&trait=TFT17_ADMIN_2` → 8225 games |
| Best units running trait | `GET /tft-explorer-api/units_unique?$BASE&trait=TFT17_ADMIN_2` → Leona, Leblanc, Illaoi top 3 |
| Meta comps using trait | `comps_data` + filter `traits_string contains "TFT17_ADMIN"` |

### Item page (przykład: Guinsoo's Rageblade)

**KRYTYCZNE:** `item_unique` param wymaga suffixu `-{slot}` (zawsze `-1`). Bez niego zwraca 0.

| Dana | Endpoint + filter |
|---|---|
| Overall games with item | `GET /tft-explorer-api/total?$BASE&item_unique=TFT_Item_GuinsoosRageblade-1` → 64911 games |
| Best holders | `GET /tft-explorer-api/units_unique?$BASE&item_unique=TFT_Item_GuinsoosRageblade-1` → Nunu(27k), Shen(25k), Morde(24k) |
| Top 3-item builds containing item | brak bezpośredniego endpointu; filter po `/unit_builds/{api}` response → `unit_builds.contains("GuinsoosRageblade")` |
| Cross-item synergy | `GET /tft-explorer-api/total?$BASE&item_unique=X-1&item_unique=Y-1` (AND) |

### Algorytm scout

| Dana | Endpoint |
|---|---|
| Bulk per-unit histogram | `/tft-stat-api/units?queue=1100&days=3` (63 units) |
| Bulk per-trait histogram | `/tft-stat-api/traits?queue=1100&days=3` (102 rows z `_N` breakpoint) |
| Bulk per-item histogram | `/tft-stat-api/items` (set items) + `/items_matches` (standard items) |
| Units × numItems breakdown | `/tft-stat-api/units_distribution?queue=1100&days=3` (direct — bez post-agregacji) |
| Board strength percentiles | `/tft-stat-api/percentiles?queue=1100&days=3` |
| Meta comps clusters | `/tft-comps-api/comps_data?queue=1100&region_hint=eun1` + per-cluster: `comp_builds`, `comp_options`, `comp_augments` (wymagają `cluster_id`) |
| Cluster invalidation ping | `/tft-comps-api/latest_cluster_id?queue=1100` (60B response, cheap) |
| Affinity per champion | `/tft-explorer-api/traits?$BASE&unit_unique={api}-1` (WYMAGA `rank`!) |
| Companions per champion | `/tft-explorer-api/units_unique?$BASE&unit_unique={api}-1` (WYMAGA `rank`!) |

### Filter combinacje

| Cel | Filter |
|---|---|
| NOT unit | `unit_unique=!TFT17_MissFortune-1` (additive: !X + X = total ✓) |
| AND multi-unit | `unit_unique=TFT17_Aatrox-1&unit_unique=TFT17_Shen-1` (Aatrox+Shen razem: 14472 games) |
| Regex star/tier wildcard | `unit_tier_numitems_unique=TFT17_Aatrox-1_.*_3` (dowolny tier, dokładnie 3 itemy = 1778 games) |
| CSV multi-value | `unit_tier_numitems_unique=TFT17_Aatrox-1_1,2_.*` (tier 1 lub 2) |
| Cost constraint (fast9) | `4_cost_count=5-any` (5+ 4-cost unitów na boardzie: 2104 games) |
| Trait regex across breakpoints | `trait=TFT17_ADMIN_.*` |

### Niepotwierdzone / problemy

- **`level=` filter** → zwraca 0 na `/total` i `/units_unique`. JS buduje `level=7-any` format ale backend pewnie honoruje tylko w innym kontekście (może w `comps_data` post-filter `levelling`).
- **`tft-explorer-predictions/prediction`** → 500 z `composite=true`, pusty `[]` bez. Model niegotowy dla Set 17.
- **`comp_builds/options/augments`** → 500 nawet z poprawnym `cluster_id=400000` z `latest_cluster_id`. Frontend nie wywołuje ich z explorer route — prawdopodobnie wymagają innego kontekstu (session state? cluster generation lock?).
- **`unit_items_processed`** → stały cache cross-set TFT16+TFT17, ignoruje params. Deprecated, nie używać.
