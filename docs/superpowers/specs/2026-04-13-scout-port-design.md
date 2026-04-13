# Scout Port — Design Spec

**Date:** 2026-04-13
**Author:** Brainstorm session with Borcioo
**Status:** Approved, ready for implementation plan

## Goal

Port the legacy TFT Scout algorithm (Node+SQLite, ~1600 lines) to the new
Laravel 13 + Postgres + Inertia/React app at `D:\Herd\tft-scout`. The
algorithm runs in a browser Web Worker — never on the backend. Backend
serves a one-time data bundle + handles MetaTFT sync. Port is 1:1 to
preserve battle-tested behaviour from the legacy implementation.

## Non-goals (MVP scope cut)

The following legacy features are intentionally deferred to a post-MVP
iteration — they add code and UI complexity without blocking "scout
works end-to-end":

- Lazy-loaded transitions ("what's on the path to this comp")
- Road-to ("step-by-step buy order for target comp")
- Rich insights (emblem opportunities, vertical potential breakdown)
- Meta-comp match enrichment beyond a plain "this matches X" badge

The algorithm still produces the data these features would consume,
so adding them later is additive — no refactoring of core engine.

## Decisions captured during brainstorm

| # | Decision | Rationale |
|---|---|---|
| 1 | **Algorithm lives in a Web Worker**, not backend | User explicit: "zabije server". Matches legacy deployment shape. |
| 2 | **Full algorithm port + MetaTftImporter** (option A) | User wants the legacy scout behaviour, not a lite version. MetaTFT data is what makes scoring meaningful. |
| 3 | **1:1 JS→TS port**, minimal types at boundaries only | Legacy has been iterated ~1000× on real gameplay — it's the source of truth. Refactoring risks regressions we'd never catch without tests. |
| 4 | **Hybrid MetaTFT sync**: batch via Artisan + stale-while-revalidate organic refresh | User picked C. Predictable debug, consistent with existing `CDragonImporter` pattern, still self-refreshing. |
| 5 | **MVP UI scope**: locks + level + topN → result cards | User said adapt UI to new site's shadcn/Tailwind style, not copy legacy 1:1. Insights/transitions/road-to deferred. |
| 6 | **No unit tests for port v1** | 1:1 port + legacy has no tests. Verification via manual parity check. Add tests kierunkowo when tuning weights later. |

## Architecture

```
┌─────────────────────┐        ┌──────────────────────┐
│  Laravel backend    │        │   Frontend (React)   │
│                     │        │                      │
│  CDragon import     │        │  /scout page         │
│  MetaTftSync (cmd)  │        │     │                │
│  ScoutController    │ bundle │     ▼                │
│   ├─ bundle (GET)   │───────▶│  useScoutWorker()    │
│   └─ refresh (POST) │        │     │                │
│                     │◀───────│     ▼                │
│  Postgres:          │ POST   │  Web Worker          │
│   champions/traits  │ params │   engine             │
│   ratings/affinity  │        │   synergy-graph      │
│   companions/meta   │        │   scorer             │
│   meta_syncs        │        │   config             │
└─────────────────────┘        └──────────────────────┘
```

### Three layers

1. **MetaTFT sync (PHP)** — `php artisan metatft:sync --set=17` populates
   `champion_ratings` / `trait_ratings` / `champion_trait_affinity` /
   `champion_companions` / `meta_comps`. Stamps `meta_syncs` table with
   timestamp. Hybrid refresh: if last sync >24h and a scout request
   arrives, dispatch `RefreshMetaTftJob` via queue (non-blocking) and
   return current data immediately with `stale: true` flag.

2. **Scout data endpoint (PHP)** — `ScoutController::index()` renders
   `Scout/Index.tsx` with the full scout bundle as an Inertia prop, so
   the bundle arrives with the initial page load (no extra fetch).
   `ScoutBundleBuilder` is the single place that joins all the tables
   into the shape the worker expects.

3. **Algorithm + UI (TS/React)** — Web Worker is long-lived. It
   initialises with the bundle once, then handles scout requests via
   `{type:'run', params}`. Main thread (React) manages param state and
   result rendering. Worker is dependency-free (no libraries, plain TS).

## Backend components

```
app/Services/MetaTft/
  ├── MetaTftClient.php          — HTTP client (fetch, retry, rate limit)
  ├── MetaTftSync.php            — orchestrator, idempotent upsert
  └── Dto/
      ├── UnitRatingDto.php
      ├── TraitRatingDto.php
      └── MetaCompDto.php

app/Services/Scout/
  └── ScoutBundleBuilder.php     — builds bundle from DB + stale check

app/Console/Commands/
  └── MetaTftSync.php            — `php artisan metatft:sync [--set=17]`

app/Http/Controllers/
  └── ScoutController.php        — index() renders Inertia with bundle

app/Jobs/
  └── RefreshMetaTftJob.php      — queued stale-while-revalidate job

database/migrations/
  └── 2026_04_13_150000_create_meta_syncs_table.php
```

### `meta_syncs` schema

```
id              bigserial PK
set_id          FK → sets
synced_at       timestamptz
units_count     int
traits_count    int
affinity_count  int
companions_count int
meta_comps_count int
status          varchar(20)     ('ok'|'partial'|'failed')
notes           text nullable
```

Bundle endpoint reads `MAX(synced_at) WHERE status = 'ok'` and sets
`stale` flag if >24h.

### MetaTFT client

The exact endpoints and payload shape are extracted from
`legacy/tft-generator/server/src/services/ratings.service.js` during
writing-plans. Assumptions until verified:

- REST JSON API
- Rate limit ~1 req/sec (Laravel native `RateLimiter::attempt()`)
- Retry with exponential backoff on 5xx
- One sync covers all champions + traits + meta-comps in one pass

If the MetaTFT API is unreachable or dead:
- `MetaTftSync` marks latest `meta_syncs` row as `failed` with notes
- `ScoutBundleBuilder` falls back to empty ratings — algorithm still runs
  with `style_scores` from `trait_styles` table as the only scoring
  signal. Worse ranking but functional.
- User can still manually populate tables from an exported JSON if needed.

### Scout bundle shape

`ScoutBundleBuilder::build(int $setId): array`:

```php
[
  'champions' => [
    ['api_name' => 'TFT17_Aatrox', 'name' => 'Aatrox', 'cost' => 4,
     'traits' => ['TFT17_DarkStar', 'TFT17_AssassinTrait'],
     'slots_used' => 1, 'is_playable' => true,
     'base_champion_api_name' => null, 'variant_label' => null,
     'stats' => [...],
     'icon_path' => 'icons/champions/TFT17_Aatrox.png',
     'ability_icon_path' => 'icons/abilities/TFT17_Aatrox.png'],
    // ...
  ],
  'traits' => [
    ['api_name' => 'TFT17_DarkStar', 'name' => 'Dark Star',
     'category' => 'public',
     'breakpoints' => [
       ['min_units' => 2, 'max_units' => 2, 'style' => 'Bronze'],
       ['min_units' => 4, 'max_units' => 4, 'style' => 'Silver'],
       ['min_units' => 6, 'max_units' => 6, 'style' => 'Gold'],
       ['min_units' => 9, 'max_units' => 25000, 'style' => 'Prismatic'],
     ],
     'icon_path' => 'icons/traits/TFT17_DarkStar.png'],
    // ...
  ],
  'ratings' => [
    'units'      => ['TFT17_Aatrox' => ['avgPlace' => 4.2, 'winRate' => 0.12, 'games' => 820], ...],
    'traits'     => ['TFT17_DarkStar' => [['minUnits' => 4, 'avgPlace' => 4.0, 'games' => 500], ...], ...],
    'affinity'   => ['TFT17_Aatrox'  => [['trait' => 'TFT17_DarkStar', 'avgPlace' => 3.8, 'games' => 300], ...], ...],
    'companions' => ['TFT17_Aatrox'  => [['companion' => 'TFT17_Jinx', 'avgPlace' => 3.5, 'games' => 180], ...], ...],
    'meta_comps' => [
      ['id' => 'dark-star-9', 'champs' => [...], 'traits' => ['TFT17_DarkStar'], 'avgPlace' => 1.18, 'games' => 85],
      // ...
    ],
  ],
  'style_scores' => [
    'Bronze' => 0.22, 'Silver' => 0.44, 'Unique' => 0.67,
    'Gold'   => 1.20, 'Prismatic' => 1.50,
  ],
  'exclusion_map' => [
    // base api_name → list of variant api_names that are mutually
    // exclusive (MF Conduit/Challenger/Replicator, Mecha Enhanced variants)
    'TFT17_MissFortune' => ['TFT17_MissFortune_conduit', 'TFT17_MissFortune_challenger', 'TFT17_MissFortune_replicator'],
    'TFT17_Galio' => ['TFT17_Galio_enhanced'],
    // ...
  ],
  'synced_at' => '2026-04-13T12:34:56Z',
  'stale' => false,
]
```

Rough size: 500-800 KB uncompressed JSON, ~100 KB gzipped. Fits in a
single Inertia prop without perf concerns.

## Frontend components

```
resources/js/workers/scout/
  ├── index.ts               — worker entry point (onmessage handler)
  ├── engine.ts              — ported from legacy/algorithm/engine.js
  ├── synergy-graph.ts       — ported from synergy-graph.js (789 lines)
  ├── scorer.ts              — ported from scorer.js
  ├── config.ts              — ported from config.js (weights + thresholds)
  ├── candidates.ts          — ported from candidates.js
  ├── insights.ts            — ported from insights.js (MVP minimum)
  ├── helpers.ts             — ported from scout-helpers.js
  └── types.ts               — boundary types

resources/js/hooks/
  └── use-scout-worker.ts    — worker lifecycle + message hook

resources/js/pages/Scout/
  └── Index.tsx              — main scout page

resources/js/components/scout/
  ├── ScoutControls.tsx          — level, topN, max5Cost, roleBalance
  ├── LockedChampionsPicker.tsx  — multi-select champions
  ├── LockedTraitsPicker.tsx     — multi-select traits + breakpoint
  ├── EmblemPicker.tsx           — trait → emblem count
  ├── ScoutResultsList.tsx       — grid of comp cards
  └── ScoutCompCard.tsx          — one comp card (portraits + traits + score)
```

### Worker message protocol

```typescript
type InMsg =
  | { type: 'init'; bundle: ScoutBundle }
  | { type: 'run'; requestId: number; params: ScoutParams }
  | { type: 'cancel'; requestId: number };

type OutMsg =
  | { type: 'ready' }
  | { type: 'progress'; requestId: number; phase: string; percent: number }
  | { type: 'result'; requestId: number; teams: ScoredTeam[] }
  | { type: 'error'; requestId: number; message: string };
```

- `requestId` lets the main thread drop stale results when the user
  changes params faster than the algorithm completes.
- Cancellation is cooperative: engine checks a flag between phases and
  bails gracefully. Worst-case latency ~1 phase (~50-100 ms).

### Boundary types (`workers/scout/types.ts`)

```typescript
export type Champion = {
  apiName: string;
  name: string;
  cost: number;
  traits: string[];
  slotsUsed: number;              // 2 for Mecha Enhanced
  isPlayable: boolean;
  baseChampionApiName: string | null;
  stats: { hp: number; ad: number; /* ... */ };
  iconPath: string;
  abilityIconPath: string;
};

export type Trait = {
  apiName: string;
  name: string;
  category: 'public' | 'unique';
  breakpoints: {
    minUnits: number;
    maxUnits: number;
    style: 'Bronze' | 'Silver' | 'Gold' | 'Prismatic' | 'Unique';
  }[];
};

export type ScoutBundle = {
  champions: Champion[];
  traits: Trait[];
  ratings: {
    units: Record<string, { avgPlace: number; winRate: number; games: number }>;
    traits: Record<string, { minUnits: number; avgPlace: number; games: number }[]>;
    affinity: Record<string, { trait: string; avgPlace: number; games: number }[]>;
    companions: Record<string, { companion: string; avgPlace: number; games: number }[]>;
    metaComps: { id: string; champs: string[]; traits: string[]; avgPlace: number; games: number }[];
  };
  styleScores: Record<string, number>;
  exclusionMap: Record<string, string[]>;
  syncedAt: string;
  stale: boolean;
};

export type ScoutParams = {
  lockedChampions: string[];
  excludedChampions: string[];
  lockedTraits: { apiName: string; minUnits: number }[];
  excludedTraits: string[];
  emblems: Record<string, number>;
  level: number;
  topN: number;
  max5Cost: number;
  roleBalance: boolean;
};

export type ScoredTeam = {
  champions: string[];
  score: number;
  activeTraits: { apiName: string; count: number; style: string }[];
  components: {
    championScore: number;
    traitScore: number;
    provenBonus: number;
    affinityBonus: number;
    companionBonus: number;
    penalties: number;
  };
};
```

### UI layout (adapted to shadcn/Tailwind)

Desktop (≥1024px) — 3-column layout:
- **Left sticky sidebar**: `ScoutControls` (level slider, topN stepper,
  max5Cost, roleBalance toggle, "Run scout" button), progress bar
- **Center**: `ScoutResultsList` — grid of comp cards (2 columns). Each
  card shows champion portraits (48×48), active traits as colored
  chips (reuse `STYLE_STYLES` from Traits/Index), total score, optional
  avgPlace from MetaTFT
- **Right**: `LockedChampionsPicker` + `LockedTraitsPicker` +
  `EmblemPicker` — accordion or tabs

Mobile: stack vertically, sticky bottom bar with "Run" + topN.

Debounce: 300 ms on slider/stepper changes; immediate on toggles/locks.
First page open auto-runs with defaults (level=8, topN=15).

## Algorithm port mapping

| Legacy (JS) | New (TS) | Notes |
|---|---|---|
| `algorithm/engine.js` (170L) | `workers/scout/engine.ts` | Orchestrator |
| `algorithm/synergy-graph.js` (789L) | `workers/scout/synergy-graph.ts` | Graph + 8 phases + beam |
| `algorithm/scorer.js` (388L) | `workers/scout/scorer.ts` | Full scoring |
| `algorithm/config.js` (46L) | `workers/scout/config.ts` | Weights, thresholds |
| `algorithm/candidates.js` (83L) | `workers/scout/candidates.ts` | Filters, exclusion lookup |
| `algorithm/insights.js` (150L) | `workers/scout/insights.ts` | MVP minimum only |
| `scout-helpers.js` | `workers/scout/helpers.ts` | Utility functions |
| `services/scout.service.js` | `workers/scout/index.ts` | Worker entry |

Variable names and function names stay identical to legacy —
`buildOneTeam`, `applyEmblems`, `expandFromSeeds`, `temperatureSweep`,
`quickScore`, `fullScore`. Renaming is regression risk.

Dependency-free: no lodash, no fp-ts, just plain TS.

## Data flow (happy path)

```
1. User opens /scout
   └─ ScoutController@index:
      ├─ ScoutBundleBuilder::build(setId=17)
      ├─ checks max(meta_syncs.synced_at)
      ├─ if >24h → dispatch(RefreshMetaTftJob) (non-blocking)
      └─ returns Inertia with bundle prop

2. Scout/Index.tsx mount
   ├─ useScoutWorker() spawns worker
   ├─ worker.postMessage({type:'init', bundle})
   ├─ worker responds {type:'ready'}
   └─ auto-run with defaults (level=8, topN=15)

3. User changes locked champions
   ├─ setState(params) + debounce 300ms
   └─ worker.postMessage({type:'run', requestId:42, params})

4. Worker engine.generate(bundle, params):
   ├─ Phase 1: temperature sweep (yield progress 1/8)
   ├─ Phase 2: trait-seeded (yield progress 2/8)
   ├─ ...
   ├─ Phase 8: hill climbing (yield progress 8/8)
   ├─ scorer.fullScore() for top N
   └─ postMessage({type:'result', requestId:42, teams})

5. Main thread renders ScoutResultsList
```

## Testing strategy

**Zero unit tests for v1.** Verification via manual parity check —
run scout with same params against legacy node reference implementation
(user's original app still runs) and compare top-10 results informally.

**Two sanity tests only:**

1. PHPUnit integration test on `ScoutBundleBuilder::build()` — asserts
   bundle has all top-level keys and non-empty `champions` / `traits`
   arrays. Catches schema regressions when migrations change.

2. Manual smoke test: dev server, click scout, verify worker ready
   message fires and results list renders ≥1 comp. Not automated.

Directional tests get added when tuning weights, not up front.

## Risks + mitigations

| # | Risk | Mitigation |
|---|---|---|
| 1 | MetaTFT API might not exist or have changed endpoints | During writing-plans, extract exact URLs from legacy `ratings.service.js`. If dead, fall back to empty ratings — algorithm still runs on `style_scores` only, worse ranking. Manual population via SQL possible. |
| 2 | JS→TS port introduces subtle regressions (mutable state, `this` binding, falsy checks) | Literal port, same names, same operators. Side-by-side reading during writing-plans review. Zero refactoring. |
| 3 | Bundle size (500-800 KB) blocks page load | Gzipped ~100 KB over wire. Parsed once on mount. Passed to worker via structured clone, not re-parsed. |
| 4 | Worker startup time (~200-500 ms) annoys user | Worker spawned in `useEffect` mount, ready before user clicks "Run". First auto-run triggers after ready. |
| 5 | Exclusion groups — new schema uses `base_champion_id`, legacy used `exclusion_groups` table | `ScoutBundleBuilder` precomputes `exclusion_map` shape the worker expects. Worker doesn't touch DB, just reads the map. |
| 6 | Mecha Enhanced 2× slot behaviour in beam building | Reuse logic from legacy `applyEmblems` + `slots_used`. Bundle builder sets `slotsUsed: 2` for enhanced variants. Beam build counts `slotsUsed` toward trait breakpoint math. |
| 7 | Synthetic variants (MF, Hero, Mecha Enhanced) — scout visibility | Bundle includes all `is_playable = true` champions. MF base (`is_playable = false`) excluded. Exclusion map prevents multiple variants of the same base in one comp. |

## Scope in numbers

| | Backend lines | Frontend lines | Files |
|---|---|---|---|
| Algorithm port | 0 | ~1600 (legacy copy) | +8 ts |
| MetaTftImporter | ~600 (client + sync + command + job) | 0 | +7 php + 1 migration |
| Bundle builder + controller | ~250 | 0 | +2 php |
| Worker infra + hook | 0 | ~150 | +2 ts |
| UI (Scout page + components) | 0 | ~600-800 | +7 tsx |
| **Total** | **~850 PHP** | **~2400 TS/TSX** | **~27 files** |

No existing feature touched — scout is a new vertical slice. Can be
developed in parallel with other work.

## Recommended implementation order

1. **MetaTFT sync backend** (command + client + sync + migration + queue job)
2. **ScoutBundleBuilder + endpoint** — manual GET sanity check
3. **Worker skeleton + `useScoutWorker` hook** — postMessage plumbing
4. **Port `config` / `types` / `helpers`** — small safe files first
5. **Port `candidates` + `scorer`** — independently testable
6. **Port `synergy-graph`** — the 789-line beast, last algorithm piece
7. **Port `engine` + `insights` (MVP)** — everything wired together
8. **UI — Scout page + components** — now there's something to render
9. **Polish** — debouncing, loading states, error handling, styling

## Out of scope for this spec

Anything in `docs/schema-plan.md` that wasn't required by the scout is
left alone. The scout port must not reshuffle existing tables — it adds
new tables (`meta_syncs`) and populates existing empty ones
(`champion_ratings`, etc.).
