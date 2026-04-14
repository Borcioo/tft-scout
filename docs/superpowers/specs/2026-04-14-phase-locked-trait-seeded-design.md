# `phaseLockedTraitSeeded` — loose trait-lock design

## Problem

`lockedTraits` are currently a post-filter in `engine.ts`. Phases inside
`findTeams` never receive them, so they build generic teams ignoring the
constraint and the filter throws nearly everything out. Commit `c686156`
fixed the **tight case** (pool size == minUnits) by auto-promoting the
entire pool into `locked`. The **loose case** (pool size > minUnits)
still returns far fewer results than possible — with `DarkStar:4` on a
7-champion pool the user expects dozens of distinct compositions but
only sees a handful because the team-builder never gets seeded with
lock-satisfying combinations.

## Goal

Add a dedicated phase that seeds team building with lock-satisfying
combinations so the loose case yields the full expected variety without
breaking the existing tight case, non-lock runs, or any other phase.

## Non-goals

- Changing how `lockedTraits` work at the engine boundary (still accepted
  as `{apiName, minUnits}[]`, still applied as a post-filter fail-safe).
- Re-tuning global scoring weights or search budget for non-lock runs.
- Decomposing the existing phases into anything smaller.
- Adding a scout-lab preset for lock-heavy scenarios (future session).

## Decisions (from brainstorm)

| # | Decision | Rationale |
|---|---|---|
| 1 | Hard cap of 50 attempts per invocation | Covers typical TFT17 pool sizes (`C(7,4)=35`, `C(8,5)=56`), keeps runtime predictable (~50 × 5 ms = 250 ms) |
| 2 | Multi-lock handled by union pool + graph-based `smart_pick`, not Cartesian enumeration | Scales to any number of locks, naturally handles champions with trait overlap, reuses `buildOneTeam` for fillers |
| 3 | New phase runs first in `findTeams` pipeline (before `phaseTemperatureSweep`) | Lock-satisfying teams populate the result map before other phases consume shared early-exit budget |
| 4 | Dedicated cap of 50 attempts, independent of `maxResults` / `searchMultiplier` | Deterministic runtime, does not starve other phases of budget |
| 5 | Hybrid seed selection: 20 top-unit-rating + 20 companion-pair + 10 cost-stratified | Combines three signals — proven strength, MetaTFT "plays together" data, and diversity guard |

## Architecture

New phase `phaseLockedTraitSeeded` lives in
`resources/js/workers/scout/synergy-graph.ts` next to the existing
phases. It activates only when `context.lockedTraits.length > 0`.

Two interface changes are needed:

1. `engine.ts::generate` passes `lockedTraits` into the `findTeams`
   options object. Currently it only passes `excludedTraits`.
2. `findTeams` forwards `lockedTraits` into the `context` object shared
   with every phase, so `phaseCtx.context.lockedTraits` is available.

The phase runs **first** in the pipeline. Its results go into the same
`results` Map every other phase writes to, so `diversifyResults` can
group and slice them alongside temperatureSweep / traitSeeded / …
output uniformly. The engine-side post-filter still runs
(`traitLocks.forEach(…)`) and acts as a fail-safe if a seeded team
somehow drifts off-constraint.

## Components

Four internal functions inside the phase module:

### `buildLockedTraitPool(lockedTraits, graph, excludedSet, allowedSet)`

Input: `lockedTraits`, `graph`, `excludedSet`, `allowedSet` (all already
available inside `findTeams`).

Output: `Map<traitApiName, Champion[]>` — for each locked trait, the
champions that carry it and pass the `excluded` + `allowed` gates and
are not hero variants.

If **any** trait's pool has fewer champions than its `minUnits`, returns
`null`. The phase aborts and the engine-side filter returns zero comps
(the user sees a clean "impossible constraint" signal instead of a
partial list).

### `pickSeedsForAttempt(pool, lockedTraits, rng, strategy, attemptIndex)`

Returns a `string[]` of apiNames to feed into `buildOneTeam` as seeds.
Strategy is one of three:

- `'top-unit-rating'` — for each locked trait, pick `minUnits` champions
  from its pool sorted by `unitRating` descending (tie-break by apiName
  lexicographic for determinism). `attemptIndex` shifts the slice
  window, so attempt 0 takes the top `minUnits`, attempt 1 shifts by 1,
  etc. With 20 attempts and a pool of 7, the window rotates through
  every realistic top-K combination without enumerating explicitly.
- `'companion-pair'` — scan `(A, B)` where `A` is in one locked trait's
  pool and `B` is in another (or the same, for single-lock), both
  appear in `ctx.companions` data, and `companion.avgPlace < 4.0`.
  Sort pairs by `avgPlace` ascending. Each attempt picks the next
  unseen pair and fills the rest of each trait's `minUnits` with
  random unit-rating-weighted picks from its pool.
- `'cost-stratified'` — for each locked trait, pick `minUnits`
  champions with a deliberate cost spread (prefer at least one low-
  cost, one mid-cost, one high-cost). Breaks echo-chamber seeds where
  every attempt clusters around the cheapest units.

All three strategies are pure functions of `(pool, lockedTraits, rng,
attemptIndex)`, so the same seed + lock configuration produces
identical output. The `rng` is the shared `createRng(seed)` from
`findTeams` — phase budget consumption stays fully deterministic.

### `attemptSeed(seeds, graph, context, teamSize, rng)`

Calls the existing `buildOneTeam(graph, teamSize, seeds, context, …)`
and returns the result, or `null` if `buildOneTeam` cannot finish the
team (exclusion conflict, slot budget exceeded, etc.). No retry —
failed attempts just burn one of the 50 slots so the phase has a hard
runtime ceiling.

### `phaseLockedTraitSeeded(phaseCtx)`

Entry point. Orchestration:

```
if phaseCtx.context.lockedTraits.length === 0 → return
pool = buildLockedTraitPool(...)
if pool === null → return
for i in 0..19: attempt with 'top-unit-rating' at index i
for i in 0..19: attempt with 'companion-pair' at index i
for i in 0..9:  attempt with 'cost-stratified' at index i
```

Each successful attempt calls `addResult(team)` — the same helper
every existing phase uses. No custom result collection.

## Data flow

```
user config (UI or CLI)
  └→ constraints.lockedTraits = [{apiName, minUnits}, …]
     └→ engine.ts::generate
        ├→ tight auto-promote check (c686156, unchanged)
        │  └→ if pool == minUnits → push champs to `locked`
        ├→ NEW: pass lockedTraits into findTeams options
        └→ findTeams(graph, {..., lockedTraits})
           ├→ context = {..., lockedTraits}
           ├→ NEW: phaseLockedTraitSeeded(phaseCtx)   ← first
           │  ├→ buildLockedTraitPool → Map<trait, Champion[]>
           │  ├→ 20× pickSeedsForAttempt('top-unit-rating')
           │  ├→ 20× pickSeedsForAttempt('companion-pair')
           │  ├→ 10× pickSeedsForAttempt('cost-stratified')
           │  └→ each valid team → addResult
           ├→ phaseTemperatureSweep (unchanged)
           ├→ … (rest of phases unchanged)
           └→ diversifyResults → raw teams
        ├→ enriched = rawTeams.map(teamScore + breakdown)
        ├→ validComps = enriched.filter(trait lock + role filter)
        └→ swap hero back + slice topN
```

The phase writes into the shared `results` Map, so
`diversifyResults` naturally merges its output with the other phases.
No extra plumbing in the post-generation stage.

## Data sources (existing, nothing new)

- `graph.nodes` — champion pool already in scope for the current
  `findTeams` call.
- `context.allowedSet` — level-based champion gating already built at
  the top of `findTeams`.
- `context.excludedChampions` / `excludedSet` — user excludes already
  passed through.
- `ctx.companions` — MetaTFT companion data already loaded into
  `scoringCtx` via `ScoutContextBuilder`.
- `ctx.unitRatings` — MetaTFT per-unit stats already loaded.

Zero changes in `ScoutContextBuilder.php`, zero new API calls, zero DB
migrations.

## Edge cases

| Case | Behaviour |
|---|---|
| `lockedTraits === []` | Phase early-returns. Zero runtime cost. |
| Pool for some lock < minUnits | `buildLockedTraitPool` returns `null`, phase aborts, post-filter returns empty result (user sees clean "impossible" signal). |
| Multi-lock with overlap (champion carries two locked traits) | `pickSeedsForAttempt` dedupes via apiName before passing to `buildOneTeam`; the overlapping champion contributes to both lock counts naturally. |
| No companion data for lock members | `'companion-pair'` attempt skips to fallback filling; overall phase may deliver fewer than 50 attempts but still as many as it could construct. |
| Tight lock (already auto-promoted by c686156) | Phase still runs; seeds match the already-locked core so `buildOneTeam` just produces flex variations. Extra diversification for the flex slots — not a duplication, just redundant work bounded by cap 50. |
| Exclusion group conflict between two pool members (e.g. base + variant) | `excludedSet` is computed before the phase; `buildOneTeam` also enforces exclusion, so a seed that would break the rule is rejected and the attempt burns one slot without producing a team. |
| `buildOneTeam` cannot finish (team size / slot mismatch) | Attempt returns `null`, the phase records no result and moves on. |
| `seed = 0` (default) | Fully deterministic — same lock config + seed produces identical top-50 seeds every run. |
| User locks both a champion and a trait | Locked champions are already in `startChamps` and always included by `buildOneTeam`; the trait phase layers additional seeds on top. Final team contains both the locked champion and satisfies the locked trait. |

## Testing

Manual coverage via `scout-cli`:

1. **Loose-case primary target**
   ```
   npm run scout -- generate --top-n 30 --level 10 --locked-trait TFT17_DarkStar:4 --seed 0
   ```
   Expect ≥20 unique comps with varied 4-of-7 DarkStar combinations plus
   distinct flex slots.

2. **Tight-case regression** (c686156 interaction)
   ```
   npm run scout -- generate --top-n 30 --level 10 --locked-trait TFT17_ShieldTank:6 --seed 0
   ```
   Expect 30 unique comps, same quality as post-c686156.

3. **Multi-lock**
   ```
   npm run scout -- generate --top-n 20 --level 10 \
     --locked-trait TFT17_DarkStar:4 --locked-trait TFT17_PsyOps:3 --seed 0
   ```
   Expect ≥10 unique comps, every one satisfying both locks.

4. **Impossible lock**
   ```
   npm run scout -- generate --top-n 30 --level 10 --locked-trait TFT17_DarkStar:9 --seed 0
   ```
   Expect zero results, zero errors.

5. **Non-lock regression**
   ```
   for n in 5 20 50; do npm run scout -- generate --top-n $n --seed 42; done
   ```
   Rank-1 stays at 183.8 for all three topN values (phase must not
   activate when `lockedTraits` is empty).

6. **Performance delta**
   Measure `time …` for lock vs non-lock. Expect ~250 ms overhead on
   locked runs (50 attempts × ~5 ms `buildOneTeam`), no impact on
   non-lock path.

`npm run types:check` and `npm run lint:check` must stay green through
every step of implementation. No automated unit tests in V1, consistent
with the rest of the worker. If the phase gains complexity later (e.g.
deeper multi-lock interactions), `buildLockedTraitPool` and
`pickSeedsForAttempt` should get isolated tests first.

## Out of scope (future work)

- Scout-lab preset that stresses lock-heavy scenarios
- UI affordance explaining "impossible lock" vs "loose lock with
  limited variety"
- Per-trait weighting in `pickSeedsForAttempt` (e.g. "always include
  the highest-tier champion from this trait")
- Locked-hero-pivot phase (tracked separately in session notes)
