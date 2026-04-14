# Scout code audit — 2026-04-14

Input for Phase B fix prioritisation alongside `scout-perf-2026-04-14.md`.
Observational only — no code touched during Phase A.

## Duplicated code blocks

Raw `scripts/scout-audit/duplication.ts` reported 113 collision buckets;
the list below is the manual filter. Trivial repeats like closing braces
and single-identifier lines are excluded. Each row names a candidate shared
helper and an estimated line saving once extracted.

| suggested helper | locations | est. lines saved |
| --- | --- | ---: |
| `findActiveBreakpointIdx(trait, count)` — walks `trait.breakpoints` sorted ascending, returns the highest index where `count >= minUnits`, else `-1` | `scorer.ts:239-246`, `scorer.ts:419-426`, `scorer.ts:522-530`, `scorer.ts:120-135` | ~20 |
| `collectAffinityMatches(affData, activeTraitApis, minGames, weight)` — filter + map + sort desc + top-3, returns the sum | `scorer.ts::affinityBonus` (lines 194-225) and `synergy-graph.ts::quickScore` affinity branch (lines 307-330) | ~15 |
| `sortedBreakpoints(trait)` — `[...(trait.breakpoints || [])].sort((a, b) => a.minUnits - b.minUnits)` — currently inlined four times in `scorer.ts` | `scorer.ts:239, 419, 522, 116` | ~6 |
| `normaliseEmblems(emblems)` — expand `[{apiName, count}]` to `string[]`; currently done in `engine.ts` but `applyEmblems` inside `synergy-graph.ts` and `active-traits.ts::buildActiveTraits` still defensively iterate both shapes | `engine.ts:57-75` + duplicate handling logic in `synergy-graph.ts:29` and `active-traits.ts:37` | ~10 |

Not listed (filtered noise): all closing brace collisions, single-identifier
lines, destructuring patterns `const { foo } = bar`, `for (const x of y)`
headers without distinguishing content.

## File structure recommendations

### `synergy-graph.ts` — 1 677 lines, 25 top-level functions

The file contains the graph builder, `findTeams`, ten phase functions, the
inline helpers they share (`buildOneTeam`, `quickScore`, `costPenalty`,
`diversifyResults`, RNG), and the locked-trait-seeded phase added in the
previous sprint. That is too much for a single file to reason about.

**Phases that are self-contained enough to extract** (they read only
`phaseCtx` arguments and call `buildOneTeam` + `addResult` + stdlib):

- `phaseTemperatureSweep` (~12 lines) → `synergy-graph/phase-temperature-sweep.ts`
- `phaseTraitSeeded` (~36 lines) → `synergy-graph/phase-trait-seeded.ts`
- `phasePairSynergy` (~45 lines) → `synergy-graph/phase-pair-synergy.ts`
- `phaseCompanionSeeded` (~27 lines) → `synergy-graph/phase-companion-seeded.ts`
- `phaseCrossover` (~40 lines) → `synergy-graph/phase-crossover.ts`
- `phaseFiveCostHeavy` (~35 lines) → `synergy-graph/phase-five-cost-heavy.ts`
- `phaseMetaCompSeeded` (~42 lines) → `synergy-graph/phase-meta-comp-seeded.ts`
- `phaseHillClimb` (~80 lines) → `synergy-graph/phase-hill-climb.ts`
- `phaseLockedTraitSeeded` (~60 lines) → already logically isolated, split is
  straightforward

**Phase that would require care**: `phaseDeepVertical` (~65 lines) uses
trait-breakpoint logic that overlaps with the graph's shared helpers — it is
extractable but benefits less from the split.

**Shared helpers that stay in the parent module** (or get their own file if
the split proves clean): `buildOneTeam`, `quickScore`, `costPenalty`,
`applyEmblems`, `createRng`, `diversifyResults`, `findTeams` itself,
`buildGraph`, `phaseCtx` types.

**Recommended target structure** if Phase C decides to split:

```
resources/js/workers/scout/
  synergy-graph/
    index.ts                       # re-exports findTeams, buildGraph
    build-graph.ts
    find-teams.ts                  # orchestration + diversifyResults
    build-one-team.ts              # the inner team builder + quickScore
    rng.ts                         # createRng + thresholds constants
    phase-locked-trait-seeded.ts
    phase-temperature-sweep.ts
    phase-trait-seeded.ts
    phase-deep-vertical.ts
    phase-pair-synergy.ts
    phase-companion-seeded.ts
    phase-meta-comp-seeded.ts
    phase-five-cost-heavy.ts
    phase-crossover.ts
    phase-hill-climb.ts
```

Estimated post-split sizes: no file above 400 lines. Each phase file would
sit between 30 and 90 lines with its JSDoc header.

### `engine.ts` — 387 lines

Still manageable. The `generate()` function does eight distinct steps
sequentially (normalise emblems, hero swap, filter candidates, tight
auto-promote, buildGraph, findTeams, enrich+filter, meta match + insights,
hero swap back). Each step is 20-60 lines. Splitting `generate()` into named
helpers would help readability more than it would help file size; not
urgent, but worth doing during Phase C cleanup if the profile-driven fixes
touch enough of this function anyway.

### `scorer.ts` — 562 lines

Contains the core scorer plus four helper families (champion score, trait
score, affinity, companion, filler, role balance, orphan — the last two are
one-liners). Several internal patterns are repeated (see duplication table),
but the file's organization is coherent. Recommend extracting the duplicated
breakpoint-index helper + affinity sort helper in Phase C and otherwise
leaving it alone.

### Other files

All other scout worker files are under 200 lines. No split recommendations.

## Dead code / simplifications

Each entry: file:line — observation — suggested action. Phase C will decide
which to act on; this list is input, not a task list.

1. **`synergy-graph.ts::phaseCompanionSeeded` lines 1137-1162** — the phase
   iterates every champion in `companionData` (64 entries on the current set)
   and calls `buildOneTeam` once per qualifying companion with no cap beyond
   the global `maxResults * 4` early exit. With ~20 qualifying companions per
   champion that's up to ~1 280 `buildOneTeam` calls. The perf profile
   confirms this is the dominant hot spot (~12 s per locked run). Candidate
   actions: cap inner loop at top-3 companions per champion, share the
   already-built `topCompanions` list across iterations, or skip the phase
   entirely when `context.lockedTraits.length > 0` and `phaseLockedTraitSeeded`
   has already populated results.

2. **`synergy-graph.ts::phaseTemperatureSweep` lines 978-989** — `attempts = Math.max(maxResults * 3, 60)`
   runs 1 080 iterations on locked (maxResults=360) scenarios. Early exit
   at `results.size >= maxResults * 2` rarely fires because the phase runs
   before other phases have populated `results`. Candidate actions: drop
   the multiplier to `maxResults * 1`, tighten the early exit, or skip when
   locked traits are active.

3. **`synergy-graph.ts::phaseDeepVertical` line 1004** — `emblems.filter(e => e === trait)`
   assumes `emblems` is a flat `string[]`. This works post-normalisation in
   `engine.ts`, but any future change to the emblem shape at this call site
   would silently break the filter. Extracting an `emblemCountForTrait`
   helper used everywhere would make the contract explicit.

4. **`scorer.ts` repeated breakpoint walk** — the same `sortedBreakpoints +
   activeIdx scan` loop appears in `traitScore` (line ~239), in
   `teamScoreBreakdown` proven-bonus block (line ~419), and in
   `teamScoreBreakdown` high-breakpoint filter (line ~522), plus once inside
   the champion score helper (line ~120). Extract into
   `findActiveBreakpointIdx(trait, count)` to make intent obvious and cut
   ~20 lines.

5. **`synergy-graph.ts::quickScore` affinity branch (lines 307-330)** — duplicates the logic in
   `scorer.ts::affinityBonus` almost line for line. Sharing a helper would
   keep the two paths from drifting apart the next time we tune the affinity
   cap or weight.

6. **`engine.ts::generate` tight auto-promote loop** — iterates `traitLocks`,
   filters `champions` per lock, checks `poolForTrait.length !== lock.minUnits`,
   then promotes. This runs `champions.filter(...)` once per lock, on every
   generate call. With ~4 locks max and ~68 champions, cost is tiny — not
   a perf win, but extracting `collectTraitPool(champions, traitApi, excludedSet)`
   would be a natural helper to share with `buildLockedTraitPool` inside the
   phase (which does the same thing against `graph.nodes` instead of
   `champions`).

7. **`engine.ts::generate` constraint mutation** — the function mutates the
   caller's `constraints.emblems` field during normalisation
   (lines 57-75). For a pure worker this is surprising side-effect. Not a
   bug today because the caller passes a fresh object each generate call,
   but a future change that memoises params would hit the mutation. Worth
   replacing with a local `normalisedEmblems` variable and passing it
   downstream rather than stomping the input.

8. **`synergy-graph.ts::findTeams` post-diversify splice** (lines 1626-1651) —
   re-runs `results.get(key)` on every key in `lockedTraitSeedKeys` and
   rebuilds a `Set` of diverse keys. With ~50 keys it's fast, but the
   operation could be merged into `diversifyResults` itself so it has a
   priority input and the splice is unnecessary. Refactor, not a perf win
   (both paths are <1 ms per run).

## Summary for Phase B

The code is organised well enough that the modularity recommendations
(file splits) are cleanup for future maintainability, not a Phase C blocker.
The **real prize** is the perf report's headline finding: `phaseCompanionSeeded`
and `phaseTemperatureSweep` between them account for almost 100% of locked-run
wall time, and item 1 in the dead-code list is a one-parameter tweak away
from a 10-20× reduction in that phase. Phase B should prioritise the
companion-seeded fix, the temperature-sweep fix, and the breakpoint-walk
duplication extraction before anything else.
