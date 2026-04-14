# Scout refactor/cleanup — R sub-project

> Status: design, approved 2026-04-15
> Author: brainstorm between Borcioo and Claude
> Targets: `resources/js/workers/scout/{synergy-graph.ts,scorer.ts,team-insights.ts}`
> Supersedes deferred Fix 3 / Fix 4 / Fix 6 from `2026-04-14-scout-perf-sprint-design.md`

## Problem

Three cleanup items deferred from the 2026-04-15 scout perf sprint:

1. **Fix 3** — `scorer.ts` has 3-4 inline copies of the same breakpoint-walk
   loop (`for (let i = 0; i < bps.length; i++) { if (count >= bps[i].minUnits) idx = i; }`).
   `team-insights.ts:41` already has a local helper `activeBreakpointIdx` that
   does the same thing. Duplication makes any semantic change (e.g. fractional
   breakpoints via emblems) a multi-site edit.
2. **Fix 4** — `scorer.ts::affinityBonus` (194-215) and
   `synergy-graph.ts::quickScore` (300-338) have near-identical loops that
   collect per-trait affinity match bonuses. Only the aggregation strategy
   differs (full scorer caps against trait-diverse abuse, quickScore sums
   lightly). The collection half is duplicated.
3. **Fix 6** — `synergy-graph.ts` is 1893 lines with 10 phase functions inline
   alongside core orchestration (`buildGraph`, `findTeams`, `quickScore`),
   shared helpers, and constants. File is too large to hold in context at
   once and any phase-level change risks collateral edits to the monolith.

All three are pure-refactor — zero behavior change, only code organisation.
Targets are deferred from the perf sprint on purpose: shipping them alongside
perf fixes would have muddied baseline diffs.

## Goal

After this sub-project:

- `synergy-graph/` is a folder with clear layer separation (core / phases /
  shared), each phase is a self-contained unit behind a uniform `Phase`
  signature, and no phase imports another phase.
- `findActiveBreakpointIdx` lives in exactly one place
  (`shared/breakpoints.ts`) and is used by scorer, team-insights, and any
  phase that walks breakpoints.
- `collectAffinityMatches` lives in exactly one place (`shared/affinity.ts`)
  and is used by both full scorer and quickScore; aggregation stays per-caller.
- Zero behavior change — verified byte-identical on 5 scout-cli scenarios at
  every commit.

**Non-goals:**

- Performance improvement. Phase E (Web Workers, WASM, streaming) is not
  part of this sub-project. Any perf delta from this refactor is a bug.
- Unit tests. Project has no JS test runner; verification is scout-cli
  baseline diff + tsc + build.
- Touching `scorer.ts` structure beyond the two helper call sites. The file
  has its own organisational debt (562 lines, multiple concerns) but that
  is out of scope — file is under 1000 lines and not currently painful.
- Set-rules hook infrastructure. `hero-exclusion.ts` TODO stays as is; the
  refactor here prepares the ground (uniform Phase signature, phase
  registry) but does not implement the hook system.

## Design principles

1. **Each phase is a self-contained unit.** Uniform interface
   `Phase = (ctx: PhaseContext) => void`, no global state, no inter-phase
   imports. Add/remove/replace a phase = edit one file + one registry entry.
2. **Aggressive deduplication.** If 2+ phases or 2+ files share a fragment,
   it goes to `shared/`. No copy-paste.
3. **Clear layer boundaries.** `phases/ → shared/ → types.ts`. Dependencies
   flow one direction. `shared/*` is pure (no state, no side effects beyond
   inputs). `core.ts` orchestrates — never contains algorithmic logic.
4. **Baseline-gated commits.** Every commit lands with byte-identical output
   on 5 scout-cli scenarios. Drift = rollback.

## Architecture

### Folder layout

```
resources/js/workers/scout/synergy-graph/
  index.ts                      # re-export: buildGraph, findTeams
  core.ts                       # findTeams orchestration, PHASES registry, dispatch loop
  graph.ts                      # buildGraph, Graph struct, edge computation
  quick-score.ts                # quickScore (lightweight pre-filter scorer)
  types.ts                      # Phase, PhaseContext, Graph, SeedTeam, Result
  shared/
    breakpoints.ts              # findActiveBreakpointIdx (Fix 3)
    affinity.ts                 # collectAffinityMatches (Fix 4)
    team-builder.ts             # tryBuildAroundAnchor, pickCandidatesByScore
    emblems.ts                  # applyEmblems, emblem permutation helpers
    const.ts                    # FILLER_PICK_DECAY, companion cost weights, magic numbers
  phases/
    locked-trait-seeded.ts
    temperature-sweep.ts
    trait-seeded.ts
    deep-vertical.ts
    pair-synergy.ts
    companion-seeded.ts
    crossover.ts
    hill-climb.ts
    meta-comp-seeded.ts
    five-cost-heavy.ts
```

**Consumer impact**: `engine.ts` imports `from './synergy-graph'`. After the
refactor, that resolves to `./synergy-graph/index.ts` automatically (Node/Vite
module resolution). Zero call-site edits outside the folder.

### PhaseContext — uniform contract

Current phases destructure different fields from their parameter —
`phaseLockedTraitSeeded({ graph, teamSize, context, rng, addResult, excludedSet })`
vs `phaseDeepVertical({ graph, teamSize, startChamps, context, rng, maxResults, results, addResult, excludedSet, excludedTraits, emblems })`.
Replace with a single `PhaseContext` that carries everything; each phase
destructures what it needs on entry.

```ts
// types.ts
export type PhaseContext = {
  graph: Graph;
  teamSize: number;
  startChamps: Champion[];
  context: ScoutContext;
  rng: Rng;
  maxResults: number;
  results: Team[];
  addResult: (team: Team) => void;
  excludedSet: Set<string>;
  excludedTraits: Set<string>;
  emblems: string[];
};

export type Phase = (ctx: PhaseContext) => void;

export type PhaseEntry = {
  name: string;
  phase: Phase;
  skipWhen?: (ctx: PhaseContext) => boolean;
};
```

### Core dispatch

```ts
// core.ts (sketch)
const PHASES: PhaseEntry[] = [
  { name: 'lockedTraitSeeded', phase: phaseLockedTraitSeeded },
  { name: 'temperatureSweep', phase: phaseTemperatureSweep, skipWhen: hasLockedTraits },
  { name: 'traitSeeded', phase: phaseTraitSeeded },
  { name: 'deepVertical', phase: phaseDeepVertical },
  { name: 'pairSynergy', phase: phasePairSynergy },
  { name: 'companionSeeded', phase: phaseCompanionSeeded },
  { name: 'crossover', phase: phaseCrossover },
  { name: 'hillClimb', phase: phaseHillClimb },
  { name: 'metaCompSeeded', phase: phaseMetaCompSeeded },
  { name: 'fiveCostHeavy', phase: phaseFiveCostHeavy },
];

for (const { name, phase, skipWhen } of PHASES) {
  if (skipWhen?.(phaseCtx)) continue;
  const end = startSpan(`synergy.phase.${name}`);
  phase(phaseCtx);
  end();
}
```

**Wins:**

- Profiler span naming centralised. Currently each phase inlines its own
  `startSpan` call; post-refactor the dispatch loop owns it.
- `skipWhen` makes orchestration decisions explicit. Fix 2A's skip-on-locked
  for `temperatureSweep` is currently a hidden early return inside the phase;
  surfacing it at the registry level makes the rule visible.
- Phase ordering lives in one array literal. Changing order or adding phases
  is a 1-line edit.
- Future Phase E (Web Worker pool) — the dispatch loop is the natural place
  for parallelisation.

**Cost**: each phase function now takes `(ctx: PhaseContext)` instead of
destructured arguments. One-line destructure at the top of each phase body.
Behavior identical.

### Shared helpers (Fix 3 + Fix 4 targets)

**`shared/breakpoints.ts`** (Fix 3):

```ts
export function findActiveBreakpointIdx(
  count: number,
  breakpoints: readonly { minUnits: number }[],
): number {
  let idx = -1;
  for (let i = 0; i < breakpoints.length; i++) {
    if (count >= breakpoints[i].minUnits) idx = i;
    else break;
  }
  return idx;
}
```

Consumers after extract:

- `team-insights.ts:41` — delete local `activeBreakpointIdx`, import from
  shared. All 3 call sites in the file use the imported version.
- `scorer.ts` — 3-4 inline copies (exact lines identified during
  implementation). Each replaced with
  `const idx = findActiveBreakpointIdx(count, bps);`.
- Any phase file with inline breakpoint walks (surfaced during phase-by-phase
  split; unknown how many until the monolith is broken up).

**`shared/affinity.ts`** (Fix 4):

```ts
export function collectAffinityMatches(
  champion: { apiName: string; baseApiName?: string },
  activeTraitApis: ReadonlySet<string>,
  affinity: Record<string, Array<{ trait: string; avgPlace: number; games: number }>>,
  thresholds: { affinityMinGames: number },
  weights: { affinityBonus: number },
): number[] {
  const lookupApi = champion.baseApiName ?? champion.apiName;
  const data = affinity[lookupApi];
  if (!data) return [];

  const matches: number[] = [];
  for (const aff of data) {
    if (activeTraitApis.has(aff.trait) && aff.games >= thresholds.affinityMinGames) {
      matches.push(weights.affinityBonus * (1 - aff.avgPlace / 8));
    }
  }
  return matches;
}
```

Consumers:

- `scorer.ts::affinityBonus` (currently 194-215) — replaces inline loop,
  keeps its own cap/aggregation logic on the returned array.
- `synergy-graph/quick-score.ts` (currently `synergy-graph.ts:300-338`) —
  replaces inline loop, keeps its lighter aggregation.

**Critical split**: the helper does **collection only** — loop + filter +
weight. **Aggregation** (cap, sum, penalty) stays with the caller. Full
scorer and quickScore have different aggregation strategies by design;
unifying the full logic would change behavior.

### Other shared files

- **`shared/team-builder.ts`** — `tryBuildAroundAnchor`,
  `pickCandidatesByScore`, shared anchor-driven routines used by
  companionSeeded + trait-seeded + locked-trait-seeded.
- **`shared/emblems.ts`** — `applyEmblems`, emblem permutation helpers used
  by deepVertical + core graph building.
- **`shared/const.ts`** — `FILLER_PICK_DECAY = 0.5`, companion cost weights
  `[0.3, 0.5, 1.0, 0.95, 0.55]`, maxResults multipliers. Each magic number
  with named export + short `Why:` comment.

**Invariant**: `shared/*` files are pure. Zero imports from `phases/`, zero
imports from `core.ts`. Dependency graph is `phases → shared → types`,
one-way. This lets future tests or scout-cli commands import a single shared
helper without loading the whole engine.

## Execution order

Three sub-phases in sequence: Fix 6 (split) → Fix 3 (breakpoints) → Fix 4
(affinity). Rationale: splitting the monolith first produces small files
where Fix 3 and Fix 4 can be applied surgically. Doing helpers first would
force a second edit pass during the split.

### Baseline capture (before any edit)

```bash
mkdir -p tmp/refactor-R-baseline
npm run scout -- score-comp --lvl 8 --seed 42 --top-n 10 \
  > tmp/refactor-R-baseline/01-non-lock.json
npm run scout -- score-comp --lvl 10 --seed 42 --top-n 30 \
  --lock-trait 'TFT17_ShieldTank:6' \
  > tmp/refactor-R-baseline/02-shieldtank.json
npm run scout -- score-comp --lvl 10 --seed 42 --top-n 30 \
  --lock-trait 'TFT17_DarkStar:4' \
  > tmp/refactor-R-baseline/03-darkstar.json
npm run scout -- score-comp --lvl 10 --seed 42 --top-n 30 \
  --lock-trait 'TFT17_DarkStar:4' --emblem 'TFT17_ShieldTank' \
  > tmp/refactor-R-baseline/04-emblem.json
npm run scout -- score-comp --lvl 9 --seed 42 --top-n 10 \
  --lock-champ TFT17_Poppy_hero \
  > tmp/refactor-R-baseline/05-hero.json
```

Exact CLI flags depend on what `scout-cli score-comp` supports — the
implementation plan's step 0 verifies the CLI shape and adjusts. If preset
flags exist, prefer them. If the CLI cannot capture one of these scenarios,
stop and fix the CLI first (would be a separate pre-R task).

`tmp/refactor-R-baseline/` is gitignored; baseline lives only for the
duration of the sub-project.

### Per-commit checkpoint

Every commit (all 20 of them) runs:

```bash
npx tsc --noEmit               # must pass
npm run build                  # must pass
for i in 01 02 03 04 05; do
  # capture current output with same flags as baseline
  # diff byte-by-byte
  diff tmp/refactor-R-baseline/$i.json tmp/refactor-R-current/$i.json \
    || { echo "DRIFT on $i — rollback"; exit 1; }
done
```

Drift = `git reset --hard HEAD~1` and debug. No exceptions — zero-drift is
the correctness bar for a refactor.

### Sub-phase 6 — split synergy-graph.ts

| commit | scope |
|---|---|
| 6a | Create `synergy-graph/` folder + `types.ts` + `index.ts` stub. Move `buildGraph` + `Graph` struct → `graph.ts`. `synergy-graph.ts` re-exports from folder (compat shim). |
| 6b | Move `quickScore` → `quick-score.ts`. Move `tryBuildAroundAnchor` + `pickCandidatesByScore` → `shared/team-builder.ts`. |
| 6c | Move `applyEmblems` + emblem helpers → `shared/emblems.ts`. Extract magic numbers → `shared/const.ts`. |
| 6d1..6d10 | Phase-by-phase move (10 commits, one per phase). Each commit: new `phases/<name>.ts`, replace inline function with import from new file. |
| 6e | `core.ts::findTeams` with `PhaseContext` + `PHASES` registry. Remove old invocations from monolith. Delete empty `synergy-graph.ts`; `index.ts` takes over. |
| 6f | Cleanup: remove compat shims, verify `grep from './synergy-graph'` still resolves. |

Total: 15 commits (6a, 6b, 6c, 6d1-6d10, 6e, 6f).

### Sub-phase 3 — extract findActiveBreakpointIdx

| commit | scope |
|---|---|
| 3a | Create `shared/breakpoints.ts`. Import into `team-insights.ts`, delete local copy. |
| 3b | Import into `scorer.ts`, replace 3-4 inline copies. |
| 3c | Import into phase files with inline breakpoint walks (count TBD during impl). |

Total: 3 commits.

### Sub-phase 4 — extract collectAffinityMatches

| commit | scope |
|---|---|
| 4a | Create `shared/affinity.ts`. Import into `scorer.ts::affinityBonus`, refactor to use helper. |
| 4b | Import into `synergy-graph/quick-score.ts`, refactor inline loop. |

Total: 2 commits.

**R total**: ~20 commits, each atomic, baseline-gated, rollback-trivial.

## Commit message template

```
refactor(scout): <what> — phase <N><letter>/<total>

<1-2 sentence rationale>

Zero behavior change — verified via scout-cli baseline diff on
5 scenarios (non-lock lvl8, ShieldTank:6 lvl10, DarkStar:4 lvl10,
emblem, hero-swap). All byte-identical.

Part of R (refactor) sub-project.
Spec: docs/superpowers/specs/2026-04-15-scout-refactor-cleanup-design.md

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

## Edge cases

- **Phase file that imports another phase during split.** Forbidden by
  design principle 1. If discovered during impl, extract the shared bit to
  `shared/` instead of cross-phase import.
- **Shared helper that needs mutable state.** Shouldn't happen —
  `shared/*` is pure. If a helper candidate needs state, it belongs in
  `core.ts` (orchestration) or stays inline in the phase (algorithm).
- **PhaseContext destructure miss.** A phase that forgets to destructure
  a needed field gets `undefined` at runtime. `tsc --noEmit` catches most
  cases; scout-cli baseline diff catches the rest (output drifts immediately).
- **Profiler span double-nesting.** Current code has `startSpan` calls
  inside some phases AND will have one in the dispatch loop post-refactor.
  During the split, each phase's inline `startSpan` is removed when the
  dispatch loop's version is introduced (step 6e). Not before.
- **`engine.ts` type imports.** `engine.ts` is `@ts-nocheck` but imports
  `{ buildGraph, findTeams }` by name. The `index.ts` re-export preserves
  these names. Zero edit to engine.

## Verification

### Per-commit (automated, enforced)

1. `npx tsc --noEmit` — no new errors. Pre-existing errors in unrelated
   files (auth/spinner/welcome) acceptable.
2. `npm run build` — production build succeeds.
3. scout-cli baseline diff on 5 scenarios — byte-identical.

### Post-R (manual, one-time)

1. `wc -l resources/js/workers/scout/synergy-graph/**/*.ts` — no file over
   400 lines.
2. `grep -rn "activeBreakpointIdx\|findActiveBreakpointIdx" resources/js/workers/scout/` — all imports point to `shared/breakpoints`, no local copies.
3. `grep -rn "affinity\[.*\]\.trait" resources/js/workers/scout/` — matches
   should only be in `shared/affinity.ts` and test/documentation.
4. Manual browser smoke: run scout at `/scout`, lock nothing, lock
   ShieldTank:6, lock DarkStar:4+emblem, lock hero variant — visual check
   that results match what they did before R started.
5. `npm run scout -- experiment --preset level-sweep --tag post-R` via
   scout-lab, diff against the current-HEAD baseline to confirm no meta
   drift from a random distribution perspective (belt-and-suspenders on top
   of the byte-diff).

## Rollback

Each commit is atomic and baseline-diff-verified. Any single commit can be
reverted via `git revert <sha>` without breaking the chain. If multiple
commits need to go, revert in reverse order.

Worst case (sub-project fails mid-flight): `git reset --hard` to the R
start point is safe because R makes no database/config/build-artifact
changes. Worker bundle rebuilds on next `npm run build`.

## Out of scope (deferred)

- **Scorer organisational cleanup.** `scorer.ts` (562 lines) has multiple
  concerns but is not currently painful. Separate sub-project if needed.
- **Unit test scaffolding.** Adding vitest for one helper is not worth the
  tooling cost. Scout-cli baseline diff is the test here.
- **Set-rules hook infrastructure.** `hero-exclusion.ts` TODO stays.
  Refactor prepares the ground (uniform Phase signature) but does not
  implement the hook system.
- **Non-lock 201ms perf gap** (Phase P of the parent plan). R produces a
  cleaner codebase for P to target, but P is a separate sub-project with
  its own spec.
- **Fallback scoring / costPenalty tuning** (Phase A of the parent plan).
  Behavior changes, not refactor. Separate sub-project.
