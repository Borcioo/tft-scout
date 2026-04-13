# Graph Scout Consolidation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make graph scout the only scout — add missing features (mecha, stargazer, locked traits, lazy transitions), remove old scout routes, simplify frontend to 2 tabs.

**Architecture:** Extract shared helpers from old scout, enhance graph scout with mecha/locked-trait support, re-mount at `/api/scout`, update frontend to 2 tabs with lazy transition loading.

**Tech Stack:** Node.js, Express, SQLite (better-sqlite3), React, Vitest

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `server/src/scout-helpers.js` | Extracted: collectTraitAffinity, buildKeepSellAdd, estimateAddLevel |
| Modify | `server/src/routes/scout-v3.js` | Add mecha, locked traits seeding, remove inline transitions, import from scout-helpers |
| Modify | `server/src/index.js` | Remove old routes, mount v3 at `/api/scout` |
| Delete | `server/src/routes/scout.js` | Old engine scout |
| Delete | `server/src/routes/scout-v2.js` | Precomp scout |
| Modify | `client/src/api.js` | Simplify scoutDirections, add fetchTransitionsForComp |
| Modify | `client/src/components/FilterPanel.jsx` | 2 tabs (build/scout), remove graph mode |
| Modify | `client/src/components/ScoutResultCard.jsx` | Lazy transition loading |
| Modify | `client/src/components/ResultsPanel.jsx` | Remove graph mode condition |
| Modify | `client/src/i18n.jsx` | Remove graph keys, clean up |
| Modify | `server/tests/scout.test.js` | Update imports to scout-helpers |
| Create | `server/tests/scout-helpers.test.js` | Tests for extracted helpers |

---

### Task 1: Extract Scout Helpers

**Files:**
- Create: `server/src/scout-helpers.js`
- Create: `server/tests/scout-helpers.test.js`
- Modify: `server/tests/scout.test.js`

- [ ] **Step 1: Create scout-helpers.js with functions from scout.js**

```js
// server/src/scout-helpers.js

export function collectTraitAffinity(units) {
  const counts = {};
  for (const u of units) {
    for (const t of (u.traits || [])) {
      counts[t] = (counts[t] || 0) + 1;
    }
  }
  return counts;
}

export function estimateAddLevel(cost) {
  if (cost <= 1) return 5;
  if (cost === 2) return 6;
  if (cost === 3) return 7;
  if (cost === 4) return 8;
  return 9;
}

export function buildKeepSellAdd(earlyUnits, endgameChamps, directionTraits) {
  const endgameSet = new Set(endgameChamps.map(c => c.apiName));
  const directionTraitSet = new Set(directionTraits);

  const keep = [];
  const sellLater = [];
  const flex = [];

  for (const unit of earlyUnits) {
    if (endgameSet.has(unit.apiName)) {
      keep.push({ apiName: unit.apiName, name: unit.name, reason: 'in endgame comp' });
    } else {
      const hasOverlap = (unit.traits || []).some(t => directionTraitSet.has(t));
      if (hasOverlap) {
        const replacement = endgameChamps.find(c =>
          !earlyUnits.some(e => e.apiName === c.apiName) && c.cost > unit.cost
        );
        sellLater.push({
          apiName: unit.apiName, name: unit.name,
          replacedBy: replacement?.name || null,
          atLevel: replacement ? estimateAddLevel(replacement.cost) : null,
          reason: 'shares traits but upgrades available',
        });
      } else {
        flex.push({ apiName: unit.apiName, name: unit.name, reason: 'not in endgame — keep if upgraded' });
      }
    }
  }

  const earlySet = new Set(earlyUnits.map(u => u.apiName));
  const add = endgameChamps
    .filter(c => !earlySet.has(c.apiName))
    .map(c => ({
      apiName: c.apiName, name: c.name,
      atLevel: estimateAddLevel(c.cost),
    }));

  return { keep, sellLater, flex, add };
}
```

- [ ] **Step 2: Create scout-helpers.test.js**

Copy the existing tests from `server/tests/scout.test.js` but change the import:

```js
// server/tests/scout-helpers.test.js
import { describe, it, expect } from 'vitest';
import { collectTraitAffinity, buildKeepSellAdd, estimateAddLevel } from '../src/scout-helpers.js';

// Copy ALL existing tests from scout.test.js here unchanged
// (the tests import from scout-helpers instead of routes/scout)
```

Read `server/tests/scout.test.js` and copy all test content, only changing the import path from `'../src/routes/scout.js'` to `'../src/scout-helpers.js'`.

- [ ] **Step 3: Run new tests**

Run: `cd server && npx vitest run tests/scout-helpers.test.js`
Expected: All pass (same tests, same code)

- [ ] **Step 4: Update scout.test.js imports**

Change `server/tests/scout.test.js` to import from `../src/scout-helpers.js` instead of `../src/routes/scout.js`.

- [ ] **Step 5: Run all tests**

Run: `cd server && npx vitest run`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add server/src/scout-helpers.js server/tests/scout-helpers.test.js server/tests/scout.test.js
git commit -m "refactor: extract scout helpers to scout-helpers.js"
```

---

### Task 2: Update Scout V3 — Helpers Import + Mecha + Locked Traits

**Files:**
- Modify: `server/src/routes/scout-v3.js`

- [ ] **Step 1: Change import to scout-helpers**

In `server/src/routes/scout-v3.js`, change line 4:

```js
// FROM:
import { collectTraitAffinity, buildKeepSellAdd } from './scout.js';
// TO:
import { collectTraitAffinity, buildKeepSellAdd } from '../scout-helpers.js';
```

- [ ] **Step 2: Add mechaEnhanced support**

In the `scoutV3` function, after extracting params, add `mechaEnhanced`:

```js
const {
    earlyUnits: earlyApiNames = [],
    currentLevel = 5,
    bonusSlots = 0,
    emblems = [],
    excludedTraits = [],
    lockedTraits = [],
    max5Cost = null,
    stargazerVariant = null,
    mechaEnhanced = [],    // ADD THIS
  } = params;
```

Where graph generates candidates (`searchOpts`), generate two versions when mechaEnhanced is non-empty:

After the existing `addCandidates` calls (around line 78), add:

```js
  // Mecha pass: if player has mecha enhanced champions, also generate
  // smaller teams (N - mechaEnhanced.length) since enhanced champs take 2 slots
  if (mechaEnhanced.length > 0) {
    const mechaSize = targetSize - mechaEnhanced.length;
    if (mechaSize >= 3) {
      const mechaOpts = { ...searchOpts, teamSize: mechaSize };
      if (earlyApiNames.length > 0) {
        addCandidates(findTeams(graph, { ...mechaOpts, startChamps: earlyApiNames, maxResults: 10 }));
      }
      addCandidates(findTeams(graph, { ...mechaOpts, startChamps: [], maxResults: 10 }));
    }
  }
```

In the engine re-score section (`engineBase`), pass `mechaEnhanced`:

```js
  const engineBase = {
    lockedTraits: lockedTraits.map(t => typeof t === 'string' ? t : t),
    emblems, excludedChampions: [], excludedTraits,
    level: targetSize, roleBalance: null,
    mechaEnhanced,          // ADD THIS (was hardcoded [])
    stargazerVariant,
    max5Cost: max5Cost != null ? max5Cost : null,
    earlyBonusUnits: earlyApiNames.length > 0 ? earlyApiNames : null,
  };
```

- [ ] **Step 3: Add locked traits seeding**

After the emblem-seeded pass, add a locked-traits pass:

```js
  // Locked-trait pass: seed all champions of locked traits
  if (lockedTraits.length > 0) {
    for (const lt of lockedTraits) {
      const traitApi = typeof lt === 'string' ? lt : lt.apiName;
      const traitChamps = graph.traitMap[traitApi] || [];
      if (traitChamps.length === 0) continue;
      const seeds = [...new Set([...earlyApiNames, ...traitChamps])];
      addCandidates(findTeams(graph, { ...searchOpts, startChamps: seeds, maxResults: 10 }));
      addCandidates(findTeams(graph, { ...searchOpts, startChamps: traitChamps, maxResults: 5 }));
    }
  }
```

- [ ] **Step 4: Remove inline transitions**

In the directions formatting loop, the `transitions` computation block (the `for (let lvl = ...)` loop that builds `transitions`) should be removed. Replace with empty object:

Find the block that starts with `const MAX_COST_AT_LEVEL` and ends with the closing of the `transitions` building loop. Replace it with:

```js
    // Transitions loaded lazily via /api/transitions endpoint
    const transitions = {};
```

NOTE: Check current state of the file — inline transitions may already be simplified from previous work. If `transitions: {}` is already there, skip this step.

- [ ] **Step 5: Run all tests**

Run: `cd server && npx vitest run`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/scout-v3.js
git commit -m "feat(scout-v3): mecha enhanced, locked traits seeding, helpers import"
```

---

### Task 3: Route Consolidation — Remove Old Scouts

**Files:**
- Modify: `server/src/index.js`
- Delete: `server/src/routes/scout.js`
- Delete: `server/src/routes/scout-v2.js`

- [ ] **Step 1: Update index.js**

Read `server/src/index.js`. Make these changes:

Remove these imports:
```js
import { scoutRoutes } from './routes/scout.js';
import { scoutV2Routes } from './routes/scout-v2.js';
```

Change the scout-v3 import (if not already):
```js
import { scoutV3Routes } from './routes/scout-v3.js';
```

Remove these route registrations:
```js
app.use('/api/scout', scoutRoutes(db));
app.use('/api/scout-v2', scoutV2Routes(db));
```

Change scout-v3 mount point:
```js
// FROM:
app.use('/api/scout-v3', scoutV3Routes(db));
// TO:
app.use('/api/scout', scoutV3Routes(db));
```

- [ ] **Step 2: Delete old scout files**

```bash
git rm server/src/routes/scout.js
git rm server/src/routes/scout-v2.js
```

- [ ] **Step 3: Delete old scout-v2 tests**

```bash
git rm server/tests/scout-v2.test.js
git rm server/tests/scout-v2-integration.test.js
```

- [ ] **Step 4: Update scout.test.js**

`server/tests/scout.test.js` imports from `../src/routes/scout.js` which is deleted. In Task 1 we changed it to import from `../src/scout-helpers.js`. Verify it still passes. If `scout.test.js` still imports from the old path, update it.

- [ ] **Step 5: Run all tests**

Run: `cd server && npx vitest run`
Expected: All pass (old scout tests removed, helper tests remain)

- [ ] **Step 6: Commit**

```bash
git add server/src/index.js
git commit -m "refactor: remove old scout routes, mount graph scout at /api/scout"
```

---

### Task 4: Frontend — Simplify to 2 Tabs

**Files:**
- Modify: `client/src/api.js`
- Modify: `client/src/components/FilterPanel.jsx`
- Modify: `client/src/components/ResultsPanel.jsx`
- Modify: `client/src/i18n.jsx`

- [ ] **Step 1: Simplify api.js**

Replace the `scoutDirections` function and add `fetchTransitionsForComp`:

```js
export async function scoutDirections(params) {
  const res = await fetch(BASE + '/scout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}

export async function fetchTransitionsForComp(team, targetLevel, earlyUnits = [], bonusSlots = 0) {
  const res = await fetch(BASE + '/transitions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ team, targetLevel, earlyUnits, bonusSlots }),
  });
  return res.json();
}
```

Remove `scoutV3Directions` function if it exists.

- [ ] **Step 2: Simplify FilterPanel — 2 tabs**

In `client/src/components/FilterPanel.jsx`:

Remove the import of `scoutV3Directions`:
```js
// FROM:
import { generateTeams, getMetatftStatus, scoutDirections, scoutV3Directions } from '../api';
// TO:
import { generateTeams, getMetatftStatus, scoutDirections } from '../api';
```

Remove `handleGraphScout` handler entirely.

Remove the third "Graph Scout" button from the mode toggle. Keep only 2 buttons:
```jsx
<div className="flex mb-4 bg-gray-800 rounded border border-gray-700 p-0.5">
  <button onClick={() => setMode('build')}
    className={'flex-1 text-xs py-1.5 rounded transition-colors ' +
      (mode === 'build' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white')}>
    {t('mode.build')}
  </button>
  <button onClick={() => setMode('scout')}
    className={'flex-1 text-xs py-1.5 rounded transition-colors ' +
      (mode === 'scout' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white')}>
    {t('mode.scout')}
  </button>
</div>
```

Update level select condition — remove `|| mode === 'graph'` references. Just use `mode === 'scout'`.

Update champion picker label — same, remove `|| mode === 'graph'`.

Update generate button — remove `mode === 'graph'` branch:
```jsx
<button onClick={mode === 'scout' ? handleScout : handleGenerate} ...>
  {mode === 'scout' ? t('filter.scout_button') : t('filter.generate')}
</button>
```

- [ ] **Step 3: Simplify ResultsPanel**

In `client/src/components/ResultsPanel.jsx`, change:
```jsx
// FROM:
(mode === 'scout' || mode === 'graph') ? (
// TO:
mode === 'scout' ? (
```

- [ ] **Step 4: Clean up i18n**

In `client/src/i18n.jsx`, remove these keys from both `pl` and `en`:
```js
'mode.graph': ...,
'filter.graph_button': ...,
```

- [ ] **Step 5: Verify frontend builds**

Run: `cd client && npx vite build` (or check package.json for build command)
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add client/src/api.js client/src/components/FilterPanel.jsx client/src/components/ResultsPanel.jsx client/src/i18n.jsx
git commit -m "feat: simplify frontend to 2 tabs (build + scout)"
```

---

### Task 5: Lazy Transitions in ScoutResultCard

**Files:**
- Modify: `client/src/components/ScoutResultCard.jsx`

- [ ] **Step 1: Add lazy transition loading**

Replace the ScoutResultCard component. Key changes:
- Import `fetchTransitionsForComp` from api
- On expand click, if transitions are empty, fetch from API
- Cache transitions in component state
- Show loading spinner while fetching

```jsx
import { useState } from 'react';
import { useI18n } from '../i18n.jsx';
import { fetchTransitionsForComp } from '../api';
import TraitBadge from './TraitBadge';

// ... ChampIcon and getConfidence unchanged ...

export default function ScoutResultCard({ direction, rank }) {
  const { t } = useI18n();
  const { earlyAnalysis, endgameComp } = direction;
  const confidence = getConfidence(direction, t);
  const [expanded, setExpanded] = useState(false);
  const [transitions, setTransitions] = useState(direction.transitions || {});
  const [loadingTransitions, setLoadingTransitions] = useState(false);

  const handleExpand = async () => {
    if (!expanded && Object.keys(transitions).length === 0 && endgameComp) {
      setLoadingTransitions(true);
      try {
        const result = await fetchTransitionsForComp(
          endgameComp,
          endgameComp.champions?.length || 9
        );
        setTransitions(result || {});
      } catch (err) {
        console.error('Failed to load transitions:', err);
      } finally {
        setLoadingTransitions(false);
      }
    }
    setExpanded(!expanded);
  };

  // ... rest of JSX unchanged, except:
  // Replace onClick={() => setExpanded(!expanded)} with onClick={handleExpand}
  // Add loading state in expanded section:
  // {expanded && loadingTransitions && <p className="text-xs text-gray-500 animate-pulse">{t('team.generating_transitions')}</p>}
  // {expanded && !loadingTransitions && Object.keys(transitions).length > 0 && ( ... existing transitions JSX ... )}
```

Read the current full `ScoutResultCard.jsx` and apply these changes precisely.

- [ ] **Step 2: Verify transitions load on click**

Start server (`cd server && node src/index.js`) and frontend (`cd client && npm run dev`).
Test: open Scout tab, submit query, click "Show transitions" on a direction card.
Expected: Loading spinner, then transitions appear.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/ScoutResultCard.jsx
git commit -m "feat: lazy-load transitions on expand click"
```

---

### Task 6: Rename Scout V3 File

**Files:**
- Rename: `server/src/routes/scout-v3.js` → `server/src/routes/scout.js`

- [ ] **Step 1: Rename the file**

```bash
cd server && git mv src/routes/scout-v3.js src/routes/scout.js
```

- [ ] **Step 2: Update index.js import**

```js
// FROM:
import { scoutV3Routes } from './routes/scout-v3.js';
// TO:
import { scoutV3Routes } from './routes/scout.js';
```

- [ ] **Step 3: Update any test imports referencing scout-v3**

Check `server/tests/scout-v3.test.js` — if it exists, update its import path.

- [ ] **Step 4: Run all tests**

Run: `cd server && npx vitest run`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: rename scout-v3.js to scout.js — single scout implementation"
```

---

### Task 7: Smoke Test

- [ ] **Step 1: Start server and test all endpoints**

```bash
cd server && node src/index.js
```

Test scout:
```bash
curl -X POST http://localhost:3001/api/scout -H "Content-Type: application/json" -d '{"earlyUnits":["TFT17_Shen","TFT17_Jhin"],"currentLevel":5,"bonusSlots":0,"emblems":[],"excludedTraits":[],"lockedTraits":[],"max5Cost":null}'
```

Test rebuild:
```bash
curl -X POST http://localhost:3001/api/scout/rebuild
```

Test transitions:
```bash
curl -X POST http://localhost:3001/api/transitions -H "Content-Type: application/json" -d '{"team":{"champions":[{"apiName":"TFT17_Shen"},{"apiName":"TFT17_Jhin"}]},"targetLevel":8}'
```

Test build still works:
```bash
curl -X POST http://localhost:3001/api/generate -H "Content-Type: application/json" -d '{"lockedChampions":["TFT17_Shen"],"level":8}'
```

Expected: All return valid JSON, no errors.

- [ ] **Step 2: Test frontend**

Open browser, verify:
- Only 2 tabs: "Build comp" and "Scout"
- Scout works, shows directions
- Click "Show transitions" loads transitions lazily
- Build comp still works

- [ ] **Step 3: Verify old endpoints are gone**

```bash
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3001/api/scout-v2 -H "Content-Type: application/json" -d '{}'
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3001/api/scout-v3 -H "Content-Type: application/json" -d '{}'
```

Expected: 404 for both (routes removed)

- [ ] **Step 4: Commit any fixes**

```bash
git add -u
git commit -m "fix: adjustments from smoke test"
```
