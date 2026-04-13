# Saved Teams — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the ability to save ("like") generated teams to localStorage, view them on a dedicated `/saved` page with live re-scoring against current MetaTFT data, and archive teams from previous sets.

**Architecture:** Pure client-side feature using localStorage for persistence. Storage is isolated in one module. React hook provides reactive UI access with multi-tab sync via the browser `storage` event. Re-scoring uses the existing `teamScore` function directly on saved compositions (no generator rerun). A new `/saved` route is introduced using `react-router-dom`.

**Tech Stack:** React 19 + Vite, ES modules, localStorage, `react-router-dom` (new dep), `lucide-react` (already present) for the heart icon.

**Source spec:** `docs/superpowers/specs/2026-04-09-saved-teams-design.md`

**Commit strategy:** 4 logical commits total (refactor + infra + heart button + router/page). Verification task produces no commit.

**Verification:** No unit tests exist in `client/`. Use `npm run build` (from `client/`) after each group to catch errors. Manual browser testing at the end (Task 7).

---

## File Structure

**New files:**
- `client/src/algorithm/active-traits.js` — pure function extracted from engine.js
- `client/src/algorithm/re-score.js` — single-team re-score helper
- `client/src/storage/savedTeams.js` — localStorage wrapper
- `client/src/hooks/useSavedTeams.js` — reactive hook around storage
- `client/src/components/saved/SavedTeamsPage.jsx` — the new page
- `client/src/components/saved/DriftBadge.jsx` — score drift display

**Modified files:**
- `client/src/algorithm/engine.js` — replace inline active traits with import
- `client/src/App.jsx` — add router and navigation
- `client/src/components/scout/CompCard.jsx` — add heart button
- `client/src/components/scout/ResultList.jsx` — accept and pass `level`, `emblems` props
- `client/src/components/scout/ScoutPanel.jsx` — pass `level`, `emblems` to ResultList
- `client/package.json` — add `react-router-dom` dependency

---

## Task 1: Extract `buildActiveTraits` from `engine.js`

**Goal:** Move the active traits computation into its own module so `re-score.js` can reuse it. Pure refactor — behavior must be identical.

**Files:**
- Create: `client/src/algorithm/active-traits.js`
- Modify: `client/src/algorithm/engine.js` (remove inline logic, add import)

- [ ] **Step 1: Create `active-traits.js` with the extracted function**

Create file `client/src/algorithm/active-traits.js` with content:

```js
/**
 * Compute active traits for a team given champion objects and emblems.
 *
 * Pure function extracted from engine.js so it can be reused by both
 * the generator (which builds it after findTeams) and the re-score
 * helper (which scores a saved team without running the generator).
 *
 * Applies:
 * - Mecha "enhanced" 2x counting for TFT17_Mecha trait
 * - Emblem holder capping (emblem only counts for champs not already having the trait)
 *
 * @param {object[]} champions - champion objects with { apiName, traits, variant, ... }
 * @param {object[]} allTraits - all trait definitions with breakpoints
 * @param {string[]} emblems - emblem trait apiNames
 * @returns {object[]} active traits
 */
export function buildActiveTraits(champions, allTraits, emblems) {
  const traitMap = {};
  for (const t of allTraits) traitMap[t.apiName] = t;

  const traitCounts = {};
  for (const c of champions) {
    for (const t of c.traits) {
      const isMechaEnhanced = c.variant === 'enhanced' && t === 'TFT17_Mecha';
      traitCounts[t] = (traitCounts[t] || 0) + (isMechaEnhanced ? 2 : 1);
    }
  }

  // Emblems — capped by non-trait champions available as holders
  const champTraitSets = champions.map(c => new Set(c.traits || []));
  const emblemsByTrait = {};
  for (const e of (emblems || [])) emblemsByTrait[e] = (emblemsByTrait[e] || 0) + 1;
  for (const [trait, count] of Object.entries(emblemsByTrait)) {
    const holders = champTraitSets.filter(ts => !ts.has(trait)).length;
    const usable = Math.min(count, holders);
    if (usable > 0) traitCounts[trait] = (traitCounts[trait] || 0) + usable;
  }

  // Build active traits list (only traits that hit at least the first breakpoint)
  const activeTraits = [];
  for (const [apiName, count] of Object.entries(traitCounts)) {
    const traitDef = traitMap[apiName];
    if (!traitDef) continue;

    const sorted = [...(traitDef.breakpoints || [])].sort((a, b) => a.minUnits - b.minUnits);
    let activeBp = null;
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (count >= sorted[i].minUnits) { activeBp = sorted[i]; break; }
    }
    if (!activeBp) continue;

    activeTraits.push({
      apiName,
      name: traitDef.name,
      icon: traitDef.icon,
      count,
      breakpoints: sorted,
      activeStyle: activeBp.style,
      activeBreakpoint: activeBp.minUnits,
    });
  }

  return activeTraits;
}
```

- [ ] **Step 2: Update `engine.js` to import and use the extracted function**

Open `client/src/algorithm/engine.js`. At the top of the file, add to the existing imports:

```js
import { buildActiveTraits } from './active-traits.js';
```

Then find the `enriched = rawTeams.map(team => { ... })` block (around lines 74-116). Inside that callback, locate the region that computes `traitCounts`, applies emblems, and builds `activeTraits`. Replace that whole region with a single call:

```js
    let totalSlots = 0;
    for (const c of team.champions) totalSlots += c.slotsUsed || 1;
    const activeTraits = buildActiveTraits(team.champions, traits, constraints.emblems || []);
```

Keep the rest of the map callback body intact — the re-score, breakdown, roles calls that follow are unchanged. Only the trait counting block and activeTraits building are replaced.

Also: if the outer function declares `const traitMap = {};` and builds it only for the inline block you just removed, delete those lines too. If `traitMap` is used elsewhere in the function, leave it.

- [ ] **Step 3: Verify build passes**

From `D:/Projekty/tft-generator/client`:

```bash
npm run build
```

Expected: exit 0, `dist/` produced. Fix any missing import error if it appears.

- [ ] **Step 4: Commit**

```bash
cd D:/Projekty/tft-generator
git add client/src/algorithm/active-traits.js client/src/algorithm/engine.js
git commit -m "refactor(algorithm): extract buildActiveTraits to its own module

Move the inline active-traits computation out of engine.js into
active-traits.js so the upcoming re-score helper can reuse the same
logic without duplicating it. Behavior is unchanged.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

Verify: `git log -1 --oneline` shows the new commit.

---

## Task 2: Create the re-score helper

**Goal:** Single lightweight function that scores an existing saved team against current data without running the generator.

**Files:**
- Create: `client/src/algorithm/re-score.js`

- [ ] **Step 1: Create `re-score.js`**

Create file `client/src/algorithm/re-score.js` with content:

```js
/**
 * Re-score a saved team using the current scoring context.
 *
 * This is NOT the generator — it does not explore compositions. It
 * simply computes the score of a specific (already-chosen) team using
 * the current MetaTFT ratings. Used by the SavedTeamsPage to show
 * drift between "score at save time" and "score now".
 *
 * If any champion is missing from the current pool (e.g. removed in a
 * patch), returns `{ score: null, missing: N, champions }` so the UI
 * can render a warning instead of a broken score.
 */

import { teamScore } from './scorer.js';
import { buildActiveTraits } from './active-traits.js';

/**
 * @param {object} params
 * @param {string[]} params.championApis - apiNames from the saved team
 * @param {number} params.level - player level at save time
 * @param {string[]} params.emblems - emblem trait apiNames at save time
 * @param {object} params.context - { champions, traits, scoringCtx } from /api/scout/context
 * @returns {{ score: number | null, missing: number, champions: object[], activeTraits: object[] }}
 */
export function rescoreTeam({ championApis, level, emblems, context }) {
  const { champions, traits, scoringCtx } = context;

  const champs = championApis
    .map(api => champions.find(c => c.apiName === api))
    .filter(Boolean);

  const missing = championApis.length - champs.length;
  if (missing > 0) {
    return { score: null, missing, champions: champs, activeTraits: [] };
  }

  const activeTraits = buildActiveTraits(champs, traits, emblems);
  const score = teamScore({ champions: champs, activeTraits, level }, scoringCtx);
  return { score, missing: 0, champions: champs, activeTraits };
}
```

- [ ] **Step 2: Verify build passes**

```bash
cd D:/Projekty/tft-generator/client && npm run build
```

Expected: exit 0.

- [ ] **Step 3: Skip commit** — this task commits together with Task 3 and 4 as the "infra" commit in Task 4 Step 3.

---

## Task 3: Storage module (`savedTeams.js`)

**Goal:** Single module owning all localStorage interaction. Provides a stable API so the UI never touches localStorage directly.

**Files:**
- Create: `client/src/storage/savedTeams.js`

- [ ] **Step 1: Create directory**

Ensure directory exists:

```bash
mkdir -p D:/Projekty/tft-generator/client/src/storage
```

- [ ] **Step 2: Create the storage module**

Create `client/src/storage/savedTeams.js` with content:

```js
/**
 * Saved teams — localStorage wrapper.
 *
 * Public API (everything UI code should call):
 *   listSavedTeams(setVersion?)       → array sorted by savedAt desc
 *   isTeamSaved(team)                 → boolean
 *   saveTeam(team)                    → SavedTeam
 *   unsaveTeam(id)                    → void
 *   toggleSaveTeam(team)              → { saved, record }
 *   updateSavedTeam(id, patch)        → SavedTeam | null
 */

const STORAGE_KEY = 'tft-scout:saved-teams';

function loadAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error('[savedTeams] parse error, starting fresh:', e);
    return [];
  }
}

function persist(all) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch (e) {
    if (e && e.name === 'QuotaExceededError') {
      throw new Error('Saved teams storage full. Please remove some teams.');
    }
    throw e;
  }
}

function uuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function deriveSetVersion(championApis) {
  for (const api of championApis) {
    const match = /^(TFT\d+)_/.exec(api);
    if (match) return match[1];
  }
  return 'unknown';
}

function normalizeTeam(team) {
  const championApis = [...(team.championApis || [])].sort();
  const emblems = [...(team.emblems || [])].sort();
  const lockedChampions = [...(team.lockedChampions || [])].sort();
  const setVersion = team.setVersion || deriveSetVersion(championApis);
  return {
    id: team.id || uuid(),
    setVersion,
    championApis,
    level: team.level,
    emblems,
    lockedChampions,
    savedScore: team.savedScore ?? null,
    savedAt: team.savedAt || new Date().toISOString(),
    note: team.note || '',
  };
}

function makeDedupKey(team) {
  const n = normalizeTeam(team);
  return `${n.setVersion}|${n.level}|${n.championApis.join(',')}|${n.emblems.join(',')}`;
}

// ── Public API ─────────────────────────────────────────────

export function listSavedTeams(setVersion = null) {
  const all = loadAll();
  const filtered = setVersion == null
    ? all
    : all.filter(t => t.setVersion === setVersion);
  return [...filtered].sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
}

export function isTeamSaved(team) {
  const key = makeDedupKey(team);
  return loadAll().some(t => makeDedupKey(t) === key);
}

export function saveTeam(team) {
  const all = loadAll();
  const normalized = normalizeTeam(team);
  const key = makeDedupKey(normalized);
  const existing = all.find(t => makeDedupKey(t) === key);
  if (existing) return existing;
  all.push(normalized);
  persist(all);
  return normalized;
}

export function unsaveTeam(id) {
  const all = loadAll();
  const next = all.filter(t => t.id !== id);
  if (next.length === all.length) return;
  persist(next);
}

export function toggleSaveTeam(team) {
  const all = loadAll();
  const key = makeDedupKey(team);
  const existing = all.find(t => makeDedupKey(t) === key);
  if (existing) {
    const next = all.filter(t => t.id !== existing.id);
    persist(next);
    return { saved: false, record: null };
  }
  const normalized = normalizeTeam(team);
  all.push(normalized);
  persist(all);
  return { saved: true, record: normalized };
}

export function updateSavedTeam(id, patch) {
  const all = loadAll();
  const idx = all.findIndex(t => t.id === id);
  if (idx < 0) return null;
  const merged = { ...all[idx], ...patch };
  const finalRecord = normalizeTeam({ ...merged, id: all[idx].id, savedAt: all[idx].savedAt });
  all[idx] = finalRecord;
  persist(all);
  return finalRecord;
}
```

- [ ] **Step 3: Verify build passes**

```bash
cd D:/Projekty/tft-generator/client && npm run build
```

Expected: exit 0.

- [ ] **Step 4: Skip commit** — continues in Task 4.

---

## Task 4: React hook `useSavedTeams`

**Goal:** Reactive wrapper around the storage module with multi-tab sync.

**Files:**
- Create: `client/src/hooks/useSavedTeams.js`

- [ ] **Step 1: Create the hook**

Create `client/src/hooks/useSavedTeams.js` with content:

```js
/**
 * useSavedTeams — reactive access to the saved-teams storage.
 *
 * Consumers call toggle(comp, ctx) with the worker-shaped comp object,
 * not with a pre-shaped SavedTeam. The hook handles the mapping via
 * mapCompToSavedTeam.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  listSavedTeams,
  isTeamSaved,
  toggleSaveTeam,
  unsaveTeam,
  updateSavedTeam,
} from '@/storage/savedTeams';

const STORAGE_KEY = 'tft-scout:saved-teams';

/**
 * Map a worker-shaped comp object to a SavedTeam payload.
 */
export function mapCompToSavedTeam(comp, { level, emblems = [], lockedChampions = [] }) {
  const championApis = (comp.champions || []).map(c => c.apiName);
  return {
    championApis,
    level,
    emblems,
    lockedChampions,
    savedScore: comp.score ?? null,
  };
}

export function useSavedTeams(setVersion = null) {
  const [teams, setTeams] = useState(() => listSavedTeams(setVersion));

  useEffect(() => {
    setTeams(listSavedTeams(setVersion));
  }, [setVersion]);

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY) setTeams(listSavedTeams(setVersion));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [setVersion]);

  const toggle = useCallback((comp, ctx) => {
    const team = mapCompToSavedTeam(comp, ctx);
    const result = toggleSaveTeam(team);
    setTeams(listSavedTeams(setVersion));
    return result;
  }, [setVersion]);

  const isSaved = useCallback((comp, ctx) => {
    const team = mapCompToSavedTeam(comp, ctx);
    return isTeamSaved(team);
  }, [teams]); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = useCallback((id) => {
    unsaveTeam(id);
    setTeams(listSavedTeams(setVersion));
  }, [setVersion]);

  const updateNote = useCallback((id, note) => {
    updateSavedTeam(id, { note });
    setTeams(listSavedTeams(setVersion));
  }, [setVersion]);

  return { teams, toggle, isSaved, remove, updateNote };
}
```

- [ ] **Step 2: Verify build passes**

```bash
cd D:/Projekty/tft-generator/client && npm run build
```

Expected: exit 0.

- [ ] **Step 3: Commit (infrastructure — Tasks 2 + 3 + 4)**

```bash
cd D:/Projekty/tft-generator
git add client/src/algorithm/re-score.js client/src/storage/savedTeams.js client/src/hooks/useSavedTeams.js
git commit -m "feat(saved-teams): add storage layer, hook and re-score helper

Introduces the client-side foundation for the Saved Teams feature:
storage/savedTeams.js owns localStorage access with save/unsave/toggle
and dedup by (setVersion|level|champions|emblems); hooks/useSavedTeams.js
is the reactive wrapper with multi-tab sync via the browser storage
event; algorithm/re-score.js provides lightweight single-team scoring
without running the generator.

No UI changes yet; the heart button and /saved page land in follow-ups.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

Verify: `git log -2 --oneline` shows this on top of the Task 1 refactor.

---

## Task 5: Heart button in CompCard + thread props

**Goal:** Add the save/unsave heart to each team card in Scout results.

**Files:**
- Modify: `client/src/components/scout/CompCard.jsx`
- Modify: `client/src/components/scout/ResultList.jsx`
- Modify: `client/src/components/scout/ScoutPanel.jsx`

- [ ] **Step 1: Read CompCard to find the card root element**

Use the Read tool on `client/src/components/scout/CompCard.jsx` to identify the top-level element and how props are destructured.

- [ ] **Step 2: Add imports + hook usage + heart button in CompCard**

Open `client/src/components/scout/CompCard.jsx`. Three edits:

**2a. Add imports at the top (after existing imports):**

```jsx
import { Heart } from 'lucide-react';
import { useSavedTeams } from '@/hooks/useSavedTeams';
```

**2b. Add `level`, `emblems`, `lockedChampions` to the component's destructured props.** Example signature (adapt to the existing one, preserving all existing props):

```jsx
export function CompCard({ comp, level, emblems = [], lockedChampions = [], onExplore, ...rest }) {
```

**2c. Inside the component body, add hook usage and the heart button.** After props destructure but before the return, add:

```jsx
  const { toggle, isSaved } = useSavedTeams();
  const saved = isSaved(comp, { level, emblems, lockedChampions });
```

Then inject the heart button as the FIRST child of the card's root element. Ensure the root element's className contains `relative` so absolute positioning works:

```jsx
      <button
        type="button"
        onClick={(ev) => { ev.stopPropagation(); toggle(comp, { level, emblems, lockedChampions }); }}
        className="absolute top-2 right-2 p-1 rounded hover:bg-accent/50 transition-colors z-10"
        aria-label={saved ? 'Unsave team' : 'Save team'}
        title={saved ? 'Unsave team' : 'Save team'}
      >
        <Heart className={`w-4 h-4 ${saved ? 'fill-red-500 text-red-500' : 'text-muted-foreground'}`} />
      </button>
```

`ev.stopPropagation()` is critical so that clicking the heart does not bubble up to the card's explore handler.

- [ ] **Step 3: Thread props through ResultList**

Open `client/src/components/scout/ResultList.jsx`. Add `level`, `emblems`, `lockedChampions` to the destructured props if they are not already present:

```jsx
export function ResultList({ results, locked, emblems, level, lockedChampions = [], loading, loadingMore, onLoadMore, onExplore }) {
```

Then, where `ResultList` renders each `CompCard`, forward these props:

```jsx
<CompCard
  comp={comp}
  level={level}
  emblems={emblems}
  lockedChampions={locked || lockedChampions}
  onExplore={onExplore}
/>
```

If `locked` is the current prop for "locked champion apiNames" in ResultList, pass it as `lockedChampions`. If the variable name differs, pick whatever conveys that meaning.

- [ ] **Step 4: Ensure ScoutPanel passes `level` and `emblems` to ResultList**

Open `client/src/components/scout/ScoutPanel.jsx`. Find the `<ResultList ... />` render and verify `level`, `emblems`, `locked` are passed. If any are missing, add them:

```jsx
<ResultList
  results={filteredResults}
  locked={locked}
  emblems={emblems}
  level={level}
  loading={scoutLoading}
  loadingMore={loadingMore}
  onLoadMore={loadMore}
  onExplore={setSelectedTeam}
/>
```

- [ ] **Step 5: Verify build passes**

```bash
cd D:/Projekty/tft-generator/client && npm run build
```

Expected: exit 0. If the build fails on `@/hooks/useSavedTeams` resolution, verify the alias is configured in `vite.config.js` or `jsconfig.json` (should map `@` to `client/src/`).

- [ ] **Step 6: Commit**

```bash
cd D:/Projekty/tft-generator
git add client/src/components/scout/CompCard.jsx client/src/components/scout/ResultList.jsx client/src/components/scout/ScoutPanel.jsx
git commit -m "feat(saved-teams): heart button to save/unsave teams in Scout

Adds a small heart icon to the top-right corner of each CompCard.
Click toggles save state for the current comp, scoped by the current
level + emblems + locked champions so the same champion set under
different play contexts counts as distinct saves. Clicks stopPropagate
to avoid triggering the card's existing explore handler. Threads
level + emblems props from ScoutPanel through ResultList to CompCard.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Router + SavedTeamsPage

**Goal:** Install `react-router-dom`, add `/saved` route with navigation, implement SavedTeamsPage with re-score, drift badges, note editing, inline explore, archive section.

**Files:**
- Modify: `client/package.json` (via npm install)
- Modify: `client/src/App.jsx`
- Create: `client/src/components/saved/DriftBadge.jsx`
- Create: `client/src/components/saved/SavedTeamsPage.jsx`

- [ ] **Step 1: Install react-router-dom**

From `D:/Projekty/tft-generator/client`:

```bash
npm install react-router-dom
```

Expected: installs latest version, updates `package.json` and `package-lock.json`. If it fails due to peer-dep conflict with React 19, retry with `--legacy-peer-deps` and note it in the commit message. React Router 6.20+ supports React 19.

- [ ] **Step 2: Update `App.jsx` with router and nav**

Open `client/src/App.jsx`. Replace the entire file with:

```jsx
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { ScoutPanel } from '@/components/scout/ScoutPanel';
import { SavedTeamsPage } from '@/components/saved/SavedTeamsPage';

const navLinkCls = ({ isActive }) =>
  isActive
    ? 'text-foreground font-bold'
    : 'text-muted-foreground hover:text-foreground transition-colors';

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-background px-3 py-4 sm:px-6 sm:py-6">
        <nav className="mb-4 flex items-center gap-4 text-sm font-mono">
          <NavLink to="/" end className={navLinkCls}>Scout</NavLink>
          <NavLink to="/saved" className={navLinkCls}>Saved Teams</NavLink>
        </nav>
        <Routes>
          <Route path="/" element={<ScoutPanel />} />
          <Route path="/saved" element={<SavedTeamsPage />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
```

- [ ] **Step 3: Create `DriftBadge` component**

```bash
mkdir -p D:/Projekty/tft-generator/client/src/components/saved
```

Create `client/src/components/saved/DriftBadge.jsx` with content:

```jsx
/**
 * Show score drift with color coding.
 *
 * Green: delta >= 0
 * Yellow: -10 < delta < 0
 * Red:    delta <= -10
 * Grey:   currentScore is null (missing champions)
 */
export function DriftBadge({ savedScore, currentScore }) {
  if (currentScore == null) {
    return (
      <span className="text-xs font-mono text-muted-foreground">
        ⚠ cannot rescore
      </span>
    );
  }
  const delta = currentScore - savedScore;
  const absDelta = Math.abs(delta);
  const arrow = delta >= 0 ? '▲' : '▼';
  const color =
    delta >= 0 ? 'text-green-500'
    : delta > -10 ? 'text-yellow-500'
    : 'text-red-500';
  return (
    <span className={`text-xs font-mono ${color}`}>
      saved {savedScore.toFixed(1)} → now {currentScore.toFixed(1)} ({arrow} {absDelta.toFixed(1)})
    </span>
  );
}
```

- [ ] **Step 4: Create `SavedTeamsPage` component**

Create `client/src/components/saved/SavedTeamsPage.jsx` with content:

```jsx
/**
 * SavedTeamsPage
 *
 * Fetches /api/scout/context once, detects the current set from champion
 * apiName prefixes, partitions saved teams into current-set and archived,
 * re-scores every current team, and renders cards with drift badges,
 * editable notes, inline explore, and a collapsible archive section.
 */

import { useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useSavedTeams } from '@/hooks/useSavedTeams';
import { rescoreTeam } from '@/algorithm/re-score';
import { teamScoreBreakdown, teamRoleBalance } from '@/algorithm/scorer';
import { TeamDetail } from '@/components/scout/TeamDetail';
import { DriftBadge } from './DriftBadge';

function deriveCurrentSet(context) {
  if (!context || !context.champions || context.champions.length === 0) return 'unknown';
  for (const c of context.champions) {
    const match = /^(TFT\d+)_/.exec(c.apiName || '');
    if (match) return match[1];
  }
  return 'unknown';
}

/**
 * Re-hydrate a saved team into the shape TeamDetail expects.
 */
function hydrateForDetail(saved, context, rescore) {
  const level = saved.level;
  const champions = rescore.champions;
  const activeTraits = rescore.activeTraits;
  const scoringCtx = context.scoringCtx;
  const score = rescore.score ?? 0;
  const slotsUsed = champions.reduce((s, c) => s + (c.slotsUsed || 1), 0);
  const breakdown = teamScoreBreakdown(
    { champions, activeTraits, level, roleBalance: null },
    scoringCtx
  );
  const roles = teamRoleBalance(champions);

  return {
    champions,
    activeTraits,
    score,
    level,
    slotsUsed,
    breakdown,
    roles,
    metaMatch: null,
    itemBuilds: null,
  };
}

export function SavedTeamsPage() {
  const [context, setContext] = useState(null);
  const [contextError, setContextError] = useState(null);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [showArchived, setShowArchived] = useState(false);

  const { teams, remove, updateNote } = useSavedTeams();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/scout/context');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) setContext(json);
      } catch (e) {
        if (!cancelled) setContextError(e.message || String(e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const currentSet = useMemo(() => deriveCurrentSet(context), [context]);

  const { currentTeams, archivedTeams } = useMemo(() => {
    const cur = [];
    const arch = [];
    for (const t of teams) {
      if (t.setVersion === currentSet) cur.push(t);
      else arch.push(t);
    }
    return { currentTeams: cur, archivedTeams: arch };
  }, [teams, currentSet]);

  const rescored = useMemo(() => {
    if (!context) return new Map();
    const map = new Map();
    for (const t of currentTeams) {
      map.set(t.id, rescoreTeam({
        championApis: t.championApis,
        level: t.level,
        emblems: t.emblems,
        context,
      }));
    }
    return map;
  }, [currentTeams, context]);

  if (!context && !contextError) {
    return <div className="text-muted-foreground font-mono p-4">Loading...</div>;
  }
  if (contextError) {
    return (
      <div className="text-red-500 font-mono p-4">
        Failed to load scoring context: {contextError}
      </div>
    );
  }

  if (selectedTeam) {
    return (
      <TeamDetail
        comp={selectedTeam}
        emblems={selectedTeam.__savedEmblems || []}
        level={selectedTeam.level}
        onBack={() => setSelectedTeam(null)}
        onExplore={setSelectedTeam}
      />
    );
  }

  const empty = teams.length === 0;

  return (
    <div className="space-y-4">
      <h1 className="text-base sm:text-lg font-mono font-bold tracking-tight">Saved Teams</h1>

      {empty && (
        <p className="text-muted-foreground font-mono text-sm">
          No saved teams yet. Click the heart on any team in Scout to save it.
        </p>
      )}

      {currentTeams.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-mono text-muted-foreground uppercase tracking-wide">
            Current ({currentSet}) · {currentTeams.length}
          </h2>
          <ul className="space-y-3">
            {currentTeams.map((t) => {
              const rs = rescored.get(t.id);
              if (!rs) return null;
              const missingNames = rs.missing > 0
                ? t.championApis
                    .filter(api => !rs.champions.some(c => c.apiName === api))
                    .join(', ')
                : '';
              return (
                <li key={t.id} className="rounded border border-border bg-muted/40 p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-mono text-muted-foreground">
                        lvl {t.level} · {t.emblems.length > 0 ? t.emblems.join(', ') : 'no emblems'} · saved {new Date(t.savedAt).toLocaleDateString()}
                      </div>
                      <div className="mt-1 font-mono text-sm truncate">
                        {rs.champions.map(c => c.name).join(', ')}
                        {rs.missing > 0 && ` (+${rs.missing} missing)`}
                      </div>
                      <div className="mt-1">
                        <DriftBadge savedScore={t.savedScore} currentScore={rs.score} />
                      </div>
                      {rs.missing > 0 && (
                        <div className="mt-1 text-xs font-mono text-yellow-500">
                          ⚠ {rs.missing} champion(s) no longer available: {missingNames}
                        </div>
                      )}
                      <input
                        type="text"
                        value={t.note || ''}
                        onChange={(ev) => updateNote(t.id, ev.target.value)}
                        placeholder="Add a note..."
                        className="mt-2 w-full bg-muted text-foreground text-xs font-mono rounded px-2 py-1 border border-border"
                      />
                    </div>
                    <div className="flex flex-col gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          if (rs.missing > 0) return;
                          const comp = hydrateForDetail(t, context, rs);
                          comp.__savedEmblems = t.emblems;
                          setSelectedTeam(comp);
                        }}
                        disabled={rs.missing > 0}
                        className="text-xs font-mono px-2 py-1 rounded bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        explore →
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(t.id)}
                        className="text-xs font-mono px-2 py-1 rounded bg-muted text-muted-foreground hover:bg-accent hover:text-foreground border border-border transition-colors flex items-center gap-1"
                        aria-label="Delete saved team"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {archivedTeams.length > 0 && (
        <section className="space-y-3">
          <button
            type="button"
            onClick={() => setShowArchived(s => !s)}
            className="text-sm font-mono text-muted-foreground hover:text-foreground transition-colors"
          >
            {showArchived ? '▼' : '▶'} Archived ({archivedTeams.length})
          </button>
          {showArchived && (
            <ul className="space-y-3">
              {archivedTeams.map((t) => (
                <li key={t.id} className="rounded border border-border/50 bg-muted/20 p-3 opacity-70">
                  <div className="text-xs font-mono text-muted-foreground">
                    {t.setVersion} · lvl {t.level} · saved {new Date(t.savedAt).toLocaleDateString()}
                  </div>
                  <div className="mt-1 font-mono text-sm truncate">
                    {t.championApis.map(api => api.replace(/^TFT\d+_/, '')).join(', ')}
                  </div>
                  <div className="mt-1 text-xs font-mono text-muted-foreground">
                    saved score: {t.savedScore != null ? t.savedScore.toFixed(1) : 'n/a'}
                  </div>
                  {t.note && (
                    <div className="mt-1 text-xs font-mono italic text-muted-foreground">
                      "{t.note}"
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => remove(t.id)}
                    className="mt-2 text-xs font-mono px-2 py-1 rounded bg-muted text-muted-foreground hover:bg-accent hover:text-foreground border border-border transition-colors"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Verify build passes**

```bash
cd D:/Projekty/tft-generator/client && npm run build
```

Expected: exit 0. If `TeamDetail` import fails, check the export (it's a named export — see `ScoutPanel.jsx` import). If `teamScoreBreakdown`/`teamRoleBalance` fail, verify exports in `scorer.js`.

- [ ] **Step 6: Commit**

```bash
cd D:/Projekty/tft-generator
git add client/package.json client/package-lock.json client/src/App.jsx client/src/components/saved/DriftBadge.jsx client/src/components/saved/SavedTeamsPage.jsx
git commit -m "feat(saved-teams): /saved route with re-scored list and drift display

Installs react-router-dom and introduces the Saved Teams page with nav
in the app header. The page fetches current scoring context, partitions
saved teams into current-set and archived, and re-scores every current
team to show drift since it was saved. Cards include an editable note
field, a Trash2 delete button, and an explore button that opens the
existing TeamDetail inline without changing routes. Archived teams
from previous sets are collapsed by default.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Manual verification

**Files:** None (runtime verification only).

**Prerequisites:** Dev server running:

```bash
cd D:/Projekty/tft-generator/client && npm run dev
```

Open the browser to the reported URL (e.g. `http://localhost:5176/`).

- [ ] **Step 1: Save and unsave persists across reload**

Open Scout. Hover the first team card — a heart appears top-right. Click it: it fills red. Reload the page: still filled. Click again: unfills. Reload: still empty. Check DevTools > Application > Local Storage for the `tft-scout:saved-teams` key toggling.

- [ ] **Step 2: Dedup prevents duplicate saves**

Save a team, click Regenerate. If the same team reappears, its heart is already filled. localStorage count stays at 1 for that team.

- [ ] **Step 3: Different context = different save**

Save a team at lvl 9. Change level to 8. Regenerate. Save an equivalent team — it is NOT already filled (different level = different save). Saved count = 2.

- [ ] **Step 4: Navigation to /saved**

Click "Saved Teams" in the top nav. URL → `/saved`. Page shows saved teams grouped by "Current (TFT17)". Each card shows level, emblems, saved date, champion names, drift badge, empty note input. Click "Scout" in the nav — URL returns to `/` with all ScoutPanel state intact.

- [ ] **Step 5: Drift badge colors**

Saved teams show the drift badge. Since data is fresh, most deltas are near zero (green ▲). To test colors artificially:

Open DevTools Console and run:

```js
const all = JSON.parse(localStorage.getItem('tft-scout:saved-teams'));
all[0].savedScore = 999;
localStorage.setItem('tft-scout:saved-teams', JSON.stringify(all));
```

Reload `/saved`. First team shows a red ▼ badge with a large negative delta. Reset by running the same with `999` replaced by the actual current score.

- [ ] **Step 6: Inline explore**

On `/saved`, click "explore →" on any card. The list disappears and `TeamDetail` renders in place, showing champions, traits, item builds. Click back in `TeamDetail`. List returns as it was. URL stays on `/saved` throughout.

- [ ] **Step 7: Note editing**

On `/saved`, click the note input on any card and type "good comp". Blur. Reload. Note persists.

- [ ] **Step 8: Delete via trash button**

Click the trash icon on a card. Card disappears. Reload — stays deleted.

- [ ] **Step 9: Missing champion shows warning**

In the Console run:

```js
const all = JSON.parse(localStorage.getItem('tft-scout:saved-teams'));
all[0].championApis.push('TFT17_NonexistentChamp');
localStorage.setItem('tft-scout:saved-teams', JSON.stringify(all));
```

Reload `/saved`. That card now shows "⚠ cannot rescore", a yellow warning line with the missing apiName, and a disabled "explore →" button. Delete the team via the trash icon to clean up.

- [ ] **Step 10: Archive section**

In the Console run:

```js
const all = JSON.parse(localStorage.getItem('tft-scout:saved-teams'));
all[0].setVersion = 'TFT16';
localStorage.setItem('tft-scout:saved-teams', JSON.stringify(all));
```

Reload `/saved`. First team is no longer in "Current" — it lives under "▶ Archived (1)". Click to expand. Shows historical info only (no re-score, no drift badge, no explore button). Click Delete. Reload — archive section is gone when empty.

- [ ] **Step 11: Empty state**

In the Console:

```js
localStorage.removeItem('tft-scout:saved-teams');
```

Reload `/saved`. Shows "No saved teams yet. Click the heart on any team in Scout to save it."

- [ ] **Step 12: Multi-tab sync**

Open two tabs at `/saved`. In tab 1, go to Scout and save a new team. Switch back to tab 2 — click around to trigger a focus/storage event. Tab 2's list should reflect the new team. If it doesn't update automatically, clicking "Saved Teams" nav to force a rerender should show it.

- [ ] **Step 13: Report findings**

If all 12 steps pass, report "Manual verification passed, feature ready". If any step fails, document the step number, what was observed vs expected, and stop. Root-cause investigation is a separate task — do NOT attempt a blind patch.

---

## Out of scope (explicit)

- Cloud sync / server-side storage
- Sharing / export / import of saved teams
- Team editing (swap champions, change emblems after saving)
- Score history sparklines (only latest value is tracked)
- Tagging / categorization beyond the note field
- Pagination for large lists (localStorage ~5MB is not a real limit for TFT teams)
- Migration of saved teams across set boundaries
- Changes to `scout.worker.js` `mapResult` shape

## Summary of commits this plan produces

1. **`refactor(algorithm): extract buildActiveTraits to its own module`** — Task 1
2. **`feat(saved-teams): add storage layer, hook and re-score helper`** — Tasks 2 + 3 + 4
3. **`feat(saved-teams): heart button to save/unsave teams in Scout`** — Task 5
4. **`feat(saved-teams): /saved route with re-scored list and drift display`** — Task 6

Task 7 is verification only — no commit.
