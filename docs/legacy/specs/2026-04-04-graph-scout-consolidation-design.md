# Graph Scout Consolidation — Design Spec

## Problem

Three scout implementations exist (v1 engine, v2 precomp, v3 graph). Graph scout (v3) is faster and produces better results but lacks mecha enhanced, stargazer variant, locked traits seeding, and proper transitions. Old scouts should be removed.

## Goal

Make graph scout the only scout. Add missing features, remove old code, simplify frontend to 2 tabs (Build + Scout).

## What gets removed

- `server/src/routes/scout.js` — old engine scout route (helpers extracted first)
- `server/src/routes/scout-v2.js` — precomp scout route
- `POST /api/scout` (old) and `POST /api/scout-v2` (precomp) endpoints
- Frontend "Scout" tab (replaced by Graph Scout renamed to "Scout")
- Fallback logic in `client/src/api.js`

## What gets added/moved

### 1. Extract scout helpers

Move `collectTraitAffinity`, `buildKeepSellAdd`, `estimateAddLevel` from `scout.js` to `server/src/scout-helpers.js`. These are used by graph scout and potentially other modules.

### 2. Mecha enhanced support

Graph scout generates TWO versions per candidate comp when `mechaEnhanced` is provided:
- **Normal**: team_size = endgameLevel (e.g. 9 slots, 9 champions)
- **Mecha**: team_size = endgameLevel - mechaEnhanced.length (e.g. 8 slots, 8 champions where 1 takes 2 slots = 9 effective)

Engine re-scores both with `mechaEnhanced` parameter. Mecha version gets engine's built-in mecha bonus (+2 + cost*0.5 per enhanced champ) and extra trait count.

Frontend: `FilterPanel` already has mecha UI in build mode — expose it in scout mode too.

### 3. Stargazer variant

Already in scout-v3 params but not passed to graph building. Fix: pass `stargazerVariant` to engine re-score (already done in `engineBase`). Graph doesn't need it — only engine scoring uses it for Stargazer trait rating aliasing.

### 4. Locked traits seeding

When player sets `lockedTraits` (e.g. "I want Rogue 4"), graph should seed champions of that trait similar to emblem pass. Add locked-trait pass: seed all champions of the locked trait + early units.

### 5. Lazy transitions

Current: graph scout builds simplified transitions inline (affordable subsets).

Change: remove inline transitions. Frontend calls `POST /api/transitions` (already exists) when user clicks "Show transitions". Pass the endgame comp + target level + early units.

Frontend `ScoutResultCard`: on expand click, fetch transitions from API if not cached.

### 6. Route consolidation

```
BEFORE:
  POST /api/scout      → old engine scout
  POST /api/scout-v2   → precomp scout  
  POST /api/scout-v3   → graph scout

AFTER:
  POST /api/scout      → graph scout (moved from v3)
  POST /api/scout/rebuild → rebuild graph cache
```

### 7. Frontend changes

- Remove "Scout" tab from mode toggle — rename "Graph Scout" to "Scout"
- 2 tabs: "Build comp" | "Scout"
- `api.js`: `scoutDirections()` calls `/api/scout` directly (no fallback)
- `FilterPanel`: show mecha enhanced picker in scout mode
- `ScoutResultCard`: lazy-load transitions on expand click

## File changes

| Action | File | What |
|--------|------|------|
| Create | `server/src/scout-helpers.js` | Extract collectTraitAffinity, buildKeepSellAdd, estimateAddLevel |
| Modify | `server/src/routes/scout-v3.js` | Add mecha, locked traits seeding, remove inline transitions |
| Rename | `server/src/routes/scout-v3.js` → mount at `/api/scout` | Route consolidation |
| Delete | `server/src/routes/scout.js` | Old engine scout (after helper extraction) |
| Delete | `server/src/routes/scout-v2.js` | Precomp scout |
| Modify | `server/src/index.js` | Remove old routes, rename v3 mount point |
| Modify | `client/src/api.js` | Simplify scoutDirections, add fetchTransitionsLazy |
| Modify | `client/src/components/FilterPanel.jsx` | 2 tabs, mecha in scout mode |
| Modify | `client/src/components/ScoutResultCard.jsx` | Lazy transition loading |
| Modify | `client/src/components/ResultsPanel.jsx` | Remove graph mode check |
| Modify | `client/src/i18n.jsx` | Remove old keys, rename graph to scout |
| Create | `server/tests/scout-v3.test.js` | Tests for consolidated scout |

## Mecha detail

```
Input: { earlyUnits: ['TFT17_Urgot'], mechaEnhanced: ['TFT17_Urgot'], currentLevel: 8 }
endgameLevel = 9

Graph generates:
  Pass A: teamSize=9 (normal Urgot, 1 slot)
  Pass B: teamSize=8 (mecha Urgot, 2 slots = 9 effective)

Engine re-scores both:
  Pass A: generateTeams(db, { lockedChampions: [...], mechaEnhanced: [], level: 9 })
  Pass B: generateTeams(db, { lockedChampions: [...], mechaEnhanced: ['TFT17_Urgot'], level: 9 })

Both scored, deduplicated, best per group shown.
```

## Lazy transitions detail

```
Frontend (ScoutResultCard):
  1. User clicks "Show transitions"
  2. If transitions cached → show
  3. Else → POST /api/transitions { team: endgameComp, targetLevel: 9, earlyUnits, bonusSlots }
  4. Cache response, show

Server: existing computeTransitions endpoint, no changes needed.
```
