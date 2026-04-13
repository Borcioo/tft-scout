# MetaTFT API — Endpoint Catalogue

> Extracted 2026-04-13 from `legacy/tft-generator/server/src/services/ratings.service.js`,
> `docs/legacy/specs/2026-04-03-scoring-refactor-design.md`,
> `docs/legacy/specs/2026-04-06-v2-implementation-plan.md`, and
> `docs/superpowers/plans/2026-04-13-scout-port-plan.md` (task A4 stub).
>
> Used by: **A4 MetaTftClient**, **A5 MetaTftSync**, **A3 DTOs**.

---

## Base URL

```
https://api.metatft.com/tft-comps-api/public/v1
```

**Notes:**
- The legacy Node source (`server/src/`) only stores the *cache-key name* of each endpoint
  (e.g. `'units'`, `'explorer/traits'`). The actual HTTP client (`metatft-cache.js`) was
  not committed to the `legacy/` snapshot — it was injected as a dependency at startup.
- The base URL above comes from the task A4 stub in `2026-04-13-scout-port-plan.md` (line 466).
  The early v1 importer (`docs/legacy/plans/2026-04-03-scoring-refactor.md`) used
  `https://METATFT_API_REDACTED/tft-stat-api/` — the domain is the same host, the path
  prefix changed between v1 and v2 of the internal API.
- When Set 17 goes live on retail `queue` changes from `PBE` → `RANKED`.

---

## Endpoints

All endpoints are reached as `GET {BASE_URL}/{endpoint}?{params}`.

### 1. `units` — Champion placement ratings

```
GET /units
```

**Params used in legacy:**

| Param | Value | Notes |
|-------|-------|-------|
| *(none beyond base defaults)* | | legacy calls `metatftCache.fetch('units')` with no extra params |

**Early v1 default params** (from `docs/legacy/plans/2026-04-03-scoring-refactor.md`):
```
queue=PBE&patch=current&days=3&permit_filter_adjustment=true
```

**Response shape (v1, from `ratings.mapper.js`):**
```json
{
  "results": [
    { "unit": "TFT17_Aatrox", "places": [15992, 17028, 14821, 13219, 10284, 7522, 4991, 2101] }
  ]
}
```
- `places[i]` = count of games finishing at position `i+1` (1st through 8th)
- `unit` = champion apiName

**Aggregation target:** `unit_ratings` table

**TTL:** 30 min (from v2 spec)

---

### 2. `traits` — Trait breakpoint ratings

```
GET /traits
```

**Params used in legacy:** same as `units` — called with no extra params beyond defaults.

**Response shape (v1):**
```json
{
  "results": [
    { "trait": "TFT17_DarkStar_1", "places": [12626, 10304, ...] }
  ]
}
```
- `trait` key format: `{traitApiName}_{breakpointPosition}` — e.g. `TFT17_DarkStar_1` = first breakpoint.
- Stargazer variants are reported separately: `TFT17_Stargazer_Serpent_1`, `TFT17_Stargazer_Wolf_1`, etc.

**Aggregation target:** `trait_ratings` table

**TTL:** 1 hour

---

### 3. `explorer/traits` — Trait affinity per champion

```
GET /explorer/traits
```

**Params (from `ratings.service.js` line 67–71):**
```js
{
  unit_unique: baseApiName + '-1',   // e.g. "TFT17_Aatrox-1"  ("-1" suffix = star level)
  formatnoarray: 'true',
  compact: 'true',
}
```

**Response shape (from `ratings.mapper.js` `affinityFromApi`):**
```json
{
  "results": [
    {
      "traits": "TFT17_DarkStar_3",
      "placement_count": [120, 89, 75, 60, 42, 28, 15, 7]
    }
  ]
}
```
- `traits` = same `{traitApiName}_{breakpointPosition}` key format as `/traits`
- `placement_count` = same `places` array shape

**Aggregation target:** `unit_trait_affinity` table

**TTL:** 6 hours (from v2 spec)

---

### 4. `explorer/units` — Companion co-occurrence per champion

```
GET /explorer/units
```

**Params (from `ratings.service.js` line 263–267):**
```js
{
  unit_unique: baseApiName + '-1',   // e.g. "TFT17_Aatrox-1"  ("-1" suffix = star level)
  formatnoarray: 'true',
  compact: 'true',
}
```

**Response shape:**

> ⚠ Unverified — confirm on first live call. `metatft-cache.js` was not committed to the
> legacy snapshot. Shape below is inferred by symmetry with `explorer/traits` and from
> the `getCompanions` aggregation in `ratings.service.js`.

```json
{
  "results": [
    {
      "unit": "TFT17_Graves",
      "placement_count": [120, 89, 75, 60, 42, 28, 15, 7]
    }
  ]
}
```
- `unit` = apiName of the companion unit that co-occurs with the queried unit
  (field name may be `companion`, `companionUnitApiName`, or similar — verify on live call)
- `placement_count` = same placement-count array shape as `explorer/traits`
- The `getCompanions` aggregation stores `{ unitApiName, companionApiName, avgPlace, games, frequency }`
  into `unit_companions`, so the raw response likely includes `avg_place` / `games` fields
  or they are derived from `placement_count` during aggregation

**Aggregation target:** `unit_companions` table

**TTL:** 6 hours (aligned with `explorer/traits`)

---

### 5. `unit_items` — Per-champion item sets

```
GET /unit_items
```

This endpoint is called with **two different param signatures** from two separate methods
in `ratings.service.js`. Each call produces a different aggregation.

---

#### Call A — Full 3-item sets (`getItemSets`, line 116)

**Params:**
```js
{ unit: baseApiName }   // e.g. "TFT17_Aatrox"
```

**Used for:** populating the `unit_item_sets` table — full recommended item combinations
per champion (3-item sets with avg placement + game count).

**Response shape:**

> ⚠ Unverified — confirm on first live call. Shape below is inferred from the
> `getItemSets` aggregation in `ratings.service.js`.

```json
{
  "results": [
    {
      "items": ["TFT_Item_RabadonsDeathcap", "TFT_Item_Shadowflame", "TFT_Item_Zhonya"],
      "avg_place": 3.72,
      "games": 412
    }
  ]
}
```
- `items` = JSON array of 3 item apiNames forming the full build
- `avg_place` = mean placement across `games` sampled games
- `games` = sample size

**Aggregation target:** `unit_item_sets` table —
shape `{ unitApiName, items (JSON array of 3 item apiNames), avgPlace, games }`

---

#### Call B — Per-item-count builds (`getItemBuilds`, line 193)

**Params:**
```js
{
  unit: baseApiName,
  num_items: '3',    // request aggregates keyed by N-item sets
}
```

**Used for:** populating the `unit_item_builds` table — likely per-N-item-count
performance aggregates (the `num_items=3` hint suggests the endpoint can return
subsets; without it, it may return per-item or mixed-size aggregates).

**Response shape:**

> ⚠ Unverified — confirm on first live call. `metatft-cache.js` was not committed to
> the legacy snapshot; exact shape is unknown. Likely similar to Call A but the
> `items` field may be keyed differently or include partial (1- and 2-item) builds
> when `num_items` is omitted.

```json
{
  "results": [
    {
      "items": ["TFT_Item_RabadonsDeathcap", "TFT_Item_Shadowflame", "TFT_Item_Zhonya"],
      "avg_place": 3.72,
      "games": 412
    }
  ]
}
```

**Aggregation target:** `unit_item_builds` table

---

**TTL (both calls):** 6 hours

---

### 6. `comps` — Meta team compositions  *(bulk sync only)*

```
GET /comps
```

**Params (v1 spec, from `docs/legacy/plans/2026-04-03-scoring-refactor.md`):**
```
queue=PBE&patch=current&days=3&permit_filter_adjustment=true&region_hint=eun1
```

**Response shape (v1):**
```json
{
  "cluster_details": {
    "<clusterId>": {
      "units_string": "TFT17_Aatrox,TFT17_Graves,...",
      "traits_string": "TFT17_DarkStar_6,...",
      "overall": { "avg": 3.31, "count": 4821 },
      "builds": { ... },
      "levelling": { ... }
    }
  }
}
```

**Aggregation target:** `meta_comps` table

**TTL:** 2 hours (from v2 spec)

---

## Authentication / Rate Limiting

**Auth:** No API key, bearer token, or `Authorization` header found in any legacy source file.
The API appears to be unauthenticated / public. No `.env` variables for MetaTFT credentials
exist in the legacy snapshot.

**Rate limiting:**
- No `p-limit`, `rateLimiter`, `throttle`, or `setTimeout` patterns found in the legacy
  `server/src/` directory.
- The legacy design uses on-demand fetching with SQLite-backed TTL caching (TTLs above)
  as the primary protection against hammering the API.
- The A4 plan stub specifies `.retry(3, 500, throw: false)` and `.timeout(30)` in the
  Laravel `Http` client — this matches a simple exponential backoff pattern.
- **Recommendation for A4:** start with 3 retries / 500 ms base delay / 30 s timeout.
  Add `sleep(1)` between bulk per-champion fetches (`explorer/traits`, `explorer/units`,
  `unit_items`) to be a polite client.

---

## Variant / Base-name Normalisation

All per-champion endpoints use the **base** apiName — variants are stripped before fetching:

```js
// From ratings.service.js (multiple methods)
const baseApiName = unitApiName.replace(/_(enhanced|conduit|challenger|replicator)$/, '');
```

So `TFT17_MissFortune_Conduit` → `TFT17_MissFortune` for all MetaTFT lookups.

---

## URL Construction (legacy `metatft-cache.js` contract)

The cache factory was **not committed** to `legacy/` — only its interface is observable:

```js
// Injected into ratings.service.js as `metatftCache`
await metatftCache.fetch(endpoint, params);
// endpoint = string like 'units', 'explorer/traits'
// params   = plain object or undefined
// returns  = parsed JSON body (already cached in metatft_cache table)
```

The factory sits at `server/src/data/metatft-cache.js` in the v2 design spec
(`docs/legacy/specs/2026-04-06-v2-implementation-plan.md`). It was injected at
`server/src/index.js` startup and never committed separately.

URL construction (reconstructed from call site evidence + v1 importer):
```
{BASE_URL}/{endpoint}?{URLSearchParams(defaultParams + callParams)}
```

---

## Summary for A4 implementor

| Endpoint | Bulk vs per-unit | Key param | Agg table |
|---|---|---|---|
| `units` | bulk | *(none)* | `unit_ratings` |
| `traits` | bulk | *(none)* | `trait_ratings` |
| `comps` | bulk | *(none)* | `meta_comps` |
| `explorer/traits` | per-champion | `unit_unique={api}-1` | `unit_trait_affinity` |
| `explorer/units` | per-champion | `unit_unique={api}-1` | `unit_companions` |
| `unit_items` | per-champion | `unit={api}`, optional `num_items=3` | `unit_item_sets` / `unit_item_builds` |
