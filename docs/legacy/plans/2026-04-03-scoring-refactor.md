# Scoring Refactor — MetaTFT Data-Driven Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace blind style-based trait scoring with real MetaTFT performance data, add centralized config, Stargazer variant filter, and benchmark endpoint.

**Architecture:** MetaTFT API data is fetched on-demand (button) and cached in SQLite. Scorer reads cached ratings instead of hardcoded multipliers. Benchmark endpoint generates comps and compares with meta comps stored in DB.

**Tech Stack:** Node.js (ESM), Express, better-sqlite3, vitest, React (client)

**Spec:** `docs/superpowers/specs/2026-04-03-scoring-refactor-design.md`

---

### Task 1: Database Schema — Add MetaTFT Tables

**Files:**
- Modify: `server/src/db.js`

- [ ] **Step 1: Add 3 new tables to createDb()**

In `server/src/db.js`, add after the `saved_teams` CREATE TABLE statement:

```js
    CREATE TABLE IF NOT EXISTS metatft_trait_ratings (
      apiName TEXT NOT NULL,
      breakpointIndex INTEGER NOT NULL,
      avgPlace REAL NOT NULL,
      winRate REAL NOT NULL,
      top4Rate REAL NOT NULL,
      games INTEGER NOT NULL,
      score REAL NOT NULL,
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (apiName, breakpointIndex)
    );

    CREATE TABLE IF NOT EXISTS metatft_unit_ratings (
      apiName TEXT NOT NULL PRIMARY KEY,
      avgPlace REAL NOT NULL,
      winRate REAL NOT NULL,
      top4Rate REAL NOT NULL,
      games INTEGER NOT NULL,
      score REAL NOT NULL,
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS metatft_meta_comps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clusterId TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      units TEXT NOT NULL,
      traits TEXT NOT NULL,
      avgPlace REAL NOT NULL,
      games INTEGER NOT NULL,
      levelling TEXT,
      builds TEXT,
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
```

- [ ] **Step 2: Verify tables are created**

Run: `cd server && node -e "import('./src/db.js').then(m => { const db = m.createDb('tft.db'); const tables = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'metatft%'\").all(); console.log(tables); })"`

Expected: 3 tables listed.

- [ ] **Step 3: Commit**

```bash
git add server/src/db.js
git commit -m "feat(db): add metatft_trait_ratings, metatft_unit_ratings, metatft_meta_comps tables"
```

---

### Task 2: SCORING_CONFIG — Centralized Configuration

**Files:**
- Create: `server/src/scoring/config.js`
- Test: `server/tests/config.test.js`

- [ ] **Step 1: Write test for config structure**

Create `server/tests/config.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { SCORING_CONFIG } from '../src/scoring/config.js';

describe('SCORING_CONFIG', () => {
  it('has all required weight keys', () => {
    const required = ['traitRating', 'unitRating', 'tierList', 'championPower',
      'uniqueTrait', 'synergyBonus', 'overflowPenalty', 'costPenalty'];
    for (const key of required) {
      expect(SCORING_CONFIG.weights).toHaveProperty(key);
      expect(typeof SCORING_CONFIG.weights[key]).toBe('number');
    }
  });

  it('has tier values for all tiers', () => {
    for (const tier of ['S', 'A', 'B', 'C', 'D']) {
      expect(SCORING_CONFIG.tierValues[tier]).toBeGreaterThan(0);
      expect(SCORING_CONFIG.tierValues[tier]).toBeLessThanOrEqual(1);
    }
  });

  it('has fallback style scores', () => {
    for (const style of [1, 3, 5]) {
      expect(SCORING_CONFIG.fallbackStyleScore[style]).toBeGreaterThan(0);
      expect(SCORING_CONFIG.fallbackStyleScore[style]).toBeLessThanOrEqual(1);
    }
  });

  it('has minGamesForReliable as positive number', () => {
    expect(SCORING_CONFIG.minGamesForReliable).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/config.test.js`

Expected: FAIL — module not found.

- [ ] **Step 3: Create config.js**

Create `server/src/scoring/config.js`:

```js
export const SCORING_CONFIG = {
  weights: {
    traitRating:     15.0,  // metatft trait score (0-1) × this = max trait pts
    unitRating:       8.0,  // metatft unit score (0-1) × this = champion rating pts
    tierList:         4.0,  // tier value (0-1) × this = tier pts
    championPower:    3.0,  // star power + cost base (fallback when no metatft data)
    uniqueTrait:     10.0,  // unique trait max pts (scaled by metatft rating)
    synergyBonus:     3.0,  // bonus per trait at 2nd+ breakpoint
    overflowPenalty:  4.0,  // penalty per wasted unit above breakpoint
    costPenalty:      5.0,  // penalty per unit exceeding shop odds limits
  },

  // Normalized tier values (old: S=10, A=8, B=6, C=4, D=2)
  tierValues: { S: 1.0, A: 0.8, B: 0.6, C: 0.4, D: 0.2 },

  // Near-breakpoint bonus (1 unit from next breakpoint)
  nearBreakpointBonus: 2.0,

  // Minimum games for metatft rating to be trusted
  minGamesForReliable: 300,

  // Fallback style scores when no metatft data (normalized from old 4/8/12/18)
  fallbackStyleScore: { 1: 0.22, 3: 0.44, 4: 0.67, 5: 1.0, 6: 1.0 },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run tests/config.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/scoring/config.js server/tests/config.test.js
git commit -m "feat(scoring): add centralized SCORING_CONFIG with weights and tier values"
```

---

### Task 3: MetaTFT Importer

**Files:**
- Create: `server/src/import-metatft.js`
- Test: `server/tests/import-metatft.test.js`

- [ ] **Step 1: Write test for places-to-stats conversion**

Create `server/tests/import-metatft.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { placesToStats, parseTraitKey, computeScore } from '../src/import-metatft.js';

describe('placesToStats', () => {
  it('computes avg place from places array', () => {
    // 10 games: 5 first place, 5 last place → avg 4.5
    const stats = placesToStats([5, 0, 0, 0, 0, 0, 0, 5]);
    expect(stats.avgPlace).toBeCloseTo(4.5, 1);
    expect(stats.games).toBe(10);
    expect(stats.winRate).toBeCloseTo(0.5, 2);
    expect(stats.top4Rate).toBeCloseTo(0.5, 2);
  });

  it('handles all first place', () => {
    const stats = placesToStats([100, 0, 0, 0, 0, 0, 0, 0]);
    expect(stats.avgPlace).toBeCloseTo(1.0, 1);
    expect(stats.winRate).toBeCloseTo(1.0, 2);
    expect(stats.top4Rate).toBeCloseTo(1.0, 2);
  });

  it('returns null for empty/zero games', () => {
    expect(placesToStats([0, 0, 0, 0, 0, 0, 0, 0])).toBeNull();
  });
});

describe('parseTraitKey', () => {
  it('parses normal trait', () => {
    const r = parseTraitKey('TFT17_DarkStar_1');
    expect(r.apiName).toBe('TFT17_DarkStar');
    expect(r.breakpointIndex).toBe(1);
  });

  it('parses Stargazer variant', () => {
    const r = parseTraitKey('TFT17_Stargazer_Serpent_3');
    expect(r.apiName).toBe('TFT17_Stargazer_Serpent');
    expect(r.breakpointIndex).toBe(3);
  });

  it('parses unique trait', () => {
    const r = parseTraitKey('TFT17_ShenUniqueTrait_1');
    expect(r.apiName).toBe('TFT17_ShenUniqueTrait');
    expect(r.breakpointIndex).toBe(1);
  });
});

describe('computeScore', () => {
  it('returns 1.0 for avgPlace 3.0', () => {
    expect(computeScore(3.0)).toBeCloseTo(1.0, 2);
  });

  it('returns 0.5 for avgPlace 4.5', () => {
    expect(computeScore(4.5)).toBeCloseTo(0.5, 2);
  });

  it('clamps to 0 for avgPlace >= 6', () => {
    expect(computeScore(6.5)).toBe(0);
  });

  it('clamps to 1 for avgPlace <= 3', () => {
    expect(computeScore(2.0)).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/import-metatft.test.js`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement import-metatft.js**

Create `server/src/import-metatft.js`:

```js
const METATFT_BASE = 'https://METATFT_API_REDACTED';
const COMPS_BASE = 'https://METATFT_API_REDACTED';

const ENDPOINTS = {
  traits: '/tft-stat-api/traits',
  units: '/tft-stat-api/units',
  comps: '/tft-comps-api/comps_data',
};

const DEFAULT_PARAMS = {
  queue: 'PBE',
  patch: 'current',
  days: '3',
  permit_filter_adjustment: 'true',
};

export function computeScore(avgPlace) {
  return Math.max(0, Math.min(1, (6.0 - avgPlace) / 3.0));
}

export function placesToStats(places) {
  const games = places.reduce((s, p) => s + p, 0);
  if (games === 0) return null;
  const avgPlace = places.reduce((s, p, i) => s + p * (i + 1), 0) / games;
  const winRate = places[0] / games;
  const top4Rate = places.slice(0, 4).reduce((s, p) => s + p, 0) / games;
  return { avgPlace, winRate, top4Rate, games };
}

export function parseTraitKey(key) {
  // Format: TFT17_DarkStar_1, TFT17_Stargazer_Serpent_3, TFT17_ShenUniqueTrait_1
  // Last segment after _ is always the breakpoint index (a number)
  const lastUnderscore = key.lastIndexOf('_');
  const suffix = key.substring(lastUnderscore + 1);
  const index = parseInt(suffix, 10);
  if (isNaN(index)) return null;
  const apiName = key.substring(0, lastUnderscore);
  return { apiName, breakpointIndex: index };
}

async function fetchJSON(endpoint, extraParams = {}) {
  const params = new URLSearchParams({ ...DEFAULT_PARAMS, ...extraParams });
  const url = `${METATFT_BASE}${endpoint}?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MetaTFT API error: ${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

export async function importTraitRatings(db) {
  const data = await fetchJSON(ENDPOINTS.traits);
  const results = data.results || [];

  const insert = db.prepare(`
    INSERT OR REPLACE INTO metatft_trait_ratings
    (apiName, breakpointIndex, avgPlace, winRate, top4Rate, games, score)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const importMany = db.transaction((rows) => {
    db.prepare('DELETE FROM metatft_trait_ratings').run();
    for (const row of rows) insert.run(...row);
  });

  const rows = [];
  for (const entry of results) {
    const parsed = parseTraitKey(entry.trait);
    if (!parsed) continue;
    const stats = placesToStats(entry.places);
    if (!stats) continue;
    rows.push([
      parsed.apiName, parsed.breakpointIndex,
      stats.avgPlace, stats.winRate, stats.top4Rate, stats.games,
      computeScore(stats.avgPlace),
    ]);
  }

  importMany(rows);
  return { imported: rows.length };
}

export async function importUnitRatings(db) {
  const data = await fetchJSON(ENDPOINTS.units);
  const results = data.results || [];

  const insert = db.prepare(`
    INSERT OR REPLACE INTO metatft_unit_ratings
    (apiName, avgPlace, winRate, top4Rate, games, score)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const importMany = db.transaction((rows) => {
    db.prepare('DELETE FROM metatft_unit_ratings').run();
    for (const row of rows) insert.run(...row);
  });

  const rows = [];
  for (const entry of results) {
    const stats = placesToStats(entry.places);
    if (!stats) continue;
    rows.push([
      entry.unit, stats.avgPlace, stats.winRate, stats.top4Rate,
      stats.games, computeScore(stats.avgPlace),
    ]);
  }

  importMany(rows);
  return { imported: rows.length };
}

export async function importMetaComps(db, maxAvgPlace = 4.5) {
  const data = await fetchJSON(ENDPOINTS.comps, { region_hint: 'eun1' });
  const clusters = data.results?.data?.cluster_details;
  if (!clusters) return { imported: 0 };

  const insert = db.prepare(`
    INSERT OR REPLACE INTO metatft_meta_comps
    (clusterId, name, units, traits, avgPlace, games, levelling, builds)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const importMany = db.transaction((rows) => {
    db.prepare('DELETE FROM metatft_meta_comps').run();
    for (const row of rows) insert.run(...row);
  });

  const rows = [];
  for (const [id, comp] of Object.entries(clusters)) {
    if (!comp.overall || comp.overall.avg > maxAvgPlace) continue;
    const units = comp.units_string ? comp.units_string.split(', ') : [];
    const traits = comp.traits_string ? comp.traits_string.split(', ') : [];
    const topBuilds = (comp.builds || []).slice(0, 5).map(b => ({
      unit: b.unit, items: b.buildName, avg: b.avg,
    }));
    rows.push([
      String(id), comp.name_string || '',
      JSON.stringify(units), JSON.stringify(traits),
      comp.overall.avg, comp.overall.count,
      comp.levelling || null, JSON.stringify(topBuilds),
    ]);
  }

  importMany(rows);
  return { imported: rows.length };
}

export async function importAll(db) {
  const traits = await importTraitRatings(db);
  const units = await importUnitRatings(db);
  const comps = await importMetaComps(db);
  return { traits, units, comps };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run tests/import-metatft.test.js`

Expected: PASS (only pure function tests, no DB/fetch needed).

- [ ] **Step 5: Commit**

```bash
git add server/src/import-metatft.js server/tests/import-metatft.test.js
git commit -m "feat: metatft importer — fetch traits, units, comps from API into DB"
```

---

### Task 4: MetaTFT Routes — Refresh + Status

**Files:**
- Create: `server/src/routes/metatft.js`
- Modify: `server/src/index.js`

- [ ] **Step 1: Create metatft routes**

Create `server/src/routes/metatft.js`:

```js
import { Router } from 'express';
import { importAll } from '../import-metatft.js';

export function metatftRoutes(db) {
  const router = Router();

  // POST /api/metatft/refresh — fetch latest data from MetaTFT API
  router.post('/refresh', async (req, res) => {
    try {
      const result = await importAll(db);
      res.json({ ok: true, ...result });
    } catch (err) {
      console.error('MetaTFT refresh failed:', err);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/metatft/status — check if data exists and when last updated
  router.get('/status', (req, res) => {
    const traitCount = db.prepare('SELECT COUNT(*) as c FROM metatft_trait_ratings').get().c;
    const unitCount = db.prepare('SELECT COUNT(*) as c FROM metatft_unit_ratings').get().c;
    const compCount = db.prepare('SELECT COUNT(*) as c FROM metatft_meta_comps').get().c;
    const lastUpdate = db.prepare(
      "SELECT MAX(updatedAt) as t FROM metatft_trait_ratings"
    ).get().t;

    res.json({
      hasData: traitCount > 0,
      traits: traitCount,
      units: unitCount,
      comps: compCount,
      lastUpdate,
    });
  });

  // GET /api/metatft/meta-comps — return cached meta comps for reference
  router.get('/meta-comps', (req, res) => {
    const comps = db.prepare(
      'SELECT * FROM metatft_meta_comps ORDER BY avgPlace ASC'
    ).all();
    res.json(comps.map(c => ({
      ...c,
      units: JSON.parse(c.units),
      traits: JSON.parse(c.traits),
      builds: c.builds ? JSON.parse(c.builds) : [],
    })));
  });

  return router;
}
```

- [ ] **Step 2: Register route in index.js**

In `server/src/index.js`, add import at top:

```js
import { metatftRoutes } from './routes/metatft.js';
```

Add route registration after the `transitions` route:

```js
app.use('/api/metatft', metatftRoutes(db));
```

- [ ] **Step 3: Test manually**

Run: `cd server && node src/index.js`

Then in another terminal:
```bash
curl http://localhost:3001/api/metatft/status
```

Expected: `{"hasData":false,"traits":0,"units":0,"comps":0,"lastUpdate":null}`

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/metatft.js server/src/index.js
git commit -m "feat: add /api/metatft/refresh and /status routes"
```

---

### Task 5: Rewrite Scorer — MetaTFT-Driven traitScore

**Files:**
- Modify: `server/src/scoring/scorer.js`
- Modify: `server/tests/scorer.test.js`

This is the core change. The scorer needs a `metatftCtx` object passed through from engine. When metatft data is available it uses real ratings; otherwise falls back to style-based scoring.

- [ ] **Step 1: Write new tests for metatft-driven scoring**

Add to `server/tests/scorer.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { championScore, traitScore, teamScore } from '../src/scoring/scorer.js';

// ... keep ALL existing tests unchanged (they test fallback path) ...

describe('traitScore with metatft data', () => {
  const breakpoints = [
    { minUnits: 2, maxUnits: 3, style: 1 },
    { minUnits: 4, maxUnits: 5, style: 3 },
    { minUnits: 6, maxUnits: 25000, style: 5 },
  ];

  it('uses metatft rating when available', () => {
    const metatftCtx = {
      traitRatings: {
        'TestTrait': { 1: { score: 0.5, games: 1000 }, 2: { score: 0.8, games: 500 } },
      },
      unitRatings: {},
    };
    const score = traitScore('TestTrait', 2, breakpoints, { metatftCtx });
    // breakpointIndex=1 (first breakpoint), score=0.5 × 15 = 7.5
    expect(score).toBeCloseTo(7.5, 1);
  });

  it('uses higher breakpoint rating', () => {
    const metatftCtx = {
      traitRatings: {
        'TestTrait': { 1: { score: 0.3, games: 1000 }, 2: { score: 0.8, games: 500 } },
      },
      unitRatings: {},
    };
    const score = traitScore('TestTrait', 4, breakpoints, { metatftCtx });
    // breakpointIndex=2, score=0.8 × 15 = 12
    expect(score).toBeCloseTo(12, 1);
  });

  it('falls back to style when no metatft data', () => {
    const metatftCtx = { traitRatings: {}, unitRatings: {} };
    const score = traitScore('Unknown', 2, breakpoints, { metatftCtx });
    // fallback: style 1 → 0.22 × 15 = 3.3
    expect(score).toBeCloseTo(3.3, 1);
  });

  it('falls back when games below threshold', () => {
    const metatftCtx = {
      traitRatings: {
        'TestTrait': { 1: { score: 0.9, games: 50 } }, // below 300 threshold
      },
      unitRatings: {},
    };
    const score = traitScore('TestTrait', 2, breakpoints, { metatftCtx });
    // Should use fallback, not the 0.9 score
    expect(score).toBeCloseTo(3.3, 1);
  });
});

describe('championScore with metatft data', () => {
  it('uses unit rating when available', () => {
    const metatftCtx = {
      traitRatings: {},
      unitRatings: { 'TFT17_Shen': { score: 0.76, games: 90000 } },
    };
    // unitRating: 0.76 × 8 = 6.08, tierList: S = 1.0 × 4 = 4, total ≈ 10.08
    const score = championScore(
      { cost: 5, apiName: 'TFT17_Shen' }, 'S', null, 8, { metatftCtx }
    );
    expect(score).toBeCloseTo(10.08, 0);
  });

  it('falls back to star power when no unit rating', () => {
    const metatftCtx = { traitRatings: {}, unitRatings: {} };
    const score = championScore(
      { cost: 3, apiName: 'TFT17_Unknown' }, 'A', null, 8, { metatftCtx }
    );
    // No unit rating → uses star power. tier: 0.8 × 4 = 3.2
    // starPower fallback: (3+1)*1.8/1.5 = 4.8, × (3/15) scaled = ~0.96 × 3 = 2.88
    // Total ≈ 6.08
    expect(score).toBeGreaterThan(4);
    expect(score).toBeLessThan(10);
  });
});
```

- [ ] **Step 2: Run tests to verify new ones fail, old ones still pass**

Run: `cd server && npx vitest run tests/scorer.test.js`

Expected: New tests FAIL (signature changed), old tests still PASS.

- [ ] **Step 3: Rewrite scorer.js**

Replace entire content of `server/src/scoring/scorer.js`:

```js
import { SCORING_CONFIG } from './config.js';

const { weights, tierValues, fallbackStyleScore, nearBreakpointBonus, minGamesForReliable } = SCORING_CONFIG;

// Role categories for team balance slider
const ROLE_CATEGORY = {
  ADCarry: 'dps', APCarry: 'dps', ADCaster: 'dps', APCaster: 'dps',
  ADReaper: 'dps', APReaper: 'dps', ADSpecialist: 'dps',
  ADTank: 'tank', APTank: 'tank',
  ADFighter: 'balanced', APFighter: 'balanced', HFighter: 'balanced',
};

// Realistic star level per cost at each player level.
const EXPECTED_STAR_POWER = {
  5:  [2.5, 1.8, 1.0, 1.0, 1.0],
  6:  [2.5, 1.8, 1.4, 1.0, 1.0],
  7:  [3.0, 1.8, 1.8, 1.0, 1.0],
  8:  [3.0, 2.5, 1.8, 1.4, 1.0],
  9:  [3.0, 3.0, 2.5, 1.8, 1.4],
  10: [3.0, 3.0, 3.0, 2.5, 1.8],
};

// ── helpers ──

function getMetatftTraitRating(apiName, breakpointIndex, metatftCtx) {
  if (!metatftCtx?.traitRatings) return null;
  const byBp = metatftCtx.traitRatings[apiName];
  if (!byBp) return null;
  const rating = byBp[breakpointIndex];
  if (!rating || rating.games < minGamesForReliable) return null;
  return rating;
}

function getMetatftUnitRating(apiName, metatftCtx) {
  if (!metatftCtx?.unitRatings) return null;
  const rating = metatftCtx.unitRatings[apiName];
  if (!rating || rating.games < minGamesForReliable) return null;
  return rating;
}

function starPowerFallback(cost, level) {
  const costIdx = Math.min(Math.max(Math.round(cost), 1), 5) - 1;
  const starPowers = EXPECTED_STAR_POWER[level] || EXPECTED_STAR_POWER[8];
  const starPower = starPowers[costIdx];
  const baseStat = cost + 1;
  return (baseStat * starPower) / 1.5;
}

// ── public API ──

export function championScore(champion, tier, roleBalance = null, level = 8, options = {}) {
  const { metatftCtx } = options;
  const apiName = champion.originalApiName || champion.apiName;

  // Unit rating from metatft (primary) or star power fallback
  const unitRating = getMetatftUnitRating(apiName, metatftCtx);
  let basePts;
  if (unitRating) {
    basePts = unitRating.score * weights.unitRating;
  } else {
    basePts = starPowerFallback(champion.effectiveCost || champion.cost, level) / 6.0 * weights.championPower;
  }

  // Tier bonus (normalized)
  const tierVal = tierValues[tier] || 0;
  const tierPts = tierVal * weights.tierList;

  // Role balance (kept from original, scaled down)
  let roleBonus = 0;
  if (roleBalance !== null && champion.role) {
    const cat = ROLE_CATEGORY[champion.role] || 'balanced';
    if (cat === 'dps') roleBonus = (-0.4 + roleBalance) * 2;
    else if (cat === 'tank') roleBonus = (0.6 - roleBalance) * 2;
    else roleBonus = 0.2;
  }

  return basePts + tierPts + roleBonus;
}

export function traitScore(apiNameOrCount, breakpointsOrCount, optionsOrBreakpoints, maybeOptions) {
  // Support two calling conventions:
  // NEW: traitScore(apiName, unitCount, breakpoints, options)
  // OLD: traitScore(unitCount, breakpoints, options) — fallback path
  let apiName, unitCount, breakpoints, options;

  if (typeof apiNameOrCount === 'string') {
    apiName = apiNameOrCount;
    unitCount = breakpointsOrCount;
    breakpoints = optionsOrBreakpoints;
    options = maybeOptions || {};
  } else {
    apiName = null;
    unitCount = apiNameOrCount;
    breakpoints = breakpointsOrCount;
    options = optionsOrBreakpoints || {};
  }

  if (!breakpoints || breakpoints.length === 0) {
    return options.includeNear ? { score: 0 } : 0;
  }

  const sorted = [...breakpoints].sort((a, b) => a.minUnits - b.minUnits);

  // Find active breakpoint
  let activeBreakpoint = null;
  let activeIndex = -1;
  let nextBreakpoint = null;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (unitCount >= sorted[i].minUnits) {
      activeBreakpoint = sorted[i];
      activeIndex = i;
      nextBreakpoint = sorted[i + 1] || null;
      break;
    }
  }

  // Near-breakpoint info
  let nearInfo = null;
  if (!activeBreakpoint) {
    if (unitCount === sorted[0].minUnits - 1) {
      nearInfo = { current: unitCount, next: sorted[0].minUnits, missing: 1 };
    }
  } else if (nextBreakpoint) {
    const missing = nextBreakpoint.minUnits - unitCount;
    if (missing === 1) {
      nearInfo = { current: unitCount, next: nextBreakpoint.minUnits, missing: 1 };
    }
  }

  if (!activeBreakpoint) {
    return options.includeNear ? { score: 0, near: nearInfo } : 0;
  }

  // Unique traits (minUnits=1)
  const isUniqueTrait = activeBreakpoint.minUnits === 1;
  if (isUniqueTrait) {
    const { metatftCtx } = options;
    const rating = apiName ? getMetatftTraitRating(apiName, 1, metatftCtx) : null;
    const score = rating
      ? rating.score * weights.uniqueTrait
      : 5; // legacy fallback
    if (options.includeNear) return { score, near: nearInfo };
    return score;
  }

  // ── Score from metatft or fallback ──
  const breakpointIndex = activeIndex + 1; // 1-based
  const { metatftCtx } = options;
  const rating = apiName ? getMetatftTraitRating(apiName, breakpointIndex, metatftCtx) : null;

  let basePts;
  if (rating) {
    basePts = rating.score * weights.traitRating;
  } else {
    const styleScore = fallbackStyleScore[activeBreakpoint.style] || activeBreakpoint.style * 0.2;
    basePts = styleScore * weights.traitRating;
  }

  // Near-breakpoint bonus
  let nearBonus = 0;
  if (nearInfo) nearBonus = nearBreakpointBonus;

  // Overflow penalty
  const overflow = unitCount - activeBreakpoint.minUnits;
  let overflowAdjust = 0;
  if (nextBreakpoint && overflow > 0) {
    const toNext = nextBreakpoint.minUnits - unitCount;
    if (toNext === 1) {
      overflowAdjust = nearBreakpointBonus; // almost there — bonus
    } else {
      overflowAdjust = -overflow * weights.overflowPenalty;
    }
  }

  const score = basePts + nearBonus + overflowAdjust;
  if (options.includeNear) return { score, near: nearInfo };
  return score;
}

export function emblemBonus(currentUnitsWithoutEmblem, breakpoints) {
  if (!breakpoints || breakpoints.length === 0) return 1;
  const sorted = [...breakpoints].sort((a, b) => a.minUnits - b.minUnits);
  const withoutCount = currentUnitsWithoutEmblem;
  const withCount = currentUnitsWithoutEmblem + 1;

  let styleBefore = 0;
  let styleAfter = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (withoutCount >= sorted[i].minUnits && styleBefore === 0) styleBefore = sorted[i].style;
    if (withCount >= sorted[i].minUnits && styleAfter === 0) styleAfter = sorted[i].style;
  }

  if (styleAfter > styleBefore) return (styleAfter - styleBefore) * 2;
  return 1;
}

export function teamScore(team) {
  let score = 0;
  const roleBalance = team.roleBalance ?? null;
  const level = team.level || 8;
  const metatftCtx = team.metatftCtx || null;

  // Champion scores
  for (const champ of team.champions) {
    score += championScore(
      champ, team.tierMap?.[champ.apiName] || null, roleBalance, level,
      { metatftCtx }
    );
  }

  // Trait scores
  for (const trait of team.activeTraits) {
    score += traitScore(
      trait.apiName || null, trait.count, trait.breakpoints,
      { metatftCtx }
    );
  }

  // Emblem bonuses
  for (const eb of (team.emblemBonuses || [])) {
    score += emblemBonus(eb.unitsWithoutEmblem, eb.breakpoints);
  }

  // Synergy concentration bonus: traits at 2nd+ breakpoint
  const activeSynergyTraits = team.activeTraits.filter(t => {
    const sorted = [...(t.breakpoints || [])].sort((a, b) => a.minUnits - b.minUnits);
    return sorted.length > 0 && sorted[0].minUnits > 1;
  });

  const highBreakpoints = activeSynergyTraits.filter(t => {
    const sorted = [...(t.breakpoints || [])].sort((a, b) => a.minUnits - b.minUnits);
    let activeIdx = 0;
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (t.count >= sorted[i].minUnits) { activeIdx = i; break; }
    }
    return activeIdx >= 1;
  });

  score += highBreakpoints.length * weights.synergyBonus;

  return score;
}
```

- [ ] **Step 4: Update old tests for backward compatibility**

The old tests called `traitScore(unitCount, breakpoints)` (no apiName). This still works via the dual calling convention. But `championScore` now takes `options` as 5th arg. Old tests pass `(champ, tier, roleBalance, level)` — the 5th arg defaults to `{}`, so they should still work.

Run: `cd server && npx vitest run tests/scorer.test.js`

Review failures. If old tests need minor adjustments due to rescaled values (e.g. `tierWeight` changed from 10 to 4), update expected values:

- Old test: `expect(sTier - noTier).toBe(10)` → `expect(sTier - noTier).toBeCloseTo(4, 1)` (tierValues.S × weights.tierList = 1.0 × 4.0)
- Old test checking absolute values need recalibrating to new scale

- [ ] **Step 5: Run all tests**

Run: `cd server && npx vitest run`

Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/scoring/scorer.js server/tests/scorer.test.js
git commit -m "feat(scoring): rewrite scorer to use metatft ratings with fallback to style-based scoring"
```

---

### Task 6: Update Engine — Pass MetaTFT Context + Stargazer Variant

**Files:**
- Modify: `server/src/scoring/engine.js`
- Modify: `server/src/routes/generate.js`

- [ ] **Step 1: Load metatft data in engine and pass to scorer**

In `server/src/scoring/engine.js`, add at the top of `generateTeams()`, after `traitBreakpointsMap` is built:

```js
  // Load metatft ratings from DB
  const metatftCtx = loadMetatftContext(db, constraints.stargazerVariant);
```

Add this function before `generateTeams`:

```js
function loadMetatftContext(db, stargazerVariant) {
  const traitRows = db.prepare('SELECT * FROM metatft_trait_ratings').all();
  const unitRows = db.prepare('SELECT * FROM metatft_unit_ratings').all();

  // Build traitRatings: { apiName: { breakpointIndex: { score, games } } }
  const traitRatings = {};
  for (const row of traitRows) {
    if (!traitRatings[row.apiName]) traitRatings[row.apiName] = {};
    traitRatings[row.apiName][row.breakpointIndex] = {
      score: row.score, games: row.games,
    };
  }

  // Stargazer: if variant set, alias TFT17_Stargazer → TFT17_Stargazer_{variant}
  // If not set, compute weighted average of all variants
  const stargazerBase = 'TFT17_Stargazer';
  const stargazerVariants = Object.keys(traitRatings).filter(
    k => k.startsWith(stargazerBase + '_') && k !== stargazerBase
  );

  if (stargazerVariant) {
    const variantKey = `${stargazerBase}_${stargazerVariant}`;
    if (traitRatings[variantKey]) {
      traitRatings[stargazerBase] = traitRatings[variantKey];
    }
  } else if (stargazerVariants.length > 0) {
    // Weighted average by games across variants, per breakpointIndex
    const avgByBp = {};
    for (const vKey of stargazerVariants) {
      for (const [bpIdx, data] of Object.entries(traitRatings[vKey])) {
        if (!avgByBp[bpIdx]) avgByBp[bpIdx] = { totalScore: 0, totalGames: 0 };
        avgByBp[bpIdx].totalScore += data.score * data.games;
        avgByBp[bpIdx].totalGames += data.games;
      }
    }
    traitRatings[stargazerBase] = {};
    for (const [bpIdx, agg] of Object.entries(avgByBp)) {
      traitRatings[stargazerBase][bpIdx] = {
        score: agg.totalGames > 0 ? agg.totalScore / agg.totalGames : 0,
        games: agg.totalGames,
      };
    }
  }

  // Build unitRatings: { apiName: { score, games } }
  const unitRatings = {};
  for (const row of unitRows) {
    unitRatings[row.apiName] = { score: row.score, games: row.games };
  }

  return { traitRatings, unitRatings };
}
```

- [ ] **Step 2: Pass metatftCtx through all scoring calls**

In `generateTeams()`, add `metatftCtx` to the `ctx` object:

```js
  const ctx = { traitBreakpointsMap, tierMap, emblems, roleBalance, excludedTraits,
    lockedTraits: normalizedLockedTraits, level, mechaEnhanced, metatftCtx };
```

In `quickScore()`, pass `metatftCtx` when building the teamScore call. Change the `teamScore(...)` call to include `metatftCtx: ctx.metatftCtx`:

```js
  let score = teamScore({
    champions: teamChampions,
    activeTraits: activeTraits.map(t => ({ apiName: t.apiName, count: t.count, breakpoints: t.breakpoints })),
    emblemBonuses: [], tierMap, roleBalance, level: ctx.level || 8,
    metatftCtx: ctx.metatftCtx,
  });
```

Note: the `activeTraits` mapping now includes `apiName` — this is critical for metatft lookup. The `apiName` comes from the key in `traitCounts`.

Update the `activeTraits` building loop in `quickScore()` to include `apiName`:

```js
  const activeTraits = [];
  for (const [apiName, count] of Object.entries(traitCounts)) {
    const data = traitBreakpointsMap[apiName];
    if (data) activeTraits.push({ apiName, count, breakpoints: data.breakpoints });
  }
```

Do the same in `buildTeamResult()` — the activeTraits for teamScore call already has `apiName` from the loop variable, just ensure it's passed through.

- [ ] **Step 3: Add stargazerVariant to constraints in generate route**

In `server/src/routes/generate.js`, add `stargazerVariant` to destructuring:

```js
  const {
    lockedChampions = [], lockedTraits = [], emblems = [],
    excludedChampions = [], excludedTraits = [], mechaEnhanced = [],
    level = 8, roleBalance = null, topN = 20, iterations = 1000,
    stargazerVariant = null,
  } = req.body;
  const constraints = { lockedChampions, lockedTraits, excludedTraits, emblems,
    excludedChampions, mechaEnhanced, level, roleBalance, stargazerVariant };
```

- [ ] **Step 4: Run all tests**

Run: `cd server && npx vitest run`

Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/scoring/engine.js server/src/routes/generate.js
git commit -m "feat(engine): load metatft context, pass to scorer, support stargazerVariant"
```

---

### Task 7: Benchmark Endpoint

**Files:**
- Create: `server/src/routes/benchmark.js`
- Modify: `server/src/index.js`

- [ ] **Step 1: Create benchmark route**

Create `server/src/routes/benchmark.js`:

```js
import { Router } from 'express';
import { generateTeams } from '../scoring/engine.js';

export function benchmarkRoutes(db) {
  const router = Router();

  const DEFAULT_SCENARIOS = [
    { name: 'empty_lvl8', constraints: { level: 8 } },
    { name: 'empty_lvl9', constraints: { level: 9 } },
    { name: 'dark_star_locked', constraints: { level: 8, lockedTraits: [{ apiName: 'TFT17_DarkStar', minCount: 4 }] } },
    { name: 'with_shen', constraints: { level: 9, lockedChampions: ['TFT17_Shen'] } },
    { name: 'with_jhin_shen', constraints: { level: 9, lockedChampions: ['TFT17_Shen', 'TFT17_Jhin'] } },
    { name: 'rogue_comp', constraints: { level: 8, lockedTraits: [{ apiName: 'TFT17_AssassinTrait', minCount: 3 }] } },
  ];

  router.post('/', (req, res) => {
    const { scenarios = DEFAULT_SCENARIOS, topN = 3, iterations = 500 } = req.body;

    // Load meta comps for comparison
    const metaComps = db.prepare(
      'SELECT * FROM metatft_meta_comps ORDER BY avgPlace ASC'
    ).all().map(c => ({
      ...c,
      units: JSON.parse(c.units),
      traits: JSON.parse(c.traits),
    }));

    const results = [];

    for (const scenario of scenarios) {
      const constraints = {
        lockedChampions: [], lockedTraits: [], emblems: [],
        excludedChampions: [], excludedTraits: [], mechaEnhanced: [],
        level: 8, roleBalance: null,
        ...scenario.constraints,
      };

      const comps = generateTeams(db, constraints, { topN, iterations });

      // Analyze each generated comp
      const analyzed = comps.map(comp => {
        const unitSet = new Set(comp.champions.map(c => c.apiName));

        // Find best meta comp overlap
        let bestOverlap = { name: 'none', overlap: 0, metaAvgPlace: 0, total: 0 };
        for (const meta of metaComps) {
          const matching = meta.units.filter(u => unitSet.has(u)).length;
          const overlapPct = matching / Math.max(meta.units.length, unitSet.size);
          if (overlapPct > bestOverlap.overlap) {
            bestOverlap = {
              name: meta.name,
              overlap: matching,
              total: meta.units.length,
              overlapPct: Math.round(overlapPct * 100),
              metaAvgPlace: meta.avgPlace,
              metaGames: meta.games,
            };
          }
        }

        return {
          score: comp.score,
          champions: comp.champions.map(c => c.name).join(', '),
          activeTraits: comp.activeTraits.map(t => `${t.name} ${t.count}`).join(', '),
          traitCount: comp.activeTraits.length,
          metaMatch: bestOverlap,
        };
      });

      results.push({
        scenario: scenario.name,
        comps: analyzed,
      });
    }

    res.json({
      results,
      metaCompsCount: metaComps.length,
      topMetaComps: metaComps.slice(0, 5).map(c => ({
        name: c.name,
        units: c.units.join(', '),
        avgPlace: c.avgPlace,
        games: c.games,
      })),
    });
  });

  return router;
}
```

- [ ] **Step 2: Register in index.js**

In `server/src/index.js`, add:

```js
import { benchmarkRoutes } from './routes/benchmark.js';
```

```js
app.use('/api/benchmark', benchmarkRoutes(db));
```

- [ ] **Step 3: Test manually** (requires metatft data imported first)

```bash
curl -X POST http://localhost:3001/api/metatft/refresh
curl -X POST http://localhost:3001/api/benchmark -H 'Content-Type: application/json' -d '{}'
```

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/benchmark.js server/src/index.js
git commit -m "feat: add /api/benchmark endpoint for scoring quality analysis"
```

---

### Task 8: Frontend — Stargazer Variant Dropdown + MetaTFT Refresh Button

**Files:**
- Modify: `client/src/components/FilterPanel.jsx`
- Modify: `client/src/api.js`

- [ ] **Step 1: Add API functions**

In `client/src/api.js`, add:

```js
export async function refreshMetatft() {
  const res = await fetch(`${API}/metatft/refresh`, { method: 'POST' });
  return res.json();
}

export async function getMetatftStatus() {
  const res = await fetch(`${API}/metatft/status`);
  return res.json();
}
```

- [ ] **Step 2: Add Stargazer variant dropdown + refresh button to FilterPanel**

In `client/src/components/FilterPanel.jsx`, add state and UI:

Add to imports:
```js
import { useState, useEffect } from 'react';
```
(Replace the existing `useCallback` import with `useState, useEffect, useCallback`)

Add to `api.js` imports:
```js
import { generateTeams, refreshMetatft, getMetatftStatus } from '../api';
```

Add state inside FilterPanel component (after the useUrlFilters hook):
```js
  const [stargazerVariant, setStargazerVariant] = useState('');
  const [metatftStatus, setMetatftStatus] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    getMetatftStatus().then(setMetatftStatus).catch(() => {});
  }, []);

  const handleRefreshMetatft = async () => {
    setRefreshing(true);
    try {
      await refreshMetatft();
      const status = await getMetatftStatus();
      setMetatftStatus(status);
    } catch (err) { console.error('Refresh failed:', err); }
    finally { setRefreshing(false); }
  };
```

Add `stargazerVariant` to the constraints in `handleGenerate`:
```js
  const constraints = {
    lockedChampions, lockedTraits: lockedTraits.map(t => ({ apiName: t.apiName, minCount: t.minCount })),
    excludedTraits, emblems: selectedEmblems, excludedChampions, level,
    roleBalance: roleBalanceEnabled ? roleBalance : null,
    stargazerVariant: stargazerVariant || null,
  };
```

Add UI elements before the Generate button:

```jsx
      {/* Stargazer Variant */}
      <div className="mb-3">
        <label className="block text-sm text-gray-400 mb-1">Stargazer Variant</label>
        <select value={stargazerVariant} onChange={e => setStargazerVariant(e.target.value)}
          className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm">
          <option value="">Auto (srednia)</option>
          <option value="Serpent">Serpent</option>
          <option value="Wolf">Wolf</option>
          <option value="Mountain">Mountain</option>
          <option value="Fountain">Fountain</option>
          <option value="Huntress">Huntress</option>
          <option value="Medallion">Medallion</option>
          <option value="Shield">Shield (Altar)</option>
        </select>
      </div>

      {/* MetaTFT Data */}
      <div className="mb-3 p-3 bg-gray-800 rounded border border-gray-700">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm text-gray-400">MetaTFT Data</span>
          <button onClick={handleRefreshMetatft} disabled={refreshing}
            className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-0.5 rounded disabled:opacity-50">
            {refreshing ? 'Ladowanie...' : 'Odswiez'}
          </button>
        </div>
        {metatftStatus && (
          <div className="text-xs text-gray-500">
            {metatftStatus.hasData
              ? `${metatftStatus.traits} traitow, ${metatftStatus.units} unitow, ${metatftStatus.comps} compow`
              : 'Brak danych — kliknij Odswiez'}
            {metatftStatus.lastUpdate && (
              <span className="ml-1">({new Date(metatftStatus.lastUpdate).toLocaleDateString()})</span>
            )}
          </div>
        )}
      </div>
```

- [ ] **Step 3: Test manually**

Start client and server. Verify:
1. Stargazer dropdown appears
2. MetaTFT status shows "Brak danych"
3. Click "Odswiez" → data loads
4. Generate works with/without stargazer variant

- [ ] **Step 4: Commit**

```bash
git add client/src/components/FilterPanel.jsx client/src/api.js
git commit -m "feat(ui): add Stargazer variant dropdown and MetaTFT refresh button"
```

---

### Task 9: Integration Test — End-to-End Scoring Validation

**Files:**
- Create: `server/tests/scoring-integration.test.js`

- [ ] **Step 1: Write integration test**

Create `server/tests/scoring-integration.test.js`:

```js
import { describe, it, expect, beforeAll } from 'vitest';
import { createDb } from '../src/db.js';
import { teamScore, traitScore, championScore } from '../src/scoring/scorer.js';

describe('scoring integration with metatft data', () => {
  let db;

  beforeAll(() => {
    db = createDb(':memory:');

    // Seed fake metatft data representing known meta truths
    db.prepare(`INSERT INTO metatft_trait_ratings VALUES
      ('TFT17_AssassinTrait', 1, 4.02, 0.175, 0.589, 32000, 0.66, datetime('now')),
      ('TFT17_AssassinTrait', 2, 3.37, 0.257, 0.704, 9600, 0.88, datetime('now')),
      ('TFT17_Primordian', 1, 5.46, 0.065, 0.334, 4700, 0.18, datetime('now')),
      ('TFT17_Primordian', 2, 4.47, 0.091, 0.522, 12000, 0.51, datetime('now')),
      ('TFT17_DarkStar', 1, 4.03, 0.179, 0.584, 68000, 0.66, datetime('now')),
      ('TFT17_DarkStar', 3, 3.99, 0.124, 0.601, 9000, 0.67, datetime('now')),
      ('TFT17_ShenUniqueTrait', 1, 3.73, 0.196, 0.642, 92000, 0.76, datetime('now'))
    `).run();

    db.prepare(`INSERT INTO metatft_unit_ratings VALUES
      ('TFT17_Shen', 3.73, 0.196, 0.642, 92000, 0.76, datetime('now')),
      ('TFT17_Briar', 5.20, 0.06, 0.36, 5000, 0.27, datetime('now'))
    `).run();
  });

  function buildMetatftCtx() {
    const traitRows = db.prepare('SELECT * FROM metatft_trait_ratings').all();
    const unitRows = db.prepare('SELECT * FROM metatft_unit_ratings').all();
    const traitRatings = {};
    for (const r of traitRows) {
      if (!traitRatings[r.apiName]) traitRatings[r.apiName] = {};
      traitRatings[r.apiName][r.breakpointIndex] = { score: r.score, games: r.games };
    }
    const unitRatings = {};
    for (const r of unitRows) unitRatings[r.apiName] = { score: r.score, games: r.games };
    return { traitRatings, unitRatings };
  }

  it('Rogue 3 (S-tier) scores higher than Primordian 3 (B-tier)', () => {
    const metatftCtx = buildMetatftCtx();
    const bpRogue = [{ minUnits: 2, style: 1 }, { minUnits: 3, style: 3 }];
    const bpPrimordian = [{ minUnits: 2, style: 1 }, { minUnits: 3, style: 5 }];

    const rogueScore = traitScore('TFT17_AssassinTrait', 3, bpRogue, { metatftCtx });
    const primordianScore = traitScore('TFT17_Primordian', 3, bpPrimordian, { metatftCtx });

    expect(rogueScore).toBeGreaterThan(primordianScore);
  });

  it('Shen (S-tier unique) scores much higher than weak unique', () => {
    const metatftCtx = buildMetatftCtx();
    const uniqueBp = [{ minUnits: 1, style: 4 }];

    const shenTrait = traitScore('TFT17_ShenUniqueTrait', 1, uniqueBp, { metatftCtx });
    // No metatft data → fallback flat 5
    const unknownTrait = traitScore('TFT17_Unknown', 1, uniqueBp, { metatftCtx });

    expect(shenTrait).toBeGreaterThan(unknownTrait);
    expect(shenTrait).toBeCloseTo(7.6, 0); // 0.76 × 10
  });

  it('Shen champion scores higher than Briar due to unit rating', () => {
    const metatftCtx = buildMetatftCtx();
    const shenScore = championScore(
      { cost: 5, apiName: 'TFT17_Shen' }, 'S', null, 8, { metatftCtx }
    );
    const briarScore = championScore(
      { cost: 1, apiName: 'TFT17_Briar' }, 'B', null, 8, { metatftCtx }
    );
    expect(shenScore).toBeGreaterThan(briarScore);
  });

  it('Dark Star 6 scores higher than Primordian 3 despite same style', () => {
    const metatftCtx = buildMetatftCtx();
    const bpDS = [
      { minUnits: 2, style: 1 }, { minUnits: 4, style: 3 }, { minUnits: 6, style: 5 },
    ];
    const bpPrim = [{ minUnits: 2, style: 1 }, { minUnits: 3, style: 5 }];

    const dsScore = traitScore('TFT17_DarkStar', 6, bpDS, { metatftCtx });
    const primScore = traitScore('TFT17_Primordian', 3, bpPrim, { metatftCtx });

    expect(dsScore).toBeGreaterThan(primScore);
  });
});
```

- [ ] **Step 2: Run test**

Run: `cd server && npx vitest run tests/scoring-integration.test.js`

Expected: ALL PASS — this validates the core design goals.

- [ ] **Step 3: Commit**

```bash
git add server/tests/scoring-integration.test.js
git commit -m "test: integration tests validating metatft-driven scoring correctness"
```

---

### Task 10: Cleanup temp files

**Files:**
- Delete: `D:\Projekty\tft-generator\comps_data_tmp.json`

- [ ] **Step 1: Remove temp file**

```bash
rm D:/Projekty/tft-generator/comps_data_tmp.json
```

- [ ] **Step 2: Final test run**

Run: `cd server && npx vitest run`

Expected: ALL PASS

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore: cleanup temp files after scoring refactor"
```
