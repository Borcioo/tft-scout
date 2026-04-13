# Client-Side Algorithm Migration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the team generation algorithm from backend (Node.js) to frontend (Web Worker), so the server only serves data and the browser does all computation.

**Architecture:** Backend gets a new `/api/scout/context` endpoint that returns all data the algorithm needs in one JSON payload (~50KB gzipped). Client fetches this once, caches it, and runs the algorithm in a Web Worker. The existing `/api/scout` endpoint stays as-is (unused fallback). The algorithm code (1626 lines, pure JS, zero deps) is copied verbatim into `client/src/algorithm/`.

**Tech Stack:** Vite Web Worker (native `new Worker()` with `?worker` import), React hooks, existing algorithm JS modules.

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `server/src/routes/scout-context.js` | Express route: `/api/scout/context` — returns champions + traits + exclusionGroups + scoringCtx in one call |
| `client/src/algorithm/engine.js` | Copy of `server/src/algorithm/engine.js` |
| `client/src/algorithm/synergy-graph.js` | Copy of `server/src/algorithm/synergy-graph.js` |
| `client/src/algorithm/scorer.js` | Copy of `server/src/algorithm/scorer.js` |
| `client/src/algorithm/candidates.js` | Copy of `server/src/algorithm/candidates.js` |
| `client/src/algorithm/insights.js` | Copy of `server/src/algorithm/insights.js` |
| `client/src/algorithm/config.js` | Copy of `server/src/algorithm/config.js` |
| `client/src/workers/scout.worker.js` | Web Worker entry — receives messages, runs `generate()` + `generateInsights()`, posts results back |
| `client/src/hooks/useScoutWorker.js` | React hook — manages Worker lifecycle, sends messages, receives results, replaces API calls in `useScout.js` |

### Modified files

| File | Change |
|------|--------|
| `server/src/index.js` | Register new `/api/scout-context` route |
| `client/src/hooks/useScout.js` | Replace `api.scout()` calls with `useScoutWorker` |
| `client/src/lib/api.js` | Add `api.getScoutContext()` |

### Unchanged (kept as fallback)

| File | Note |
|------|------|
| `server/src/routes/scout.js` | Keep as-is, not removed |
| `server/src/services/scout.service.js` | Keep as-is, not removed |

---

### Task 1: Backend — `/api/scout/context` endpoint

**Files:**
- Create: `server/src/routes/scout-context.js`
- Modify: `server/src/index.js:47-52`

- [ ] **Step 1: Create the scout-context route**

```javascript
// server/src/routes/scout-context.js
import { Router } from 'express';

export function createScoutContextRoute(championService, ratingsService) {
  const router = Router();

  router.get('/', async (_req, res) => {
    try {
      const [champions, traits, exclusionGroups, scoringCtx] = await Promise.all([
        Promise.resolve(championService.getAllChampions()),
        Promise.resolve(championService.getAllTraits()),
        Promise.resolve(championService.getExclusionGroups()),
        ratingsService.buildScoringContext(),
      ]);

      res.json({ champions, traits, exclusionGroups, scoringCtx });
    } catch (e) {
      console.error('[ScoutContext]', e);
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
```

- [ ] **Step 2: Register the route in index.js**

In `server/src/index.js`, add import at top with other route imports:

```javascript
import { createScoutContextRoute } from './routes/scout-context.js';
```

Add route registration after the other `app.use` lines (after line 52):

```javascript
app.use('/api/scout/context', createScoutContextRoute(championService, ratingsService));
```

- [ ] **Step 3: Test the endpoint locally**

Run: `cd server && node src/index.js`

Then in another terminal:
```bash
curl -s http://localhost:3001/api/scout/context | node -e "
  const chunks = [];
  process.stdin.on('data', c => chunks.push(c));
  process.stdin.on('end', () => {
    const d = JSON.parse(Buffer.concat(chunks));
    console.log('champions:', d.champions.length);
    console.log('traits:', d.traits.length);
    console.log('exclusionGroups:', d.exclusionGroups.length);
    console.log('unitRatings:', Object.keys(d.scoringCtx.unitRatings).length);
    console.log('traitRatings:', Object.keys(d.scoringCtx.traitRatings).length);
    console.log('metaComps:', d.scoringCtx.metaComps.length);
    console.log('size:', Buffer.concat(chunks).length, 'bytes');
  });
"
```

Expected: All counts > 0, size roughly 200-400KB.

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/scout-context.js server/src/index.js
git commit -m "feat: add /api/scout/context endpoint for client-side algorithm"
```

---

### Task 2: Copy algorithm to client

**Files:**
- Create: `client/src/algorithm/engine.js`
- Create: `client/src/algorithm/synergy-graph.js`
- Create: `client/src/algorithm/scorer.js`
- Create: `client/src/algorithm/candidates.js`
- Create: `client/src/algorithm/insights.js`
- Create: `client/src/algorithm/config.js`

- [ ] **Step 1: Copy all algorithm files**

```bash
mkdir -p client/src/algorithm
cp server/src/algorithm/engine.js client/src/algorithm/engine.js
cp server/src/algorithm/synergy-graph.js client/src/algorithm/synergy-graph.js
cp server/src/algorithm/scorer.js client/src/algorithm/scorer.js
cp server/src/algorithm/candidates.js client/src/algorithm/candidates.js
cp server/src/algorithm/insights.js client/src/algorithm/insights.js
cp server/src/algorithm/config.js client/src/algorithm/config.js
```

- [ ] **Step 2: Verify no Node.js-specific imports exist**

```bash
grep -rn "require\|from 'fs'\|from 'path'\|from 'node:" client/src/algorithm/
```

Expected: No output (all algorithm files are pure JS with only relative imports between each other).

- [ ] **Step 3: Commit**

```bash
git add client/src/algorithm/
git commit -m "feat: copy algorithm modules to client for Web Worker execution"
```

---

### Task 3: Create the Web Worker

**Files:**
- Create: `client/src/workers/scout.worker.js`

The worker receives messages with type `generate` or `roadTo`, runs the algorithm, and posts results back. It also caches the scout context so it's only fetched once.

- [ ] **Step 1: Create the worker file**

```javascript
// client/src/workers/scout.worker.js
import { generate } from '../algorithm/engine.js';
import { generateInsights } from '../algorithm/insights.js';

let cachedContext = null;

async function fetchContext() {
  if (cachedContext) return cachedContext;
  const res = await fetch('/api/scout/context');
  if (!res.ok) throw new Error(`Context fetch failed: ${res.status}`);
  cachedContext = await res.json();
  return cachedContext;
}

function runGenerate(ctx, params) {
  const {
    lockedChampions = [],
    excludedChampions = [],
    lockedTraits = [],
    excludedTraits = [],
    emblems = [],
    level = 8,
    topN = 10,
    max5Cost = null,
    roleBalance = null,
    seed = 0,
  } = params;

  const results = generate({
    champions: ctx.champions,
    traits: ctx.traits,
    scoringCtx: ctx.scoringCtx,
    constraints: {
      lockedChampions,
      excludedChampions,
      lockedTraits,
      excludedTraits,
      emblems,
      max5Cost,
      roleBalance,
    },
    exclusionGroups: ctx.exclusionGroups,
    level,
    topN,
    seed,
  });

  const insights = generateInsights({
    champions: ctx.champions,
    traits: ctx.traits,
    lockedChampions,
    emblems,
    level,
    scoringCtx: ctx.scoringCtx,
  });

  return { results, insights };
}

function runRoadTo(ctx, params) {
  const {
    baseTeam = [],
    emblems = [],
    excludedChampions = [],
    targetLevel = 10,
    topN = 5,
  } = params;

  const costOf = (api) => ctx.champions.find(c => c.apiName === api)?.cost || 3;
  const byCost = [...baseTeam].sort((a, b) => costOf(a) - costOf(b));

  const subsets = new Set();
  const addSubset = (arr) => subsets.add(JSON.stringify([...arr].sort()));

  addSubset(baseTeam);
  for (let i = 0; i < baseTeam.length; i++) {
    addSubset(baseTeam.filter((_, j) => j !== i));
  }
  if (byCost.length >= 3) addSubset(byCost.slice(1));
  if (byCost.length >= 4) addSubset(byCost.slice(2));

  const allResults = new Map();
  for (const subsetJson of subsets) {
    const subset = JSON.parse(subsetJson);
    const results = generate({
      champions: ctx.champions,
      traits: ctx.traits,
      scoringCtx: ctx.scoringCtx,
      exclusionGroups: ctx.exclusionGroups,
      constraints: {
        lockedChampions: subset,
        excludedChampions,
        lockedTraits: [],
        excludedTraits: [],
        emblems,
        max5Cost: null,
      },
      level: targetLevel,
      topN: 3,
      seed: Math.floor(Math.random() * 1000000),
    });
    for (const r of results) {
      const key = r.champions.map(c => c.apiName).sort().join(',');
      if (!allResults.has(key) || allResults.get(key).score < r.score) {
        allResults.set(key, r);
      }
    }
  }

  return [...allResults.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

self.onmessage = async (e) => {
  const { type, id, params } = e.data;

  try {
    const ctx = await fetchContext();

    let result;
    if (type === 'generate') {
      result = runGenerate(ctx, params);
    } else if (type === 'roadTo') {
      result = runRoadTo(ctx, params);
    } else {
      throw new Error(`Unknown message type: ${type}`);
    }

    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};

// Signal ready
self.postMessage({ type: 'ready' });
```

- [ ] **Step 2: Commit**

```bash
git add client/src/workers/scout.worker.js
git commit -m "feat: create scout Web Worker with generate + roadTo handlers"
```

---

### Task 4: Create `useScoutWorker` hook

**Files:**
- Create: `client/src/hooks/useScoutWorker.js`

This hook manages the Worker lifecycle and provides a promise-based API for sending messages and receiving results.

- [ ] **Step 1: Create the hook**

```javascript
// client/src/hooks/useScoutWorker.js
import { useRef, useEffect, useCallback } from 'react';

let sharedWorker = null;
let refCount = 0;
const pending = new Map();
let msgId = 0;

function getWorker() {
  if (!sharedWorker) {
    sharedWorker = new Worker(
      new URL('../workers/scout.worker.js', import.meta.url),
      { type: 'module' }
    );
    sharedWorker.onmessage = (e) => {
      const { id, result, error } = e.data;
      if (id == null) return; // ignore 'ready' signal
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (error) p.reject(new Error(error));
      else p.resolve(result);
    };
  }
  refCount++;
  return sharedWorker;
}

function releaseWorker() {
  refCount--;
  if (refCount <= 0 && sharedWorker) {
    sharedWorker.terminate();
    sharedWorker = null;
    refCount = 0;
    pending.clear();
  }
}

function sendMessage(type, params) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    sharedWorker.postMessage({ type, id, params });
  });
}

export function useScoutWorker() {
  const workerRef = useRef(null);

  useEffect(() => {
    workerRef.current = getWorker();
    return () => releaseWorker();
  }, []);

  const generate = useCallback((params) => {
    return sendMessage('generate', params);
  }, []);

  const roadTo = useCallback((params) => {
    return sendMessage('roadTo', params);
  }, []);

  return { generate, roadTo };
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/hooks/useScoutWorker.js
git commit -m "feat: add useScoutWorker hook with shared Worker lifecycle"
```

---

### Task 5: Add `api.getScoutContext()` to API client

**Files:**
- Modify: `client/src/lib/api.js`

- [ ] **Step 1: Add the new API method**

In `client/src/lib/api.js`, add to the `api` object:

```javascript
getScoutContext: () => request('/scout/context'),
```

- [ ] **Step 2: Commit**

```bash
git add client/src/lib/api.js
git commit -m "feat: add getScoutContext to API client"
```

---

### Task 6: Wire `useScout` to Web Worker

**Files:**
- Modify: `client/src/hooks/useScout.js`

This is the key integration step. Replace `api.scout()` and `api.roadTo()` calls with `useScoutWorker()`.

- [ ] **Step 1: Update useScout.js**

Replace the entire file content:

```javascript
// client/src/hooks/useScout.js
import { useState, useCallback, useRef, useEffect } from 'react';
import { useScoutWorker } from './useScoutWorker';

const INITIAL_COUNT = 8;
const LOAD_MORE_COUNT = 8;

export function useScout() {
  const [locked, setLocked] = useState([]);
  const [excluded, setExcluded] = useState([]);
  const [emblems, setEmblems] = useState([]);
  const [level, setLevel] = useState(8);
  const [max5Cost, setMax5Cost] = useState(2);
  const [results, setResults] = useState([]);
  const [insights, setInsights] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [topN, setTopN] = useState(INITIAL_COUNT);
  const debounceRef = useRef(null);
  const { generate } = useScoutWorker();

  const addEmblem = useCallback((traitApiName) => {
    setEmblems(prev => [...prev, traitApiName]);
  }, []);

  const removeEmblem = useCallback((index) => {
    setEmblems(prev => prev.filter((_, i) => i !== index));
  }, []);

  const toggleLock = useCallback((apiName) => {
    setLocked(prev => {
      if (prev.includes(apiName)) return prev.filter(a => a !== apiName);
      return [...prev, apiName];
    });
    setExcluded(prev => prev.filter(a => a !== apiName));
    setTopN(INITIAL_COUNT);
  }, []);

  const toggleExclude = useCallback((apiName) => {
    setExcluded(prev => {
      if (prev.includes(apiName)) return prev.filter(a => a !== apiName);
      return [...prev, apiName];
    });
    setLocked(prev => prev.filter(a => a !== apiName));
    setTopN(INITIAL_COUNT);
  }, []);

  const clearAll = useCallback(() => {
    setLocked([]);
    setExcluded([]);
    setEmblems([]);
    setResults([]);
    setInsights([]);
    setTopN(INITIAL_COUNT);
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore) return;
    const newTopN = topN + LOAD_MORE_COUNT;
    setLoadingMore(true);
    try {
      const data = await generate({
        lockedChampions: locked,
        excludedChampions: excluded,
        emblems, level, max5Cost,
        topN: newTopN,
      });
      setResults(data.results || []);
      setInsights(data.insights || []);
      setTopN(newTopN);
    } catch (err) {
      console.error('Load more failed:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [locked, excluded, emblems, level, max5Cost, topN, loadingMore, generate]);

  const seedRef = useRef(0);

  const fetchScout = useCallback(async (randomize = false) => {
    if (randomize) seedRef.current = Math.floor(Math.random() * 1000000);
    setLoading(true);
    try {
      const data = await generate({
        lockedChampions: locked,
        excludedChampions: excluded,
        emblems, level, max5Cost,
        topN,
        seed: seedRef.current,
      });
      setResults(data.results || []);
      setInsights(data.insights || []);
    } catch (err) {
      console.error('Scout failed:', err);
      setResults([]);
      setInsights([]);
    } finally {
      setLoading(false);
    }
  }, [locked, excluded, emblems, level, max5Cost, topN, generate]);

  // Auto-scout with debounce when inputs change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchScout, 300);
    return () => clearTimeout(debounceRef.current);
  }, [locked, excluded, emblems, level, max5Cost]);

  return {
    locked, excluded, emblems, level, max5Cost, results, insights, loading, loadingMore,
    toggleLock, toggleExclude, addEmblem, removeEmblem, setLevel, setMax5Cost, clearAll, loadMore,
    regenerate: () => fetchScout(true),
  };
}
```

- [ ] **Step 2: Verify no remaining `api.scout` usage in scout flow**

```bash
grep -rn "api\.scout\|api\.roadTo" client/src/
```

Check that `api.scout` is only referenced in `api.js` (definition) and not called anywhere in hooks/components for the main scout flow. The `RoadTo` component may still use `api.roadTo()` — that needs updating too.

- [ ] **Step 3: Update RoadTo component if it calls `api.roadTo()`**

Search for `roadTo` usage in components:

```bash
grep -rn "roadTo\|road-to" client/src/components/
```

If found, update the component to use `useScoutWorker().roadTo()` instead of `api.roadTo()`. The worker's `roadTo` handler returns the same shape as the API response (array of results), so map accordingly:

In the component that calls `api.roadTo(params)`, replace with:

```javascript
const { roadTo } = useScoutWorker();
// ...
const results = await roadTo(params);  // returns array directly, not { results: [...] }
```

- [ ] **Step 4: Commit**

```bash
git add client/src/hooks/useScout.js client/src/components/
git commit -m "feat: wire useScout to Web Worker instead of API calls"
```

---

### Task 7: Handle scout-result mapping on client

**Files:**
- Possibly modify: `client/src/workers/scout.worker.js`

The backend `scout-result.mapper.js` transforms algorithm output (e.g., rounds scores, strips internal fields) before sending to the client. Since the algorithm now runs in the browser, we need to either:
- A) Apply the same mapping in the worker before posting results, or
- B) Use raw algorithm output directly (simpler, since the client controls the data anyway)

- [ ] **Step 1: Check what `scout-result.mapper.js` actually does**

Read `server/src/mappers/scout-result.mapper.js` and decide if the transformations matter for the client:

```bash
cat server/src/mappers/scout-result.mapper.js
```

Key transformations to check:
- Does it round scores? → Client can handle raw floats
- Does it strip fields? → Client may want all fields
- Does it rename fields? → Components expect specific field names

- [ ] **Step 2: Apply necessary transformations in the worker**

If the mapper renames fields or restructures data that components depend on, add a minimal `mapResult` function at the top of `scout.worker.js`:

```javascript
function mapResult(r) {
  return {
    champions: r.champions.map(c => ({
      apiName: c.apiName,
      baseApiName: c.baseApiName,
      name: c.name,
      cost: c.cost,
      role: c.role,
      traits: c.traits,
      variant: c.variant,
      slotsUsed: c.slotsUsed,
      icon: c.icon,
    })),
    activeTraits: r.activeTraits.map(t => ({
      apiName: t.apiName,
      name: t.name,
      icon: t.icon,
      count: t.count,
      style: t.activeStyle,
      breakpoint: t.activeBreakpoint,
    })),
    score: Math.round(r.score * 100) / 100,
    breakdown: r.breakdown,
    level: r.level,
    slotsUsed: r.slotsUsed,
    roles: r.roles,
    metaMatch: r.metaMatch || null,
  };
}
```

Then wrap results in `runGenerate`:

```javascript
return { results: results.map(mapResult), insights };
```

And in `runRoadTo`, wrap the final return:

```javascript
return results.map(mapResult);
```

- [ ] **Step 3: Verify field names match component expectations**

```bash
grep -rn "\.activeStyle\|\.activeBreakpoint\|\.style\b\|\.breakpoint\b" client/src/components/
```

Ensure the mapped field names (`style`, `breakpoint`) match what `CompCard.jsx`, `TeamDetail.jsx` etc. expect.

- [ ] **Step 4: Commit**

```bash
git add client/src/workers/scout.worker.js
git commit -m "feat: add result mapping in worker to match component expectations"
```

---

### Task 8: Test end-to-end

- [ ] **Step 1: Start the dev server**

```bash
cd server && node src/index.js &
cd client && npm run dev
```

- [ ] **Step 2: Open browser, test these scenarios**

1. **Page load** — should auto-generate teams (debounce fires after 300ms)
2. **Lock a champion** — results should update within ~1s (Worker compute time)
3. **Exclude a champion** — results update
4. **Add emblem** — results update
5. **Change level slider** — results update
6. **Click regenerate** — new results with different seed
7. **Load more** — appends more results
8. **Open DevTools → Network tab** — verify NO calls to `POST /api/scout`, only one `GET /api/scout/context` on initial load
9. **Open DevTools → Sources** — verify worker thread is visible

- [ ] **Step 3: Compare output quality**

Pick a specific locked champion set (e.g., lock Graves + Morgana at level 8). Compare:
- Old: `curl -X POST http://localhost:3001/api/scout -H 'Content-Type: application/json' -d '{"lockedChampions":["TFT17_Graves","TFT17_Morgana"],"level":8,"topN":3}'`
- New: results shown in UI

Scores and team compositions should be identical (same algorithm, same data, same seed=0).

- [ ] **Step 4: Commit any fixes found during testing**

```bash
git add -A
git commit -m "fix: adjustments from end-to-end testing"
```

---

### Task 9: Deploy and verify on Fly.io

- [ ] **Step 1: Deploy**

```bash
fly deploy
```

- [ ] **Step 2: Test on production**

Open `https://tft-generator.fly.dev`:
1. Verify teams generate without health check failures
2. Check Network tab — no `POST /api/scout` calls
3. Lock/unlock champions rapidly — should feel snappy (no server round-trip)

- [ ] **Step 3: Monitor health checks**

```bash
fly status
fly logs --no-tail | tail -20
```

Expected: health checks consistently passing, no more "instance refused connection" during generation.

- [ ] **Step 4: Final commit if needed**

```bash
git add -A
git commit -m "chore: deploy client-side algorithm to production"
```
