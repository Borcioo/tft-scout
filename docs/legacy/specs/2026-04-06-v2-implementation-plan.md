# TFT Generator v2 — Implementation Plan

> Pełny rewrite. Scout-first. Nowa architektura, nowy schemat, nowe UI.
> Stary kod zostaje w repo jako referncja, nowy kod w osobnej strukturze.

## Tech stack

- **Backend:** Node.js, Express, SQLite (better-sqlite3)
- **Frontend:** React 19, Vite, Tailwind CSS, shadcn/ui
- **Algorithm:** Synergy graph + beam search (przepisany z czystą separacją warstw)

## Project structure (v2)

```
tft-generator/
├── v2/
│   ├── server/
│   │   ├── src/
│   │   │   ├── db/
│   │   │   │   ├── schema.js            — tworzenie tabel + seed
│   │   │   │   ├── connection.js         — singleton DB connection
│   │   │   │   └── migrations/           — future migrations
│   │   │   ├── data/
│   │   │   │   ├── cdragon-importer.js   — CDragon fetch + import
│   │   │   │   ├── set-hooks.js          — post-import hooks (MF, Mecha, etc.)
│   │   │   │   ├── hook-helpers.js       — addVariant, addExclusionGroup, etc.
│   │   │   │   └── metatft-cache.js      — transparent cache layer
│   │   │   ├── mappers/
│   │   │   │   ├── champion.mapper.js
│   │   │   │   ├── trait.mapper.js
│   │   │   │   ├── ratings.mapper.js
│   │   │   │   └── scout-result.mapper.js
│   │   │   ├── services/
│   │   │   │   ├── champion.service.js   — getAll, getByTrait, getWithRatings
│   │   │   │   ├── trait.service.js      — getAll, getBreakpoints
│   │   │   │   ├── ratings.service.js    — getRatings, getAffinity, refresh
│   │   │   │   └── scout.service.js      — orchestrates algorithm + data
│   │   │   ├── algorithm/
│   │   │   │   ├── engine.js             — team generation (beam search)
│   │   │   │   ├── scorer.js             — multi-factor scoring
│   │   │   │   ├── candidates.js         — candidate filtering + ranking
│   │   │   │   ├── synergy-graph.js      — graph construction + traversal
│   │   │   │   └── config.js             — scoring weights (defaults)
│   │   │   ├── routes/
│   │   │   │   ├── champions.js          — GET /api/champions
│   │   │   │   ├── traits.js             — GET /api/traits
│   │   │   │   ├── scout.js              — POST /api/scout
│   │   │   │   ├── ratings.js            — GET /api/ratings, POST /api/ratings/refresh
│   │   │   │   └── data.js              — POST /api/import, GET /api/status
│   │   │   └── index.js                  — Express app setup
│   │   ├── public/
│   │   │   └── icons/
│   │   ├── tft.db                        — SQLite (gitignored)
│   │   └── package.json
│   └── client/
│       ├── src/
│       │   ├── components/
│       │   │   ├── ui/                   — shadcn components
│       │   │   ├── scout/
│       │   │   │   ├── ScoutPanel.jsx        — main scout interface
│       │   │   │   ├── ChampionLock.jsx      — lock/unlock champions
│       │   │   │   ├── TraitFilter.jsx       — trait constraints
│       │   │   │   ├── ResultList.jsx        — generated comps
│       │   │   │   ├── CompCard.jsx          — single comp display
│       │   │   │   └── TraitBar.jsx          — trait breakdown in comp
│       │   │   ├── champions/
│       │   │   │   ├── ChampionGrid.jsx      — champion pool display
│       │   │   │   └── ChampionTooltip.jsx   — stats + affinity on hover
│       │   │   └── layout/
│       │   │       ├── Header.jsx
│       │   │       └── Sidebar.jsx
│       │   ├── hooks/
│       │   │   ├── useScout.js           — scout API + state management
│       │   │   ├── useChampions.js       — champions data
│       │   │   └── useTraits.js          — traits data
│       │   ├── lib/
│       │   │   ├── api.js                — fetch wrapper
│       │   │   └── utils.js
│       │   ├── App.jsx
│       │   └── main.jsx
│       ├── tailwind.config.js
│       ├── components.json               — shadcn config
│       └── package.json
```

## Phases

### Phase 1: Foundation (DB + Import + Core Algorithm)

Standalone backend — działa z CLI, bez frontu.

**1.1 Database schema**
- `schema.js` — wszystkie tabele z spec + seed `trait_styles`
- `connection.js` — singleton z WAL mode

**1.2 CDragon importer + hooks**
- `cdragon-importer.js` — fetch + import (traits, champions, items)
- `set-hooks.js` — MF warianty, Mecha Enhanced, exclusion groups
- `hook-helpers.js` — `addVariant()`, `removeChampion()`, `addExclusionGroup()`, `getChampionsWithTrait()`
- Test: `node v2/server/src/data/cdragon-importer.js` → DB z ~65 championów (including variants)

**1.3 Mappers**
- `champion.mapper.js` — `fromDb()`, `toApi()`
- `trait.mapper.js` — `fromDb()` z breakpoints + style names
- `ratings.mapper.js` — `fromApi()`, `fromDb()` (identyczny output)

**1.4 Algorithm layer (port z v1)**
- `scorer.js` — port, ale bez DB imports, accepts plain objects
- `engine.js` — port, pure function `generate(champions, traits, ratings, constraints) → result`
- `candidates.js` — port, exclusion groups from data (nie hardcoded)
- `synergy-graph.js` — port, accepts champions + traits as input
- `config.js` — scoring weights, przeniesione z v1

**Test Phase 1:** CLI script that imports CDragon → generates a team → prints result. Zero HTTP.

### Phase 2: MetaTFT Cache + Ratings

**2.1 Cache layer**
- `metatft-cache.js` — `fetch(endpoint, params)` → cache or fetch → aggregate
- TTL per endpoint, stale-while-revalidate, mutex
- Aggregation functions: `units` → `unit_ratings`, `traits` → `trait_ratings`

**2.2 Ratings service**
- `ratings.service.js` — `getUnitRatings()`, `getTraitRatings()`, `getAffinity(unitApiName)`
- Affinity: on-demand fetch `explorer/traits?unit_unique=X` → `unit_trait_affinity`
- Variant fallback: `baseApiName` lookup for enhanced champions

**2.3 Integration with algorithm**
- `scout.service.js` — orchestrates: get data → map → run algorithm → map result
- Affinity feeds into candidate expansion (graph hidden edges)

**Test Phase 2:** CLI script: lock ASol → scout generates comp using MetaTFT ratings + affinity.

### Phase 3: API Routes

**3.1 Express setup**
- `index.js` — Express app, CORS, JSON middleware
- Routes as thin wrappers around services

**3.2 Endpoints**
- `GET /api/champions` — all champions with traits (mapped)
- `GET /api/traits` — all traits with breakpoints + styles
- `GET /api/ratings` — current unit + trait ratings
- `POST /api/scout` — generate comps `{ lockedChampions, constraints }` → `{ results: [...] }`
- `POST /api/import` — trigger CDragon reimport
- `POST /api/ratings/refresh` — trigger MetaTFT refresh
- `GET /api/status` — DB stats, cache freshness

**Test Phase 3:** Postman/curl tests for all endpoints.

### Phase 4: Frontend (Scout-First UI)

**4.1 Project setup**
- Vite + React 19 + Tailwind + shadcn/ui init
- Dark theme (TFT aesthetic)

**4.2 Core layout**
- Single page app — all scout, no tabs/modes
- Top: champion pool (grid, filterable by cost/trait)
- Middle: locked champions bar + trait constraints
- Bottom: generated comps (cards with trait breakdowns)

**4.3 Scout flow components**
- `ChampionGrid` — click to lock, visual state (locked/excluded/available)
- `ChampionLock` — locked champions strip, drag to reorder, click to remove
- `TraitFilter` — optional trait constraints (e.g., "must include Mecha")
- `ScoutPanel` — main container, calls `useScout` hook
- `ResultList` — list of `CompCard` components, sorted by score
- `CompCard` — shows champions + active traits (with style colors: bronze/silver/gold/prismatic) + score
- `TraitBar` — horizontal bar showing trait progress toward breakpoints
- `ChampionTooltip` — hover: stats, affinity traits, best items (future)

**4.4 State management**
- `useScout` hook — locked champions, constraints, results, loading state
- Auto-scout: debounced — results regenerate when locks change
- `useChampions` / `useTraits` — fetched once on mount, cached

**4.5 Polish**
- Champion icons from CDragon
- Trait icons
- Cost-colored borders on champions (1=gray, 2=green, 3=blue, 4=purple, 5=gold)
- Responsive (ale desktop-first — TFT tool)

### Phase 5: Advanced Features (post-MVP)

- Item build suggestions per champion (`unit_item_builds`)
- "Why this comp?" — score breakdown tooltip
- Emblem support (drag emblem → adds trait)
- Mecha Enhanced toggle on locked Mecha champions
- MF variant selector (Conduit/Challenger/Replicator) with auto-pick
- Level selector (affects scoring via star power)
- Export comp as image / team planner link
- Background cache refresh (cron interval)

---

## Order of work

```
Phase 1 ████████████████ (foundation — no shortcuts here)
Phase 2 ████████████     (cache + ratings — needed for scoring)
Phase 3 ██████           (routes — thin, fast)
Phase 4 ████████████████ (UI — biggest visual effort)
Phase 5 ░░░░░░░░░░░░░░░░ (post-MVP, iterative)
```

Each phase has a CLI or API test before moving to the next.
Phase 1-3 = working backend. Phase 4 = usable product.
