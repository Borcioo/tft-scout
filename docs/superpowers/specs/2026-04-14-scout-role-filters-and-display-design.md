# Scout Role Filters & Card Display

**Date:** 2026-04-14
**Status:** Design approved, awaiting plan

## Goal

Restore legacy feature: scout UI exposes per-team role composition (frontline / dps / fighter) on each result card, plus min-frontline / min-dps hard filters that constrain which comps survive into the result list.

Legacy reference: `D:/Projekty/tft-generator/client/src/components/scout/ScoutPanel.jsx` (lines 21–43, 84–108) and `CompCard.jsx` (lines 87–103).

## Background

`ScoredTeam.roles` is already populated by the worker (`workers/scout/engine.ts:123` writes `{ frontline, dps, fighter }`). The data is live; it is simply not consumed by either the UI cards or any filter. The legacy app showed it inline on every card and let the user filter by `effectiveFL = frontline + 0.5 * fighter` and `effectiveDPS = dps + 0.5 * fighter`.

Soft `roleBalance` penalty in `scorer.ts:46` (`roleBalancePenalty`) is orthogonal to this feature. It biases scoring; the new filter is a hard cut. Both can coexist.

## Architecture

Extends four existing files. No new modules.

| File | Change |
|---|---|
| `resources/js/workers/scout/types.ts` | `ScoutParams` and `ScoutConstraints` gain optional `minFrontline?: number` and `minDps?: number` (default `0`). |
| `resources/js/workers/scout/index.ts` | Destructure the two new params and pass them through to `engine.generate`. |
| `resources/js/workers/scout/engine.ts` | After candidates are scored, apply hard filter on `effectiveFL` / `effectiveDPS` **before** the top-N slice. Skip filter entirely when both mins are `0`. |
| `resources/js/pages/Scout/Index.tsx` | Hold `minFrontline` and `minDps` in state, include them in `paramsKey`, pass to `generate(...)`. |
| `resources/js/components/scout/ScoutControls.tsx` | Two new `Slider` controls (shadcn): `Min Frontline` and `Min DPS`, both `min=0 max=6 step=1`. |
| `resources/js/components/scout/ScoutCompCard.tsx` | Render role icons + counts when `team.roles != null`. |

## Data flow

```
ScoutControls (Min FL slider, Min DPS slider)
   ↓ onMinFrontlineChange / onMinDpsChange
ScoutIndex state { minFrontline, minDps }
   ↓ JSON.stringify into paramsKey, debounced 300 ms
useScoutWorker.generate({ ...params, minFrontline, minDps })
   ↓ postMessage to worker
worker/index.ts → engine.generate
   ↓ score every candidate (unchanged)
   ↓ if (minFrontline > 0 || minDps > 0) filter:
   ↓     const fl  = roles.frontline + 0.5 * roles.fighter
   ↓     const dps = roles.dps       + 0.5 * roles.fighter
   ↓     keep iff fl >= minFrontline && dps >= minDps
   ↓ sort by score desc (unchanged)
   ↓ slice topN (unchanged)
postMessage results
   ↓
ScoutResultsList → ScoutCompCard
   ↓
Card row renders icons:
   <Shield class="text-blue-400"/> {roles.frontline}
   <Swords class="text-red-400"/>  {roles.dps}
   <Hand   class="text-yellow-400"/> {roles.fighter}   // only if > 0
```

## Filter semantics

- `minFrontline === 0 && minDps === 0` → skip the filter entirely (fast path mirroring legacy `ScoutPanel.jsx:36`).
- Filter is applied to scored candidates **before** the top-N slice, so when the result set shrinks the surviving comps are still the top-scoring ones that satisfy the constraint.
- Fighter half-counts toward both axes (`+ 0.5 * fighter`), matching legacy and `scorer.ts:teamRoleBalance`.
- A comp with `roles == null` (should not happen after `engine.ts:123` but defensively checked) fails the filter and is dropped.

## UI controls

- Two shadcn `Slider` instances appended to `ScoutControls`, below the existing `roleBalance` toggle.
- Range `0..6`, step `1`, default `0`.
- Label format: `Min Frontline: 2`, `Min DPS: 3`. Value `0` is shown literally as `0` (no `–` placeholder).
- No reset button. Sliders return to `0` by hand. (Legacy had a `Clear` button; current `ScoutControls` has none and we do not introduce one.)

## Card display

- Icons from `lucide-react`: `Shield` (frontline, `text-blue-400`), `Swords` (dps, `text-red-400`), `Hand` (fighter / flex, `text-yellow-400`).
- Inline flex row, `gap-1 text-xs font-mono text-muted-foreground`, placed alongside the existing trait bar (right side, `shrink-0`).
- Render only when `team.roles != null`.
- Render `fighter` slot only when `roles.fighter > 0`.

## Edge cases

- **Beam empty after filter** → `results = []`. `ScoutResultsList` already renders the empty state; no new copy needed.
- **Locked vs filter conflict** (e.g. user locks 4 DPS champions, sets `minFrontline=4`) → engine returns `0` survivors. User sees `0 comps` in the header counter. No dedicated warning UI (YAGNI).
- **Slider both at `0`** → fast path, identical behaviour to today.
- **Param change during in-flight worker call** → handled by existing debounced `paramsKey` re-trigger; nothing new needed.

## Testing

- No new unit tests. The change is one filter line plus UI wiring.
- Manual smoke test: set `minFrontline = 4`, confirm every visible card shows `>= 4` in the frontline icon. Set `minDps = 4`, confirm `>= 4` dps. Set both to `0`, confirm result count returns to baseline.

## Out of scope

- Persisting filter state across reloads.
- Showing role composition anywhere other than `ScoutCompCard` (e.g. inside `WhyThisComp` or `ScoutResultsList` header).
- A third slider for `minFighter` or a `maxFrontline` cap.
- Replacing or tuning the existing `roleBalance` soft-penalty toggle.
