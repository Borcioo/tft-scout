# Saved Teams Feature — Design

**Date:** 2026-04-09
**Status:** Approved for planning

## Problem

The TFT Scout currently has no way to save generated teams. When the user sees a team they like, they have no way to return to it later. With the algorithm now driven by live MetaTFT data that refreshes daily, a team that looked great yesterday may be completely absent from today's suggestions — losing useful compositions the user wanted to play or study.

## Goals

1. **Save interesting teams** with a heart icon on each result card. Persistent across sessions.
2. **Separate page** listing all saved teams, accessible via navigation.
3. **Live re-score** each saved team using current MetaTFT data to show drift over time.
4. **Quick access** — click a saved team to open it in the existing team detail view.
5. **Set-aware archival** — old-set teams remain viewable but segregated from the current set.

Out of scope: sharing teams between users, cloud sync, version history beyond latest score, team edit/merge, snapshot of full scoring breakdown at save time.

## Data model

Saved teams live in `localStorage` under the key `tft-scout:saved-teams`. The value is a JSON array of saved team records.

```js
{
  id: "uuid-v4",              // stable identifier generated at save time
  setVersion: "TFT17",        // derived from champion apiName prefix
  championApis: [             // sorted alphabetically for dedup
    "TFT17_Bard",
    "TFT17_Blitzcrank",
    "TFT17_MissFortune_conduit",
    // ... (9 total for level 9)
  ],
  level: 9,
  emblems: ["TFT17_ResistTank"],             // sorted alphabetically
  lockedChampions: ["TFT17_MissFortune_conduit"],  // reference only, not in dedup
  savedScore: 236.9,          // score at moment of save (for drift comparison)
  savedAt: "2026-04-09T10:42:00.000Z",       // ISO timestamp
  note: ""                    // optional user note (empty by default)
}
```

**Dedup key:** `${setVersion}|${level}|${championApis.join(",")}|${emblems.join(",")}`

Identity is defined by set + level + composition + emblems. The same 9 champions at level 8 with different emblems count as a different saved team, because the play context is different. `lockedChampions` is informational only — the same team generated with different locks is still the same team.

**Set version detection:** parse the first character sequence after the `TFT` prefix in any champion apiName. For `TFT17_Bard` → `"TFT17"`. If no champions share a common prefix (shouldn't happen in practice), fall back to `"unknown"`.

## Storage module — `client/src/storage/savedTeams.js`

Single module owning all localStorage interaction. UI code never touches localStorage directly.

**Public API:**

```js
export function listSavedTeams(setVersion = null): SavedTeam[]
export function isTeamSaved(team): boolean
export function saveTeam(team): SavedTeam
export function unsaveTeam(id): void
export function toggleSaveTeam(team): { saved: boolean, record: SavedTeam | null }
export function updateSavedTeam(id, patch): SavedTeam  // merges patch fields (e.g. { note: "..." })
```

`listSavedTeams()` returns all teams when `setVersion` is null, otherwise filters to only that set. Results are sorted by `savedAt` descending (newest first).

**Internals:**
- `loadAll()` — reads and parses JSON from localStorage, returns empty array on parse error (graceful recovery)
- `persist(all)` — serializes and writes, throws on QuotaExceededError (caller handles)
- `makeDedupKey(team)` — returns the composite key string
- `deriveSetVersion(championApis)` — extracts the set prefix
- `normalizeTeam(team)` — sorts arrays and computes derived fields

**Error handling:** `persist()` wraps localStorage.setItem in try/catch. On QuotaExceededError it throws a clear error with message `"Saved teams storage full. Please remove some teams."`. On parse error in `loadAll()`, logs to console and returns empty array — better to start fresh than crash the page.

## React hook — `client/src/hooks/useSavedTeams.js`

Thin reactive wrapper around the storage module. Provides multi-tab sync via the browser `storage` event.

```js
export function useSavedTeams() {
  const [teams, setTeams] = useState(() => listSavedTeams());

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === 'tft-scout:saved-teams') setTeams(listSavedTeams());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const toggle = useCallback((comp) => {
    const team = mapCompToSavedTeam(comp);
    toggleSaveTeam(team);
    setTeams(listSavedTeams());
  }, []);

  const isSaved = useCallback((comp) =>
    isTeamSaved(mapCompToSavedTeam(comp)),
  [teams]);

  const remove = useCallback((id) => {
    unsaveTeam(id);
    setTeams(listSavedTeams());
  }, []);

  const updateNote = useCallback((id, note) => {
    const all = listSavedTeams();
    const idx = all.findIndex(t => t.id === id);
    if (idx < 0) return;
    all[idx].note = note;
    // persist via unsave+save would regen id — we need an update primitive in the storage module
    // decision: add updateTeam(id, patch) to savedTeams.js for this
    updateSavedTeam(id, { note });
    setTeams(listSavedTeams());
  }, []);

  return { teams, toggle, isSaved, remove, updateNote };
}
```

This implies one additional storage function: `updateSavedTeam(id, patch)` in `savedTeams.js` that merges a partial update into an existing record and re-persists.

**`mapCompToSavedTeam(comp)`** translates the worker's team output shape (from `scout.worker.js:mapResult`) into the saved team shape. It extracts `championApis`, the `level`, filters emblems from the current context, and captures the score.

## Like button in CompCard

In `client/src/components/scout/CompCard.jsx`, add a heart icon button in the top-right corner.

```jsx
import { Heart } from 'lucide-react';
import { useSavedTeams } from '@/hooks/useSavedTeams';

// Inside the component:
const { toggle, isSaved } = useSavedTeams();
const saved = isSaved(comp);

<button
  onClick={(e) => { e.stopPropagation(); toggle(comp); }}
  className="absolute top-2 right-2 p-1 rounded hover:bg-accent/50 transition-colors"
  aria-label={saved ? "Unsave team" : "Save team"}
>
  <Heart className={`w-4 h-4 ${saved ? 'fill-red-500 text-red-500' : 'text-muted-foreground'}`} />
</button>
```

`e.stopPropagation()` prevents the click from bubbling to the card's existing "explore" handler. The `emblems` and `level` needed for `mapCompToSavedTeam` must be threaded down to `CompCard` as props from `ResultList` / `ScoutPanel` (they already know them — just pass down).

## Routing and navigation

**Dependency:** add `react-router-dom` (~13KB gzipped, standard React routing).

**`client/src/App.jsx` becomes:**

```jsx
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { ScoutPanel } from '@/components/scout/ScoutPanel';
import { SavedTeamsPage } from '@/components/saved/SavedTeamsPage';

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-background px-3 py-4 sm:px-6 sm:py-6">
        <nav className="mb-4 flex gap-4 text-sm font-mono">
          <NavLink
            to="/"
            end
            className={({ isActive }) => isActive ? 'text-foreground font-bold' : 'text-muted-foreground hover:text-foreground'}
          >
            Scout
          </NavLink>
          <NavLink
            to="/saved"
            className={({ isActive }) => isActive ? 'text-foreground font-bold' : 'text-muted-foreground hover:text-foreground'}
          >
            Saved Teams
          </NavLink>
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

The two-route setup allows for future expansion (e.g., `/insights`, `/history`) without further restructuring.

## SavedTeamsPage component

New file: `client/src/components/saved/SavedTeamsPage.jsx`.

**Responsibilities:**
1. Fetch `/api/scout/context` once on mount (same call the worker uses). Cache result in local state.
2. Load saved teams via `useSavedTeams` hook.
3. Determine current set by inspecting the fetched context (first champion's apiName prefix).
4. Split saved teams into `current` (setVersion matches current set) and `archived` (other sets).
5. Re-score every `current` team using `rescoreTeam()` (see next section).
6. Render two sections: "Current" (with re-scored teams and drift badges) and "Archived" (collapsible, teams shown as-is with no re-score).
7. Support inline explore — clicking a saved team sets `selectedTeam` local state and renders `TeamDetail` in place of the list.
8. Each current team shows: saved date, note (inline editable), drift badge, heart (to unsave), explore arrow.

**Inline explore pattern:** local `useState(null)` for `selectedTeam`. When set, render `<TeamDetail ... onBack={() => setSelectedTeam(null)} />` instead of the list. Same pattern as `ScoutPanel` uses today.

**Layout:**
- Page title "Saved Teams"
- Optional toggle "Show archived (N)" — hidden by default if 0
- List of team cards (reuse `CompCard` with a `variant="saved"` prop)
- Empty state: "No saved teams yet. Click the heart on any team in Scout to save it."

**Sort order:** newest first (`savedAt` desc).

**Loading state:** show "Loading..." while context fetch is in flight.

## Re-score helper — `client/src/algorithm/re-score.js`

Lightweight scoring for a single team without running the generator.

```js
import { teamScore } from './scorer.js';
import { buildActiveTraits } from './active-traits.js';

/**
 * Re-score a saved team using current scoring context.
 *
 * @param {object} params
 * @param {string[]} params.championApis
 * @param {number} params.level
 * @param {string[]} params.emblems
 * @param {object} params.context - { champions, traits, scoringCtx }
 * @returns {{ score: number | null, missing: number, champions: object[] }}
 */
export function rescoreTeam({ championApis, level, emblems, context }) {
  const { champions, traits, scoringCtx } = context;

  const champs = championApis
    .map(api => champions.find(c => c.apiName === api))
    .filter(Boolean);

  const missing = championApis.length - champs.length;
  if (missing > 0) {
    return { score: null, missing, champions: champs };
  }

  const activeTraits = buildActiveTraits(champs, traits, emblems);
  const score = teamScore({ champions: champs, activeTraits, level }, scoringCtx);
  return { score, missing: 0, champions: champs };
}
```

If any saved champion is missing from the pool (new patch removed it), `score` is null and the UI handles it as a broken/archived team.

## Extracted module — `client/src/algorithm/active-traits.js`

The active traits computation currently lives inline inside `engine.js:71-116`. Extract it to a new module so both `engine.js` and `re-score.js` can use it without duplication.

```js
/**
 * Compute active traits for a team given champion objects and emblems.
 * Applies Mecha enhanced 2x counting and emblem holder capping rules.
 *
 * @param {object[]} champions - champion objects with { apiName, traits, variant, ... }
 * @param {object[]} allTraits - all trait definitions with breakpoints
 * @param {string[]} emblems - emblem trait apiNames
 * @returns {object[]} activeTraits with { apiName, name, icon, count, breakpoints, activeStyle, activeBreakpoint }
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

  // Apply emblems — capped by non-trait champions as holders
  const champTraitSets = champions.map(c => new Set(c.traits || []));
  const emblemsByTrait = {};
  for (const e of emblems) emblemsByTrait[e] = (emblemsByTrait[e] || 0) + 1;
  for (const [trait, count] of Object.entries(emblemsByTrait)) {
    const holders = champTraitSets.filter(ts => !ts.has(trait)).length;
    const usable = Math.min(count, holders);
    if (usable > 0) traitCounts[trait] = (traitCounts[trait] || 0) + usable;
  }

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

Modify `engine.js` to import and call `buildActiveTraits` instead of inlining the logic. Verify behavior is unchanged by running a few scenarios (manual verification in browser — no unit tests exist).

## Drift badge

On saved team cards, display saved-vs-current score comparison:

```jsx
function DriftBadge({ savedScore, currentScore }) {
  if (currentScore == null) {
    return <span className="text-xs font-mono text-muted-foreground">⚠ cannot rescore</span>;
  }
  const delta = currentScore - savedScore;
  const absDelta = Math.abs(delta);
  const arrow = delta >= 0 ? '▲' : '▼';
  const color =
    delta >= 0 ? 'text-green-500' :
    delta >= -10 ? 'text-yellow-500' :
    'text-red-500';
  return (
    <span className={`text-xs font-mono ${color}`}>
      saved {savedScore.toFixed(1)} → now {currentScore.toFixed(1)} ({arrow} {absDelta.toFixed(1)})
    </span>
  );
}
```

Thresholds: green for any positive or neutral delta, yellow for -0.1 to -10, red for worse than -10. Arrow ▲ for up, ▼ for down.

## Missing champion handling

When `rescoreTeam` returns `missing > 0`, the saved team is marked as broken:

- `score` field shows "⚠ cannot rescore" instead of drift badge
- Team card shows warning: "N champion(s) no longer available: names"
- Team remains in the list — user can manually remove via heart toggle
- No auto-deletion (user's decision, no silent data loss)

For set changes: an entire old-set team (all champions missing from current set) falls into the archived section automatically because its `setVersion` no longer matches the detected current set. Archived section does not attempt re-score at all — teams display as historical snapshots only.

## Files touched

**New files:**
- `client/src/storage/savedTeams.js`
- `client/src/hooks/useSavedTeams.js`
- `client/src/components/saved/SavedTeamsPage.jsx`
- `client/src/components/saved/DriftBadge.jsx` (small, optional — could be inline)
- `client/src/algorithm/re-score.js`
- `client/src/algorithm/active-traits.js`

**Modified files:**
- `client/src/App.jsx` — add router and nav
- `client/src/components/scout/CompCard.jsx` — add heart button
- `client/src/components/scout/ResultList.jsx` — pass level/emblems props to CompCard if not already
- `client/src/components/scout/ScoutPanel.jsx` — pass level/emblems props down
- `client/src/algorithm/engine.js` — replace inline active traits computation with `buildActiveTraits` call
- `client/package.json` — add `react-router-dom` dependency

## Testing

No unit test framework exists in `client/`. Manual verification plan:

1. **Save/unsave** — click heart on a team, reload page, heart still filled; click again, heart empty, reload, still empty.
2. **Dedup** — generate same team twice (same seed), click save on both, only one entry in localStorage.
3. **Different context dedup** — same composition at lvl 8 vs lvl 9 produces two separate saves.
4. **Navigation** — click Saved Teams nav, see list; click Scout nav, back to scout with all state preserved.
5. **Re-score** — save a team, wait for next MetaTFT refresh (or manually run DB update), reload saved page, drift badge shows non-zero delta.
6. **Inline explore** — click a saved team, see TeamDetail; click back, return to list.
7. **Missing champion** — manually edit localStorage to include a fake apiName, reload saved page, team shows warning instead of score.
8. **Set archival** — manually edit localStorage to include `setVersion: "TFT16"`, reload, team appears in archived section only.
9. **Multi-tab sync** — open saved page in two tabs, save in one, second tab updates on focus.
10. **Empty state** — clear localStorage, saved page shows "No saved teams yet" message.
11. **Note editing** — click a note field, type text, blur, reload — note persisted.
12. **Quota handling** — fill localStorage to near-quota manually, try to save, error message appears (not silent failure).

## Out of scope (explicit)

- Cloud sync / account / server storage
- Sharing saved teams (export/import JSON is a minor follow-up, not in this plan)
- Team editing (swap champions, change emblems)
- Score history beyond latest value (no sparkline yet)
- Tagging or categorization beyond the note field
- Pagination for large saved lists (localStorage caps at ~5MB ≈ thousands of teams; pagination is premature)
- Set version detection by DB query — we derive from apiName prefix client-side only
