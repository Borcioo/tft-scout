# Scout refactor/cleanup (R sub-project) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `synergy-graph.ts` (1893 lines, 10 inline phases) into `synergy-graph/` folder with core/phases/shared layers, extract `findActiveBreakpointIdx` and `collectAffinityMatches` helpers, zero behavior change.

**Architecture:** Folder `synergy-graph/` with uniform `Phase = (ctx: PhaseContext) => void` contract, central `PHASES` registry in `core.ts`, pure `shared/*` helpers consumed by both phases and scorer. Each commit baseline-diff-gated on 5 scout-cli scenarios to prove byte-identical output.

**Tech Stack:** TypeScript (strict in new files, `@ts-nocheck` stays in `engine.ts`), Node via `tsx scripts/scout-cli.ts`, SQLite sidecar for scout-lab. No runtime dependencies added.

**Spec:** `docs/superpowers/specs/2026-04-15-scout-refactor-cleanup-design.md` — read first for design principles and rationale.

---

## File Structure

### New files created by this plan

```
resources/js/workers/scout/synergy-graph/
  index.ts                        # re-export: buildGraph, findTeams
  core.ts                         # findTeams, PhaseContext dispatch, PHASES registry
  graph.ts                        # buildGraph, Graph struct
  quick-score.ts                  # quickScore lightweight pre-filter scorer
  types.ts                        # Phase, PhaseContext, Graph, SeedTeam, Result types
  shared/
    breakpoints.ts                # findActiveBreakpointIdx (Fix 3)
    affinity.ts                   # collectAffinityMatches (Fix 4)
    team-builder.ts               # tryBuildAroundAnchor, pickCandidatesByScore
    emblems.ts                    # applyEmblems + emblem permutation helpers
    const.ts                      # FILLER_PICK_DECAY, companion cost weights
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

### Existing files touched

- `resources/js/workers/scout/synergy-graph.ts` — deleted at end of Task 14 (replaced by `synergy-graph/` folder).
- `resources/js/workers/scout/scorer.ts` — Tasks 17 + 19 import helpers from `shared/`, replace inline loops.
- `resources/js/workers/scout/team-insights.ts` — Task 16 imports from `shared/breakpoints`, deletes local `activeBreakpointIdx`.
- `resources/js/workers/scout/engine.ts` — **not touched**. `index.ts` re-exports `buildGraph`, `findTeams` by name, so the existing `import { buildGraph, findTeams } from './synergy-graph'` keeps resolving.

### Phase LOC map (for sizing subagent tasks)

| phase | source lines | LOC |
|---|---:|---:|
| phaseLockedTraitSeeded | 902-977 | 76 |
| phaseTemperatureSweep | 978-1002 | 25 |
| phaseTraitSeeded | 1003-1038 | 36 |
| phaseDeepVertical | 1039-1103 | 65 |
| phasePairSynergy | 1104-1370 | **267** |
| phaseCompanionSeeded | 1371-1385 | 15 |
| phaseCrossover | 1386-1424 | 39 |
| phaseHillClimb | 1425-1516 | 92 |
| phaseMetaCompSeeded | 1517-1558 | 42 |
| phaseFiveCostHeavy | 1559-?? | 40 + module-level helpers after |

Lines after phaseFiveCostHeavy's body include module-level helpers that need classification during Task 3 (shared or scoped).

---

## Baseline Diff Recipe (reused by every task)

Every task below ends with **Verification Recipe V**, which is a literal copy-paste of the commands here. When a task says "run Verification Recipe V", execute these exact commands.

### First-time setup (Task 0 creates this)

```bash
mkdir -p tmp/refactor-R-baseline tmp/refactor-R-current
```

`tmp/` is gitignored, so these paths never hit commits.

### Verification Recipe V

```bash
# 1. Type check
npx tsc --noEmit
# Expected: no new errors vs baseline. Pre-existing errors in
# resources/js/pages/auth/*, spinner.tsx, welcome.tsx are acceptable.
# If `tsc --noEmit` surfaces ANY new error in files touched by this
# task, STOP and fix before continuing.

# 2. Production build
npm run build
# Expected: success in under 20s, no errors.

# 3. Baseline diff on 5 scenarios
bash scripts/refactor-R-checkpoint.sh
# Expected: "OK" for all 5 scenarios. Any "DRIFT" = rollback this
# commit via `git reset --hard HEAD~1` and debug.
```

### Baseline presets (5 scenarios)

Scenarios cover non-lock, trait-lock, trait-lock + emblem, hero swap, and a level-10 tight lock. Each scenario uses `seed 42` for determinism.

```
01-non-lock        npm run scout -- generate --full --level 8  --top-n 10 --seed 42
02-shieldtank6     npm run scout -- generate --full --level 10 --top-n 30 --seed 42 --locked-trait TFT17_ShieldTank:6
03-darkstar4       npm run scout -- generate --full --level 10 --top-n 30 --seed 42 --locked-trait TFT17_DarkStar:4
04-darkstar-emblem npm run scout -- generate --full --level 10 --top-n 30 --seed 42 --locked-trait TFT17_DarkStar:4 --emblem TFT17_ShieldTank:1
05-hero-swap       npm run scout -- generate --full --level 9  --top-n 10 --seed 42 --locked TFT17_Poppy_hero
```

**Note on `--locked-trait` / `--locked` / `--emblem` syntax**: verified against `scout-cli.ts` help output. If Task 0 finds the flag syntax differs, update the scenarios in Task 0 before writing the checkpoint script.

---

## Task 0: Capture baseline + create checkpoint script

**Files:**
- Create: `scripts/refactor-R-checkpoint.sh`
- Create: `tmp/refactor-R-baseline/*.json` (gitignored, not committed)

**Context:** Every subsequent task relies on byte-diff against a frozen baseline captured from current `HEAD` (commit `db696cb` or later — whatever is the tip before Task 1). This task freezes that baseline AND produces the reusable checkpoint script that diffs current output against the frozen baseline.

- [ ] **Step 1: Verify CLI flag syntax**

Run: `npm run scout -- --help`

Expected: help text lists `generate`, `--level`, `--top-n`, `--seed`, `--locked A,B,C`, `--locked-trait T:N`, `--emblem T:N`, `--full`. If any flag name differs, note the actual name and substitute in Steps 2-4.

- [ ] **Step 2: Verify scenario 01 runs and produces JSON**

Run:

```bash
npm run scout -- generate --full --level 8 --top-n 10 --seed 42 > /tmp/test-01.json 2>&1
head -c 200 /tmp/test-01.json
```

Expected: stdout is a JSON array (`[` as the first non-whitespace character after any leading `>` redirected line). If the CLI prints a log banner before the JSON, note the line count — Step 4 will strip it.

If the CLI errors out (missing snapshot, missing lab DB), run:

```bash
NODE_TLS_REJECT_UNAUTHORIZED=0 SCOUT_API_BASE=https://tft-scout.test npm run scout -- snapshot
```

Then retry Step 2.

- [ ] **Step 3: Create the baseline directory and freeze 5 scenarios**

Run:

```bash
mkdir -p tmp/refactor-R-baseline tmp/refactor-R-current

npm run scout -- generate --full --level 8 --top-n 10 --seed 42 \
  > tmp/refactor-R-baseline/01-non-lock.json

npm run scout -- generate --full --level 10 --top-n 30 --seed 42 \
  --locked-trait TFT17_ShieldTank:6 \
  > tmp/refactor-R-baseline/02-shieldtank6.json

npm run scout -- generate --full --level 10 --top-n 30 --seed 42 \
  --locked-trait TFT17_DarkStar:4 \
  > tmp/refactor-R-baseline/03-darkstar4.json

npm run scout -- generate --full --level 10 --top-n 30 --seed 42 \
  --locked-trait TFT17_DarkStar:4 --emblem TFT17_ShieldTank:1 \
  > tmp/refactor-R-baseline/04-darkstar-emblem.json

npm run scout -- generate --full --level 9 --top-n 10 --seed 42 \
  --locked TFT17_Poppy_hero \
  > tmp/refactor-R-baseline/05-hero-swap.json
```

Expected: 5 files in `tmp/refactor-R-baseline/`, each starting with `[` and containing a non-empty JSON array.

- [ ] **Step 4: Sanity-check each baseline file is non-empty and parseable JSON**

Run:

```bash
for f in tmp/refactor-R-baseline/*.json; do
  node -e "const j = JSON.parse(require('fs').readFileSync('$f','utf8')); if(!Array.isArray(j) || j.length === 0) { console.error('$f empty or not array'); process.exit(1); } console.log('$f OK — '+j.length+' comps');"
done
```

Expected: 5 "OK" lines. Scenario 03 may return 0 if `TFT17_DarkStar:4` is mathematically impossible at lvl 10 — if that happens, swap to `TFT17_DarkStar:3` or another feasible trait lock. Record the actual trait used.

Scenario 05 (hero swap) may return 0 if `TFT17_Poppy_hero` is no longer in the snapshot — pick another hero apiName from the champions list. Record the actual apiName used.

- [ ] **Step 5: Write the checkpoint script**

Create `scripts/refactor-R-checkpoint.sh`:

```bash
#!/usr/bin/env bash
# Refactor R sub-project baseline checkpoint.
# Re-runs the 5 scenarios captured in tmp/refactor-R-baseline/
# and byte-diffs the output. Used by every task in the R plan.

set -e

BASELINE_DIR="tmp/refactor-R-baseline"
CURRENT_DIR="tmp/refactor-R-current"
mkdir -p "$CURRENT_DIR"

run() {
  local name="$1"; shift
  npm run scout -- generate --full "$@" > "$CURRENT_DIR/$name.json"
  if diff -q "$BASELINE_DIR/$name.json" "$CURRENT_DIR/$name.json" > /dev/null; then
    echo "OK   $name"
  else
    echo "DRIFT $name — see diff:" >&2
    diff "$BASELINE_DIR/$name.json" "$CURRENT_DIR/$name.json" | head -40 >&2
    exit 1
  fi
}

run 01-non-lock        --level 8  --top-n 10 --seed 42
run 02-shieldtank6     --level 10 --top-n 30 --seed 42 --locked-trait TFT17_ShieldTank:6
run 03-darkstar4       --level 10 --top-n 30 --seed 42 --locked-trait TFT17_DarkStar:4
run 04-darkstar-emblem --level 10 --top-n 30 --seed 42 --locked-trait TFT17_DarkStar:4 --emblem TFT17_ShieldTank:1
run 05-hero-swap       --level 9  --top-n 10 --seed 42 --locked TFT17_Poppy_hero

echo ""
echo "All 5 scenarios byte-identical to baseline."
```

**If Step 4 recorded different trait/champion names**, update the `run` lines here accordingly.

Make executable:

```bash
chmod +x scripts/refactor-R-checkpoint.sh
```

- [ ] **Step 6: Verify the checkpoint script passes on unchanged code**

Run: `bash scripts/refactor-R-checkpoint.sh`

Expected: 5 "OK" lines + "All 5 scenarios byte-identical to baseline." This proves the script compares correctly before any refactor edit.

- [ ] **Step 7: Verify tmp/ is gitignored**

Run: `git check-ignore tmp/refactor-R-baseline/01-non-lock.json`

Expected: output includes the path (confirming it's ignored). If not, add `tmp/` to `.gitignore` before continuing.

- [ ] **Step 8: Commit the checkpoint script only**

```bash
git add scripts/refactor-R-checkpoint.sh
git commit -m "$(cat <<'EOF'
chore(scout): add refactor R baseline checkpoint script

5-scenario byte-diff against tmp/refactor-R-baseline/ (gitignored).
Used as verification gate for every commit in the R sub-project.

Scenarios:
  01 non-lock lvl8
  02 ShieldTank:6 lvl10
  03 DarkStar:4 lvl10
  04 DarkStar:4 + ShieldTank emblem lvl10
  05 hero-swap (Poppy_hero) lvl9

Spec: docs/superpowers/specs/2026-04-15-scout-refactor-cleanup-design.md

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 1 (Commit 6a): Create folder + types + move buildGraph

**Files:**
- Create: `resources/js/workers/scout/synergy-graph/index.ts`
- Create: `resources/js/workers/scout/synergy-graph/types.ts`
- Create: `resources/js/workers/scout/synergy-graph/graph.ts`
- Modify: `resources/js/workers/scout/synergy-graph.ts` (shrink — becomes a compat re-export shim)

**Context:** First move. Extracts `buildGraph` + the `Graph` struct from the monolith into a new folder. The old `synergy-graph.ts` stays as a compat shim that re-exports from `synergy-graph/index.ts`, so `engine.ts`'s existing `import { buildGraph, findTeams } from './synergy-graph'` keeps resolving. `findTeams` stays in the monolith for now — Task 14 moves it.

- [ ] **Step 1: Read the current buildGraph function**

Open `resources/js/workers/scout/synergy-graph.ts`. Locate `export function buildGraph(...)`. Read the entire function body, the `Graph` type definition (if inlined), and any module-level helpers it calls (e.g. edge computation helpers).

Make a mental list: `buildGraph` itself, any pure helper it calls that is NOT used by other phases, and any shared constants it reads. The pure helpers move with it; the shared bits stay in the monolith until a later task.

- [ ] **Step 2: Create `synergy-graph/types.ts`**

```ts
// resources/js/workers/scout/synergy-graph/types.ts
//
// Shared types for the synergy-graph folder. Kept minimal —
// only types referenced by 2+ files in the folder go here.

// Graph is the precomputed champion-pair synergy structure used by
// findTeams. Shape is the minimum needed by both graph.ts (producer)
// and core.ts/phases/* (consumers). If a field is only used by one
// file, leave it in that file's local type.
export type Graph = {
  champions: any[];
  champByApi: Record<string, any>;
  edges: Record<string, Record<string, number>>;
  traitActivations: Record<string, Set<string>>;
};

// Placeholder for Task 14. Phase/PhaseContext are added when core.ts
// is written. Do not add them here yet — keeps Task 1 minimal.
```

The `Graph` field list must match what `buildGraph` returns in the current monolith. Open `synergy-graph.ts` and confirm the returned object's keys match the `Graph` type above. If any key differs, update the type to match reality exactly (do not rename fields — refactor is behavior-preserving).

- [ ] **Step 3: Create `synergy-graph/graph.ts` with `buildGraph` moved in**

Copy the entire `buildGraph` function body (and any private helpers only it uses) from `synergy-graph.ts` into a new file:

```ts
// resources/js/workers/scout/synergy-graph/graph.ts
//
// buildGraph — produces the synergy graph consumed by findTeams
// and every phase. Pure function of (champions, traits, scoringCtx).

// @ts-nocheck — parity with the monolith it came from; engine.ts
// already opts out of strict typing for the scout worker, and this
// file is a pure code move with zero semantic change. Strict typing
// is a separate sub-project.

import type { Graph } from './types';
// ... other imports buildGraph needs (scorer weights/thresholds, etc.)

export function buildGraph(/* exact same params as in synergy-graph.ts */): Graph {
  // exact body from synergy-graph.ts
}

// plus any private helpers that buildGraph uses and NO OTHER function in
// the monolith uses. If a helper is also used by a phase or quickScore,
// leave it in the monolith for now — Task 2 or later will move it.
```

**Critical**: do NOT rewrite or clean up the function body. Copy verbatim. The only edits allowed are (a) imports (may need to add imports for things that were module-level in the monolith) and (b) fixing reference paths. Any other edit risks behavior drift.

- [ ] **Step 4: Create `synergy-graph/index.ts`**

```ts
// resources/js/workers/scout/synergy-graph/index.ts
//
// Public entry point for the synergy-graph folder.
// Re-exports the names engine.ts imports: buildGraph, findTeams.
// As phases/core move into the folder, this file grows re-exports.
// After Task 14 it is the only public surface of the folder.

export { buildGraph } from './graph';

// findTeams still lives in the legacy synergy-graph.ts monolith
// during Tasks 1-13. Task 14 moves it to ./core and this line
// changes to `export { findTeams } from './core';`.
export { findTeams } from '../synergy-graph';
```

The circular-looking re-export (`index.ts` imports from `../synergy-graph` which Task 14 will delete) is temporary. TypeScript/Vite resolves it cleanly as long as the monolith exists.

- [ ] **Step 5: Update the monolith to delegate `buildGraph` to the new file**

In `resources/js/workers/scout/synergy-graph.ts`, remove the body of `buildGraph` and replace with a re-export at the top of the file:

```ts
// At the top of synergy-graph.ts, below existing imports:
export { buildGraph } from './synergy-graph/graph';
// Remove the old `export function buildGraph(...)` entirely.
```

Also remove any private helpers that moved into `graph.ts` (they live only there now).

**Verify no one else in the monolith calls the private helpers you moved.** Run: `grep -n "<helperName>" resources/js/workers/scout/synergy-graph.ts` for each helper. Expected: 0 hits (after deletion). If there are hits, the helper is still shared — leave it in the monolith and add an import in `graph.ts` instead: `import { <helperName> } from '../synergy-graph';`.

- [ ] **Step 6: Update `engine.ts` import (if needed)**

Run: `grep -n "from './synergy-graph'" resources/js/workers/scout/engine.ts`

Expected: 1 hit — the existing line `import { buildGraph, findTeams } from './synergy-graph';`. **Do not edit this line.** The re-export chain means it keeps resolving to the same symbols.

If grep shows 0 hits, someone already changed the import path — stop and investigate.

- [ ] **Step 7: Run Verification Recipe V**

```bash
npx tsc --noEmit
npm run build
bash scripts/refactor-R-checkpoint.sh
```

Expected: tsc clean, build clean, 5 "OK" lines.

If **tsc fails** on a type error in `graph.ts`, add `// @ts-nocheck` at the top of the file (matches monolith) and retry.

If **build fails** on a missing export, check Step 4's re-export chain.

If **checkpoint shows DRIFT**, the code move was not byte-preserving. Use `git diff` on `synergy-graph.ts` + `synergy-graph/graph.ts` to compare and look for missing helpers. Rollback with `git reset --hard HEAD~0; git checkout .` and retry.

- [ ] **Step 8: Commit**

```bash
git add resources/js/workers/scout/synergy-graph/ resources/js/workers/scout/synergy-graph.ts
git commit -m "$(cat <<'EOF'
refactor(scout): start synergy-graph folder — move buildGraph (6a/15)

Creates resources/js/workers/scout/synergy-graph/{index.ts, types.ts,
graph.ts}. buildGraph relocates from the monolith into graph.ts; the
monolith stays as a compat re-export shim so engine.ts's existing
import keeps resolving without edit.

Zero behavior change — verified via scout-cli baseline diff on
5 scenarios (non-lock lvl8, ShieldTank:6 lvl10, DarkStar:4 lvl10,
emblem, hero-swap). All byte-identical.

Part of R (refactor) sub-project.
Spec: docs/superpowers/specs/2026-04-15-scout-refactor-cleanup-design.md

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 (Commit 6b): Move quickScore + team-builder helpers

**Files:**
- Create: `resources/js/workers/scout/synergy-graph/quick-score.ts`
- Create: `resources/js/workers/scout/synergy-graph/shared/team-builder.ts`
- Modify: `resources/js/workers/scout/synergy-graph.ts` (shrink — remove moved code)
- Modify: `resources/js/workers/scout/synergy-graph/index.ts` (re-export quickScore if any external caller needs it; likely none)

**Context:** `quickScore` is the lightweight pre-filter scorer used during team building. `tryBuildAroundAnchor` and `pickCandidatesByScore` are anchor-driven routines shared by multiple phases (locked-trait-seeded, trait-seeded, companion-seeded, possibly more). Moving all three now so phase-by-phase moves in Tasks 4-13 can import them from stable locations.

- [ ] **Step 1: Locate quickScore in the monolith**

Run: `grep -n "function quickScore\|export function quickScore" resources/js/workers/scout/synergy-graph.ts`

Expected: 1 hit around line 300. Read the full function (roughly 40-80 lines including the affinity inline loop that Task 20 will refactor — leave it inline for now, do not touch the inline loop in this task).

- [ ] **Step 2: Locate team-builder helpers**

Run: `grep -n "function tryBuildAroundAnchor\|function pickCandidatesByScore" resources/js/workers/scout/synergy-graph.ts`

Expected: 2 hits. Read both function bodies. Note any other helpers they call that are used only by these two (those move with them) vs helpers shared more widely (those stay in monolith).

- [ ] **Step 3: Create `synergy-graph/quick-score.ts`**

Create a new file with the exact body of `quickScore` copied verbatim:

```ts
// resources/js/workers/scout/synergy-graph/quick-score.ts
//
// quickScore — lightweight pre-filter scorer used during team
// seeding. Subset of the full scorer; intentional divergence from
// scorer.ts (different aggregation strategy for affinity so the
// pre-filter is fast and doesn't dominate budget).

// @ts-nocheck

import type { Graph } from './types';

export function quickScore(/* exact signature */) {
  // exact body verbatim, including the inline affinity loop
  // (Task 20 refactors this separately)
}
```

- [ ] **Step 4: Create `synergy-graph/shared/team-builder.ts`**

```ts
// resources/js/workers/scout/synergy-graph/shared/team-builder.ts
//
// Anchor-driven team building primitives. Pure — no state, no
// profiler spans, no side effects beyond inputs. Consumed by
// multiple phases (locked-trait-seeded, trait-seeded,
// companion-seeded).

// @ts-nocheck

import { quickScore } from '../quick-score';
import type { Graph } from '../types';

export function tryBuildAroundAnchor(/* exact signature */) {
  // exact body verbatim
}

export function pickCandidatesByScore(/* exact signature */) {
  // exact body verbatim
}

// Any private helper only used by these two moves here too.
```

**Rule**: if `tryBuildAroundAnchor` calls a helper `foo` that is also called by any phase in the monolith, `foo` stays in the monolith and `team-builder.ts` imports it via `import { foo } from '../../synergy-graph';`. Run `grep -n "foo(" resources/js/workers/scout/synergy-graph.ts` for each candidate helper to decide.

- [ ] **Step 5: Update monolith to re-export the moved symbols**

In `synergy-graph.ts`:

```ts
// near the top, after existing imports
export { quickScore } from './synergy-graph/quick-score';
export { tryBuildAroundAnchor, pickCandidatesByScore } from './synergy-graph/shared/team-builder';
```

Delete the old inline function bodies in `synergy-graph.ts` for all three functions. Leave the `function` keyword NOWHERE in the monolith for these names.

Verify:

```bash
grep -n "function quickScore\|function tryBuildAroundAnchor\|function pickCandidatesByScore" resources/js/workers/scout/synergy-graph.ts
```

Expected: 0 hits.

- [ ] **Step 6: Verify internal callers still resolve**

Run: `grep -n "quickScore\|tryBuildAroundAnchor\|pickCandidatesByScore" resources/js/workers/scout/synergy-graph.ts`

Expected: every hit is a bare function call inside one of the still-inline phases (e.g. `quickScore(...)`, `tryBuildAroundAnchor(...)`). Those calls resolve via the re-exports added in Step 5 — no edit needed.

- [ ] **Step 7: Run Verification Recipe V**

```bash
npx tsc --noEmit
npm run build
bash scripts/refactor-R-checkpoint.sh
```

Expected: tsc clean, build clean, 5 "OK" lines. Any DRIFT = rollback and check whether a private helper was accidentally moved.

- [ ] **Step 8: Commit**

```bash
git add resources/js/workers/scout/synergy-graph/ resources/js/workers/scout/synergy-graph.ts
git commit -m "$(cat <<'EOF'
refactor(scout): move quickScore + team-builder helpers (6b/15)

Extracts quickScore into synergy-graph/quick-score.ts (inline
affinity loop stays — Task 20 refactors it). Extracts
tryBuildAroundAnchor + pickCandidatesByScore into
synergy-graph/shared/team-builder.ts so later phase moves can import
them from stable locations.

Zero behavior change — verified via scout-cli baseline diff on
5 scenarios. All byte-identical.

Part of R (refactor) sub-project.
Spec: docs/superpowers/specs/2026-04-15-scout-refactor-cleanup-design.md

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 (Commit 6c): Move emblems + const helpers

**Files:**
- Create: `resources/js/workers/scout/synergy-graph/shared/emblems.ts`
- Create: `resources/js/workers/scout/synergy-graph/shared/const.ts`
- Modify: `resources/js/workers/scout/synergy-graph.ts` (remove moved code)

**Context:** `applyEmblems` and emblem permutation helpers live in the monolith as pure functions. Magic numbers (`FILLER_PICK_DECAY = 0.5`, companion cost weights `[0.3, 0.5, 1.0, 0.95, 0.55]`, maxResults multipliers) are scattered as inline literals. Extracting both unlocks per-phase moves in Tasks 4-13 without duplicating constants.

- [ ] **Step 1: Locate emblem helpers**

Run: `grep -n "function applyEmblems\|emblemPermutations\|emblem.*permutation\|function.*emblem" resources/js/workers/scout/synergy-graph.ts`

Read each matching function. Note helpers private to the group vs shared with phases.

- [ ] **Step 2: Create `synergy-graph/shared/emblems.ts`**

```ts
// resources/js/workers/scout/synergy-graph/shared/emblems.ts
//
// Emblem application + permutation helpers. Pure — operate on
// trait count maps and return new maps, never mutate inputs.
// Consumed by graph building (edge computation) and phases that
// explore emblem placements (deepVertical).

// @ts-nocheck

export function applyEmblems(/* exact signature */) {
  // exact body verbatim
}

// plus any other emblem helpers found in Step 1
```

- [ ] **Step 3: Locate magic number constants**

Run:

```bash
grep -n "FILLER_PICK_DECAY\|const.*\[0\.3, 0\.5, 1\.0\|companionCostWeights" resources/js/workers/scout/synergy-graph.ts
grep -n "maxResults \*" resources/js/workers/scout/synergy-graph.ts
grep -n "const [A-Z][A-Z_]* = " resources/js/workers/scout/synergy-graph.ts
```

Expected: `FILLER_PICK_DECAY = 0.5` (from Fix 1E) + companion cost weights array + any other SCREAMING_SNAKE constants. List them.

- [ ] **Step 4: Create `synergy-graph/shared/const.ts`**

```ts
// resources/js/workers/scout/synergy-graph/shared/const.ts
//
// Named constants for the synergy-graph phases. Each constant is
// exported with a `Why:` comment explaining the value choice so
// future tuners have context.

// Decay applied after each companion filler pick so flex fillers
// (Shen, Karma) surface once or twice without dominating the slate.
// Why: Fix 1E — tight lock runs had Shen in 30/30 comps pre-decay.
// 0.5 halves the pick weight each time, so a single filler's second
// pick already competes with fresh anchors.
export const FILLER_PICK_DECAY = 0.5;

// Cost-based weights used by phaseCompanionSeeded to decide which
// anchor's top-companion list drives filler selection.
// Why: 3/4-cost carries drive team composition in practice; 5-costs
// are spike units that rarely define comps. Index = cost - 1.
export const COMPANION_COST_WEIGHTS: readonly number[] = [0.3, 0.5, 1.0, 0.95, 0.55];

// Cap on filler picks sourced from a single 5-cost anchor.
// Why: Fix 1E throttle — prevents a single 5-cost from monopolising
// the filler slate when it has a deep top-10 companion list.
export const MAX_5COST_FILLER_PICKS = 3;

// Plus any other constants surfaced in Step 3, one per declaration
// with a Why: comment.
```

**Rule**: every constant gets a Why comment. If you don't know the why, `grep` the commit history for the constant's introducing commit (`git log -S '<constant>' --oneline resources/js/workers/scout/synergy-graph.ts`) and read the commit message.

- [ ] **Step 5: Update monolith to import from the new const file and re-export the emblem helpers**

At the top of `synergy-graph.ts`:

```ts
export { applyEmblems /*, other emblem helpers */ } from './synergy-graph/shared/emblems';
import {
  FILLER_PICK_DECAY,
  COMPANION_COST_WEIGHTS,
  MAX_5COST_FILLER_PICKS,
  /* other constants from Step 4 */
} from './synergy-graph/shared/const';
```

Delete the old inline emblem function bodies and the old `const` declarations.

**Do not edit the inline phases' use of these constants** — the imports make them resolve identically.

- [ ] **Step 6: Grep for leftover literals**

Run:

```bash
grep -n "0\.5\|FILLER_PICK_DECAY" resources/js/workers/scout/synergy-graph.ts
grep -n "\[0\.3, 0\.5, 1\.0" resources/js/workers/scout/synergy-graph.ts
```

Expected for line 1: hits only inside phase body code (`* 0.5` etc.) that are NOT the extracted constant. Literal `0.5` in math expressions is fine; only the named `FILLER_PICK_DECAY = 0.5` declaration should be gone.

Expected for line 2: 0 hits. If there are hits, someone inline-pasted the array literal in a phase body — replace with `COMPANION_COST_WEIGHTS` import.

- [ ] **Step 7: Run Verification Recipe V**

```bash
npx tsc --noEmit
npm run build
bash scripts/refactor-R-checkpoint.sh
```

Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add resources/js/workers/scout/synergy-graph/ resources/js/workers/scout/synergy-graph.ts
git commit -m "$(cat <<'EOF'
refactor(scout): extract emblems helpers + constants (6c/15)

Moves applyEmblems and emblem-permutation helpers to
synergy-graph/shared/emblems.ts. Extracts magic numbers
(FILLER_PICK_DECAY, COMPANION_COST_WEIGHTS, MAX_5COST_FILLER_PICKS,
...) to synergy-graph/shared/const.ts with Why-comments for each.

Zero behavior change — verified via scout-cli baseline diff on
5 scenarios. All byte-identical.

Part of R (refactor) sub-project.
Spec: docs/superpowers/specs/2026-04-15-scout-refactor-cleanup-design.md

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase Move Recipe (reused by Tasks 4-13)

Each of Tasks 4-13 moves exactly one phase from the monolith into its own file under `synergy-graph/phases/`. All 10 tasks follow this recipe — the **only** differences are the phase name and the file path. Subagents executing these tasks should read this recipe once and then apply it per task.

### Recipe R (single-phase move)

**Inputs:**
- `<PHASE_CAMEL>` — camelCase name, e.g. `phaseLockedTraitSeeded`
- `<PHASE_KEBAB>` — kebab-case file stem, e.g. `locked-trait-seeded`

**Steps:**

1. **Read the phase body in the monolith.**

   `grep -n "^function <PHASE_CAMEL>" resources/js/workers/scout/synergy-graph.ts`

   Read the whole body through its closing `}`. Note every symbol it references that is NOT a language builtin: helpers, constants, types, other functions.

2. **Classify each referenced symbol as (a) in-folder (already moved) or (b) monolith (still there) or (c) module-external (scorer, config, etc.).**

   For each, note the import path it will need in the new file:
   - In-folder already-moved symbols: `../shared/<file>`, `../quick-score`, `../graph`, `../types`
   - Monolith symbols (helpers not yet extracted): `'../../synergy-graph'`
   - Module-external: same path as in the monolith, but adjusted for the new file's depth (`../../<...>`)

3. **Create `resources/js/workers/scout/synergy-graph/phases/<PHASE_KEBAB>.ts`:**

   ```ts
   // resources/js/workers/scout/synergy-graph/phases/<PHASE_KEBAB>.ts
   //
   // <Phase description — 1 sentence. Copy from the JSDoc or comment
   // that precedes the phase body in the monolith, if any.>

   // @ts-nocheck

   // imports classified in Step 2
   import { /* symbols */ } from '../shared/...';
   import { /* symbols */ } from '../../synergy-graph';
   // ... etc.

   export function <PHASE_CAMEL>(/* exact signature from monolith */) {
     // body copied verbatim from the monolith
   }
   ```

   **Signature note**: keep the destructured-parameter signature exactly as it is in the monolith for this task. Task 14 (core.ts + PhaseContext) unifies signatures. Changing both shape and location in one task would mix two concerns.

4. **Replace the phase in the monolith with a re-export:**

   Delete the entire `function <PHASE_CAMEL>(...)` body from `synergy-graph.ts` and replace with:

   ```ts
   export { <PHASE_CAMEL> } from './synergy-graph/phases/<PHASE_KEBAB>';
   ```

   Place the re-export near the top of the file, grouped with previous phase re-exports.

5. **Verify the dispatcher still calls the phase via the re-exported symbol.**

   `grep -n "<PHASE_CAMEL>(" resources/js/workers/scout/synergy-graph.ts`

   Expected: 1+ hits inside `findTeams` (or wherever the phase is dispatched). These call the re-exported symbol — no edit needed.

   If there are 0 hits in `findTeams`, the dispatch was removed by an earlier task by mistake — stop and investigate.

6. **Run Verification Recipe V.**

   ```bash
   npx tsc --noEmit
   npm run build
   bash scripts/refactor-R-checkpoint.sh
   ```

7. **Commit:**

   ```bash
   git add resources/js/workers/scout/synergy-graph/phases/<PHASE_KEBAB>.ts resources/js/workers/scout/synergy-graph.ts
   git commit -m "$(cat <<'EOF'
   refactor(scout): move <PHASE_CAMEL> to phases/ (6d<N>/15)

   Extracts the phase body into synergy-graph/phases/<PHASE_KEBAB>.ts
   with the existing destructured signature. Monolith re-exports the
   symbol so dispatch in findTeams keeps resolving.

   Zero behavior change — verified via scout-cli baseline diff on
   5 scenarios. All byte-identical.

   Part of R (refactor) sub-project.
   Spec: docs/superpowers/specs/2026-04-15-scout-refactor-cleanup-design.md

   Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

---

## Tasks 4-13: Phase-by-phase moves

Each task applies **Recipe R** with the substitutions below. Order is chosen so larger/riskier phases come earlier (while the reviewer is fresh), with cleanup tails at the end.

| Task | Commit | PHASE_CAMEL | PHASE_KEBAB | Monolith lines | Notes |
|---|---|---|---|---|---|
| 4 | 6d1 | `phasePairSynergy` | `pair-synergy` | 1104-1370 (267) | Largest, move first while reviewer is fresh. Heavy helper use — expect several `'../../synergy-graph'` imports. |
| 5 | 6d2 | `phaseHillClimb` | `hill-climb` | 1425-1516 (92) | Uses hill-climb specific helpers; check if any are private to this phase and move them into the same file. |
| 6 | 6d3 | `phaseLockedTraitSeeded` | `locked-trait-seeded` | 902-977 (76) | Uses `tryBuildAroundAnchor` — import from `../shared/team-builder`. |
| 7 | 6d4 | `phaseDeepVertical` | `deep-vertical` | 1039-1103 (65) | Uses emblems extensively — import from `../shared/emblems`. |
| 8 | 6d5 | `phaseMetaCompSeeded` | `meta-comp-seeded` | 1517-1558 (42) | |
| 9 | 6d6 | `phaseCrossover` | `crossover` | 1386-1424 (39) | |
| 10 | 6d7 | `phaseTraitSeeded` | `trait-seeded` | 1003-1038 (36) | |
| 11 | 6d8 | `phaseTemperatureSweep` | `temperature-sweep` | 978-1002 (25) | Short. Its skip-on-locked logic from Fix 2A is a body check — KEEP IT IN THE PHASE for this task. Task 14 lifts it to `skipWhen`. |
| 12 | 6d9 | `phaseFiveCostHeavy` | `five-cost-heavy` | 1559-?? (40 + trailing helpers) | Check what lives AFTER the phase body in the monolith. Trailing module-level helpers that no other phase uses move here; helpers used elsewhere stay in the monolith. |
| 13 | 6d10 | `phaseCompanionSeeded` | `companion-seeded` | 1371-1385 (15) | Shortest. Cross-references Fix 1E anchor-driven ranker — relies heavily on `COMPANION_COST_WEIGHTS` and `FILLER_PICK_DECAY` from `../shared/const`. |

For each row, apply Recipe R with `<PHASE_CAMEL>` and `<PHASE_KEBAB>` substituted. Each task is a single commit with message `refactor(scout): move <PHASE_CAMEL> to phases/ (6d<N>/15)` where `<N>` is the row's Task-number minus 3 (so Task 4 = 6d1, Task 13 = 6d10).

**Critical invariants preserved across all 10 tasks:**

- No phase imports from another phase. If Recipe R Step 2 finds a phase-to-phase reference, the shared symbol goes to `shared/` (may need a sub-step to create a new `shared/<topic>.ts` file). In practice this should not happen — the monolith today does not cross-call phases, all cross-phase logic goes through shared helpers.
- The monolith shrinks by the phase's LOC each task. `wc -l resources/js/workers/scout/synergy-graph.ts` should decrease monotonically.
- The baseline diff must stay byte-identical at every commit. **Drift on a phase move = the phase body was not copied verbatim.**

---

## Task 14 (Commit 6e): Create core.ts with PhaseContext + PHASES registry

**Files:**
- Create: `resources/js/workers/scout/synergy-graph/core.ts`
- Modify: `resources/js/workers/scout/synergy-graph/types.ts` (add Phase + PhaseContext)
- Modify: `resources/js/workers/scout/synergy-graph/index.ts` (switch `findTeams` re-export to `./core`)
- Modify: `resources/js/workers/scout/synergy-graph/phases/*.ts` (10 files — rewrite each signature to take `ctx: PhaseContext`)
- Delete: `resources/js/workers/scout/synergy-graph.ts` (the now-empty monolith)

**Context:** All 10 phases are in their own files. `findTeams` + dispatch still live in the monolith. This task creates `core.ts` with `findTeams`, unifies phase signatures to `(ctx: PhaseContext) => void`, lifts skip conditions to the `PHASES` registry, and deletes the empty monolith. **This is the riskiest task in the plan** — it touches 10 phase files plus core dispatch plus signature shapes. Baseline diff is the safety net.

- [ ] **Step 1: Add Phase + PhaseContext types**

Open `synergy-graph/types.ts` and append:

```ts
// Phase contract. All phases implement this signature post-6e.
// Every phase takes the single `ctx` bag and destructures what it
// needs at the top of its body.
export type PhaseContext = {
  graph: Graph;
  teamSize: number;
  startChamps: any[];
  context: any;
  rng: any;
  maxResults: number;
  results: any[];
  addResult: (team: any) => void;
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

**Field list verification**: open 3-4 phase files in `phases/` and union the fields they destructure from their current parameter. The `PhaseContext` field list must be the superset. If a phase destructures a field not in the type above, add it. Missing a field = that phase gets `undefined` at runtime and output drifts on Step 11 baseline diff.

- [ ] **Step 2: Rewrite each phase file to take `ctx: PhaseContext`**

For each of the 10 files in `phases/`, change the function signature from destructured params to `(ctx: PhaseContext)` and add a destructure line at the top:

Before:

```ts
export function phaseDeepVertical({ graph, teamSize, startChamps, context, rng, maxResults, results, addResult, excludedSet, excludedTraits, emblems }) {
  // body
}
```

After:

```ts
import type { PhaseContext } from '../types';

export function phaseDeepVertical(ctx: PhaseContext): void {
  const { graph, teamSize, startChamps, context, rng, maxResults, results, addResult, excludedSet, excludedTraits, emblems } = ctx;
  // body unchanged
}
```

The destructure must be a verbatim list of the params the original signature had — no additions, no removals. The body must not change at all.

Do this for all 10 phase files. Group commit by running the baseline diff once at the end of this step, not per-phase — they must land as one atomic change because the dispatch loop (Step 4) expects the unified shape.

- [ ] **Step 3: Locate the current `findTeams` body and dispatch sequence**

Run: `grep -n "function findTeams\|phaseLockedTraitSeeded(\|phaseTemperatureSweep(" resources/js/workers/scout/synergy-graph.ts`

Read `findTeams` in full. Identify:
- The initialisation code that builds `graph`, `startChamps`, `excludedSet`, etc.
- The phase call sequence (each `phaseFoo({ ... })` call).
- Any conditionals around phase calls (e.g. the skip-on-locked for `phaseTemperatureSweep` from Fix 2A).
- The `startSpan` wrapping around each phase call.
- The tail logic after all phases run (result sorting, topN truncation).

- [ ] **Step 4: Create `synergy-graph/core.ts`**

```ts
// resources/js/workers/scout/synergy-graph/core.ts
//
// Orchestration for the synergy-graph algorithm. Owns findTeams,
// the PHASES registry, and the phase dispatch loop. Never contains
// phase-level algorithmic logic — that lives in phases/*.

// @ts-nocheck

import { startSpan } from '../scout-profiler';
import { phaseLockedTraitSeeded } from './phases/locked-trait-seeded';
import { phaseTemperatureSweep } from './phases/temperature-sweep';
import { phaseTraitSeeded } from './phases/trait-seeded';
import { phaseDeepVertical } from './phases/deep-vertical';
import { phasePairSynergy } from './phases/pair-synergy';
import { phaseCompanionSeeded } from './phases/companion-seeded';
import { phaseCrossover } from './phases/crossover';
import { phaseHillClimb } from './phases/hill-climb';
import { phaseMetaCompSeeded } from './phases/meta-comp-seeded';
import { phaseFiveCostHeavy } from './phases/five-cost-heavy';
import type { PhaseContext, PhaseEntry } from './types';

// Predicate for skipping temperature sweep when any lock is active
// (Fix 2A — locked runs already populate the trait-satisfying search
// space via phaseLockedTraitSeeded, so temperatureSweep is redundant
// and expensive). Previously an inline early-return inside the phase
// body; surfaced here so orchestration decisions are visible at the
// registry level.
function hasAnyLock(ctx: PhaseContext): boolean {
  return (ctx.context?.lockedChamps?.length ?? 0) > 0
      || (ctx.context?.lockedTraits?.length ?? 0) > 0;
}

const PHASES: PhaseEntry[] = [
  { name: 'lockedTraitSeeded', phase: phaseLockedTraitSeeded },
  { name: 'temperatureSweep',  phase: phaseTemperatureSweep, skipWhen: hasAnyLock },
  { name: 'traitSeeded',       phase: phaseTraitSeeded },
  { name: 'deepVertical',      phase: phaseDeepVertical },
  { name: 'pairSynergy',       phase: phasePairSynergy },
  { name: 'companionSeeded',   phase: phaseCompanionSeeded },
  { name: 'crossover',         phase: phaseCrossover },
  { name: 'hillClimb',         phase: phaseHillClimb },
  { name: 'metaCompSeeded',    phase: phaseMetaCompSeeded },
  { name: 'fiveCostHeavy',     phase: phaseFiveCostHeavy },
];

export function findTeams(/* exact signature as in the old monolith */) {
  // Copy the initialisation code from the monolith's findTeams verbatim:
  //   - build graph, startChamps, excludedSet, excludedTraits, emblems
  //   - set up results, addResult, maxResults, teamSize
  //   - everything up to the first phase call

  const phaseCtx: PhaseContext = {
    graph, teamSize, startChamps, context, rng, maxResults,
    results, addResult, excludedSet, excludedTraits, emblems,
  };

  for (const { name, phase, skipWhen } of PHASES) {
    if (skipWhen?.(phaseCtx)) continue;
    const end = startSpan(`synergy.phase.${name}`);
    phase(phaseCtx);
    end();
  }

  // Copy the tail logic from the monolith verbatim:
  //   - sort results, topN truncation, any final adjustments
  //   - return statement
}
```

**Critical for byte-identical output**:
- The phase **ordering** in the `PHASES` array must exactly match the call order in the old `findTeams` body.
- The `skipWhen` for `temperatureSweep` must match the exact predicate that was inlined in the old `phaseTemperatureSweep` body. Read the old phase to confirm the condition. If the old body's skip condition was `context.lockedChamps.length > 0 || context.lockedTraits.length > 0`, then `hasAnyLock` above is correct. If it differs, update `hasAnyLock`.
- After moving the skip to `skipWhen`, **remove the corresponding early return from `phases/temperature-sweep.ts`**. Leaving it in is harmless (double-check) but the dead code adds noise. Verify the phase body no longer contains the inline skip.
- The `startSpan` names must match the old spans — use `synergy.phase.<camelCaseName>` with exactly the names the profiler report in `docs/superpowers/research/scout-perf-2026-04-14.md` shows. Mismatched span names won't break the baseline diff but will confuse future profiling.

- [ ] **Step 5: Delete the empty monolith**

After copying `findTeams` verbatim into `core.ts`, `synergy-graph.ts` contains only re-exports (for `buildGraph`, `quickScore`, `applyEmblems`, the 10 phase names). Delete the file entirely:

```bash
rm resources/js/workers/scout/synergy-graph.ts
```

- [ ] **Step 6: Update `synergy-graph/index.ts` to export from core**

```ts
// resources/js/workers/scout/synergy-graph/index.ts
export { buildGraph } from './graph';
export { findTeams } from './core';
```

Everything else (`quickScore`, `applyEmblems`, phase names) was only re-exported in the monolith for internal use. If engine.ts imports something else from `./synergy-graph`, add it here — but expected set is `buildGraph` + `findTeams` only.

- [ ] **Step 7: Verify engine.ts import still resolves**

Run: `grep -n "from './synergy-graph'" resources/js/workers/scout/engine.ts`

Expected: 1 hit — `import { buildGraph, findTeams } from './synergy-graph';`. Node/Vite module resolution treats `'./synergy-graph'` as `'./synergy-graph/index.ts'` automatically after the monolith file is deleted, because the folder's `index.ts` takes over.

- [ ] **Step 8: Grep for stale references**

```bash
grep -rn "from.*'\.\./synergy-graph'\"" resources/js/workers/scout/
grep -rn "from.*'\.\./\.\.\/synergy-graph'" resources/js/workers/scout/
```

Expected: every hit inside `synergy-graph/` points to `./core`, `./graph`, `./quick-score`, `./types`, or `../synergy-graph` (external callers like scorer, if any — but scorer shouldn't import synergy-graph).

If any hit inside `synergy-graph/` still points to `../synergy-graph` (the deleted monolith), fix it to resolve against `./core` or the appropriate inner file.

- [ ] **Step 9: Verify phase skip removed from temperature-sweep**

Run: `grep -n "lockedChamps\|lockedTraits" resources/js/workers/scout/synergy-graph/phases/temperature-sweep.ts`

Expected: 0 hits (the skip moved to `hasAnyLock` in `core.ts`). If there are hits, the inline skip is still there — remove it.

- [ ] **Step 10: Run Verification Recipe V**

```bash
npx tsc --noEmit
npm run build
bash scripts/refactor-R-checkpoint.sh
```

Expected: all green, 5 "OK" lines.

**If the baseline diff fails on any scenario**, the likely causes in priority order:
1. `PhaseContext` field list missing something that a phase destructured.
2. Phase ordering in `PHASES` array differs from the old `findTeams` call order.
3. `hasAnyLock` predicate doesn't match the old inline skip condition.
4. `findTeams` tail logic (sorting, topN) was not copied verbatim.

Debug via `diff tmp/refactor-R-baseline/<scenario>.json tmp/refactor-R-current/<scenario>.json | head -60`. A drift that affects all 5 scenarios is likely #1 or #4. A drift only on locked scenarios (02, 03, 04) is likely #3.

If all else fails: `git reset --hard HEAD~0`, `git checkout .`, and re-attempt the task in smaller sub-steps (e.g. `core.ts` without unified signatures first, then unify signatures in a second commit).

- [ ] **Step 11: Commit**

```bash
git add resources/js/workers/scout/synergy-graph/
git rm resources/js/workers/scout/synergy-graph.ts
git commit -m "$(cat <<'EOF'
refactor(scout): core.ts with PhaseContext + PHASES registry (6e/15)

Creates synergy-graph/core.ts owning findTeams, the PHASES registry
(10 entries in the original dispatch order), and the per-phase
startSpan loop. Unifies all 10 phase signatures to (ctx: PhaseContext)
with a body-local destructure. Lifts Fix 2A's skip-on-locked for
temperatureSweep from an inline early-return to the registry's
skipWhen predicate.

Deletes the now-empty synergy-graph.ts monolith — synergy-graph/index.ts
takes over as the public entry, and engine.ts's existing
`import from './synergy-graph'` resolves to the folder automatically.

Zero behavior change — verified via scout-cli baseline diff on
5 scenarios. All byte-identical.

Part of R (refactor) sub-project.
Spec: docs/superpowers/specs/2026-04-15-scout-refactor-cleanup-design.md

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15 (Commit 6f): Cleanup + invariant checks

**Files:**
- Possibly modify: `resources/js/workers/scout/synergy-graph/**/*.ts` (dead import removal, cosmetic)

**Context:** All moves done. This task sweeps for leftover dead code, verifies file-size invariants, and confirms no phase imports another phase.

- [ ] **Step 1: Verify no phase-to-phase imports**

Run:

```bash
for f in resources/js/workers/scout/synergy-graph/phases/*.ts; do
  echo "=== $f"
  grep -n "from '.*phases/" "$f" || echo "(clean)"
done
```

Expected: every file reports "(clean)". If any phase imports from `./phases/<other>`, the shared symbol must move to `shared/` — do so now as part of this commit.

- [ ] **Step 2: Verify file sizes are reasonable**

Run: `wc -l resources/js/workers/scout/synergy-graph/**/*.ts`

Expected:
- `types.ts` under 50
- `index.ts` under 10
- `core.ts` under 200
- `graph.ts` under 400
- `quick-score.ts` under 200
- `shared/*.ts` each under 200
- `phases/*.ts` each under 300 (pair-synergy will be the largest at ~270)

If any file exceeds its target, investigate: did too much code move together, or is the target wrong? A file at 301 lines is fine; a file at 600 lines needs another split.

- [ ] **Step 3: Check for dead imports**

Run: `npx tsc --noEmit --noUnusedLocals --noUnusedParameters resources/js/workers/scout/synergy-graph/**/*.ts`

Note: the project's main `tsconfig.json` probably doesn't enable these flags — run it as a one-off check. Expected: some warnings from `@ts-nocheck` files (suppressed) plus any genuine unused imports in new files.

Remove any unused imports in the `synergy-graph/` folder surfaced by the check. **Do not touch other files.**

- [ ] **Step 4: Grep for stale monolith references**

```bash
grep -rn "workers/scout/synergy-graph\.ts" resources/ scripts/ docs/
grep -rn "synergy-graph.ts" .claude/ 2>/dev/null
```

Expected: no hits outside of commit history / historical docs. Any live code reference to `synergy-graph.ts` is a bug (the file is deleted). Fix any hits by updating the import path to `./synergy-graph` (folder).

Historical docs (`docs/superpowers/research/*.md`) may reference the old filename — those are frozen records, don't touch them.

- [ ] **Step 5: Run final Verification Recipe V**

```bash
npx tsc --noEmit
npm run build
bash scripts/refactor-R-checkpoint.sh
```

Expected: all green. This is the last checkpoint for Phase 6; Tasks 16-20 (Fix 3 + Fix 4) run against this cleaned structure.

- [ ] **Step 6: Commit**

```bash
git add resources/js/workers/scout/synergy-graph/
git commit -m "$(cat <<'EOF'
refactor(scout): finalize synergy-graph folder (6f/15)

Verifies the invariants of the R sub-project's Phase 6 split:
- No phase-to-phase imports (all cross-phase logic via shared/)
- Each file under its size target (phases/* <300 LOC)
- No dead imports in new files
- No stale references to the deleted monolith

Zero behavior change — verified via scout-cli baseline diff on
5 scenarios. All byte-identical.

Closes Phase 6 of the R (refactor) sub-project. Tasks 16-20 extract
shared helpers against the cleaned structure.

Spec: docs/superpowers/specs/2026-04-15-scout-refactor-cleanup-design.md

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16 (Commit 3a): Extract findActiveBreakpointIdx to shared/breakpoints.ts

**Files:**
- Create: `resources/js/workers/scout/synergy-graph/shared/breakpoints.ts`
- Modify: `resources/js/workers/scout/team-insights.ts` (delete local helper, import from shared)

**Context:** `team-insights.ts:41` has a local function `activeBreakpointIdx` used 3 times in the file. The monolith (now `synergy-graph/phases/*` and `scorer.ts`) has 3-4 copies of the same logic. This task creates the canonical helper and wires `team-insights.ts` to use it. `scorer.ts` and phases are handled by Tasks 17 and 18.

- [ ] **Step 1: Create the helper file**

Create `resources/js/workers/scout/synergy-graph/shared/breakpoints.ts`:

```ts
// resources/js/workers/scout/synergy-graph/shared/breakpoints.ts
//
// findActiveBreakpointIdx — single source of truth for "which trait
// breakpoint is currently active given a unit count". Pure, no state.
//
// Consumers: team-insights.ts, scorer.ts, any phase that walks
// breakpoints. Before this extraction there were 4+ copies across
// the scout worker, each with its own micro-variations (some used
// `< bps[i].minUnits`, some `<=`; semantics identical).

/**
 * Returns the index of the highest breakpoint whose minUnits is <=
 * `count`, or -1 if `count` is below the first breakpoint.
 *
 * `breakpoints` MUST be sorted ascending by minUnits. Caller is
 * responsible for the sort; this function trusts the contract and
 * short-circuits as soon as it sees a breakpoint above count.
 */
export function findActiveBreakpointIdx(
  count: number,
  breakpoints: readonly { minUnits: number }[],
): number {
  let idx = -1;
  for (let i = 0; i < breakpoints.length; i++) {
    if (count >= breakpoints[i].minUnits) {
      idx = i;
    } else {
      break;
    }
  }
  return idx;
}
```

- [ ] **Step 2: Read the local helper in team-insights.ts**

Run: `grep -n "function activeBreakpointIdx" resources/js/workers/scout/team-insights.ts`

Expected: 1 hit around line 41. Read the function body and compare to `findActiveBreakpointIdx` above. The bodies should be equivalent — if there's a subtle difference (e.g. `>` vs `>=`), investigate: is the difference intentional? If intentional, the new helper's behavior must match team-insights' version exactly (breakpoints are sorted, and the existing behavior is the baseline for the diff). Update the new helper to match.

- [ ] **Step 3: Replace team-insights.ts local helper with import**

At the top of `team-insights.ts`, add:

```ts
import { findActiveBreakpointIdx } from './synergy-graph/shared/breakpoints';
```

Delete the local `function activeBreakpointIdx(...)` declaration.

Update all 3 call sites in the file (`team-insights.ts:316, 392, 446` per earlier grep) from `activeBreakpointIdx(...)` to `findActiveBreakpointIdx(...)`.

Run: `grep -n "activeBreakpointIdx\|findActiveBreakpointIdx" resources/js/workers/scout/team-insights.ts`

Expected: 1 import line + 3 call sites using `findActiveBreakpointIdx`. Zero references to the old local `activeBreakpointIdx` name.

- [ ] **Step 4: Run Verification Recipe V**

```bash
npx tsc --noEmit
npm run build
bash scripts/refactor-R-checkpoint.sh
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add resources/js/workers/scout/synergy-graph/shared/breakpoints.ts resources/js/workers/scout/team-insights.ts
git commit -m "$(cat <<'EOF'
refactor(scout): extract findActiveBreakpointIdx helper (3a/3)

Creates synergy-graph/shared/breakpoints.ts as the single source of
truth for the breakpoint-walk loop duplicated across team-insights,
scorer, and phase files. Wires team-insights.ts to the new helper
(deletes local activeBreakpointIdx).

Follow-up commits 3b and 3c wire scorer.ts and the phase files.

Zero behavior change — verified via scout-cli baseline diff on
5 scenarios. All byte-identical.

Part of R (refactor) sub-project, Fix 3.
Spec: docs/superpowers/specs/2026-04-15-scout-refactor-cleanup-design.md

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17 (Commit 3b): Wire scorer.ts to findActiveBreakpointIdx

**Files:**
- Modify: `resources/js/workers/scout/scorer.ts`

**Context:** `scorer.ts` has 3-4 inline copies of the breakpoint-walk loop. Each is ~5 lines — `let idx = -1; for (i = 0; i < bps.length; i++) { if (count >= bps[i].minUnits) idx = i; }` with micro-variations. Replace each with a call to `findActiveBreakpointIdx` imported from the shared helper.

- [ ] **Step 1: Grep for inline breakpoint walks**

Run:

```bash
grep -n "minUnits\|breakpoints\[i\]\|for (let i = 0; i < .*bps\|for (let i = 0; i < .*breakpoints" resources/js/workers/scout/scorer.ts
```

Expected: several hits. Inspect each to distinguish:
- **True breakpoint walks** that compute the active index — candidates for replacement.
- **Other loops** over breakpoints (e.g. summing all activated bonuses) — leave alone.

Make a list of line ranges for each true breakpoint walk. Aim for 3-4 ranges; if you find more or fewer, update the count in the commit message.

- [ ] **Step 2: Add the import**

At the top of `scorer.ts`, add (if not already imported):

```ts
import { findActiveBreakpointIdx } from './synergy-graph/shared/breakpoints';
```

- [ ] **Step 3: Replace each inline walk**

For each range identified in Step 1, replace the inline loop with a single call. Example — before:

```ts
let idx = -1;
for (let i = 0; i < bps.length; i++) {
  if (count >= bps[i].minUnits) idx = i;
}
if (idx >= 0) { /* use bps[idx] */ }
```

After:

```ts
const idx = findActiveBreakpointIdx(count, bps);
if (idx >= 0) { /* use bps[idx] */ }
```

**Critical**: the behavior of the helper must match each inline variant. Walk through each replacement in your head: does the old loop's final `idx` value equal `findActiveBreakpointIdx(count, bps)` for every valid input? If any variant uses `<` instead of `>=` or stops at a different condition, **do not replace that variant** — document it as an intentional semantic difference in a comment above the inline loop and leave it inline. The refactor is byte-preserving; a semantic divergence is a separate bug, not a cleanup task.

- [ ] **Step 4: Run Verification Recipe V**

```bash
npx tsc --noEmit
npm run build
bash scripts/refactor-R-checkpoint.sh
```

Expected: all green. **If the baseline diff drifts**, one of the replacements changed semantics. Revert the specific replacement, `diff` the before/after carefully, and either (a) fix the helper to match or (b) leave the variant inline with a comment.

- [ ] **Step 5: Commit**

```bash
git add resources/js/workers/scout/scorer.ts
git commit -m "$(cat <<'EOF'
refactor(scout): wire scorer to findActiveBreakpointIdx (3b/3)

Replaces N (3-4) inline breakpoint-walk loops in scorer.ts with
calls to the shared findActiveBreakpointIdx helper. Semantic
equivalence verified per-replacement via baseline diff.

Zero behavior change — verified via scout-cli baseline diff on
5 scenarios. All byte-identical.

Part of R (refactor) sub-project, Fix 3.
Spec: docs/superpowers/specs/2026-04-15-scout-refactor-cleanup-design.md

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

Update `N` in the commit message to the actual replacement count.

---

## Task 18 (Commit 3c): Wire phase files to findActiveBreakpointIdx

**Files:**
- Modify: `resources/js/workers/scout/synergy-graph/phases/*.ts` (any phase with an inline breakpoint walk)
- Possibly: `resources/js/workers/scout/synergy-graph/quick-score.ts`

**Context:** With phases now in separate files, it's cheap to grep for inline breakpoint walks across all phase files and replace each one.

- [ ] **Step 1: Grep across the folder**

Run:

```bash
grep -rn "for (let i = 0; i < .*bps\|for (let i = 0; i < .*breakpoints" resources/js/workers/scout/synergy-graph/
grep -rn "minUnits" resources/js/workers/scout/synergy-graph/
```

Expected: hits in phases that read trait activation levels (deepVertical, hillClimb, possibly others) and maybe `quick-score.ts`. List the files and line ranges.

- [ ] **Step 2: For each file with an inline walk, replace it**

Apply the same recipe as Task 17 Step 3 per file:
1. Add `import { findActiveBreakpointIdx } from '../shared/breakpoints';` (or `./shared/breakpoints` for `quick-score.ts`)
2. Replace the inline loop with a call
3. Verify semantic match before accepting the replacement

If a file's inline loop has a subtle variant (`<` vs `<=` etc.), leave it inline with a comment rather than forcing the replacement.

- [ ] **Step 3: Run Verification Recipe V**

```bash
npx tsc --noEmit
npm run build
bash scripts/refactor-R-checkpoint.sh
```

Expected: all green.

- [ ] **Step 4: Grep for any remaining inline walks**

```bash
grep -rn "for (let i = 0; i < .*\(bps\|breakpoints\)" resources/js/workers/scout/
```

Expected: 0 hits, or only hits inside `shared/breakpoints.ts` (the helper itself). Any other hit is a residual copy that should be either replaced or documented as intentional.

- [ ] **Step 5: Commit**

```bash
git add resources/js/workers/scout/synergy-graph/phases/ resources/js/workers/scout/synergy-graph/quick-score.ts
git commit -m "$(cat <<'EOF'
refactor(scout): wire phases + quick-score to findActiveBreakpointIdx (3c/3)

Replaces inline breakpoint-walk loops in phase files and quick-score
with calls to the shared helper. Closes Fix 3 from the perf sprint
deferred list — breakpoint walks now live in exactly one place
(synergy-graph/shared/breakpoints.ts).

Zero behavior change — verified via scout-cli baseline diff on
5 scenarios. All byte-identical.

Part of R (refactor) sub-project, Fix 3 complete.
Spec: docs/superpowers/specs/2026-04-15-scout-refactor-cleanup-design.md

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 19 (Commit 4a): Extract collectAffinityMatches + wire scorer.ts

**Files:**
- Create: `resources/js/workers/scout/synergy-graph/shared/affinity.ts`
- Modify: `resources/js/workers/scout/scorer.ts`

**Context:** `scorer.ts::affinityBonus` (lines 194-215) has an inline loop that collects per-trait affinity matches, weights them, and then caps/aggregates the resulting array against trait-diverse abuse. The collection half (loop + filter + weight) is duplicated in `quick-score.ts`. This task extracts the collection, wires scorer to use it, and keeps scorer's caller-side aggregation (cap logic) unchanged.

- [ ] **Step 1: Create `shared/affinity.ts`**

```ts
// resources/js/workers/scout/synergy-graph/shared/affinity.ts
//
// collectAffinityMatches — per-trait affinity match collection
// shared by scorer.ts and quick-score.ts. Returns the raw list of
// weighted place-bonus values for every trait that (a) matches an
// active trait and (b) has enough games to clear the noise
// threshold. Caller aggregates — scorer caps against trait-diverse
// abuse, quickScore sums lightly. Aggregation strategy is caller-
// specific by design.

type AffinityEntry = { trait: string; avgPlace: number; games: number };

/**
 * Collects per-trait affinity match bonuses for a champion given
 * the active trait set. Returns an array of weighted bonuses; the
 * caller decides whether to cap/sum/penalise.
 *
 * Lookup uses `champion.baseApiName ?? champion.apiName` — variants
 * (e.g. Miss Fortune Conduit) share the base champion's affinity
 * table. The `affinity` object is keyed by base apiName.
 *
 * Entries with `games < thresholds.affinityMinGames` are filtered
 * out to avoid noise from low-sample trait combos.
 */
export function collectAffinityMatches(
  champion: { apiName: string; baseApiName?: string },
  activeTraitApis: ReadonlySet<string>,
  affinity: Record<string, readonly AffinityEntry[] | undefined>,
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

- [ ] **Step 2: Read the current `affinityBonus` in scorer.ts**

Run: `grep -n "function affinityBonus" resources/js/workers/scout/scorer.ts`

Expected: 1 hit around line 194. Read the whole function — it likely has:
1. Lookup key resolution (`const lookupApi = ...`).
2. Inline loop that iterates `ctx.affinity[lookupApi]`, filters by activeTraits + games threshold, pushes weighted values to a `matches` array.
3. Aggregation: cap `matches.length` (sort, slice, or cap against a max cap constant) and sum.

Identify the exact boundary between **collection** (matches 1) and **aggregation** (matches 2). The collection half is replaced by the helper; the aggregation stays inline.

- [ ] **Step 3: Refactor affinityBonus**

At the top of `scorer.ts`, add:

```ts
import { collectAffinityMatches } from './synergy-graph/shared/affinity';
```

Replace the body of `affinityBonus`:

```ts
export function affinityBonus(champion: any, activeTraitApis: any, ctx: any) {
  const matches = collectAffinityMatches(
    champion,
    activeTraitApis,
    ctx.affinity ?? {},
    { affinityMinGames: thresholds.affinityMinGames },
    { affinityBonus: weights.affinityBonus },
  );

  // Existing cap/aggregation logic — copy verbatim from the old
  // affinityBonus body, starting from the line that operated on the
  // `matches` array.
  //   e.g.
  //   matches.sort((a, b) => b - a);
  //   const capped = matches.slice(0, thresholds.affinityMaxMatches);
  //   return capped.reduce((s, v) => s + v, 0);

  return /* cap + sum result */;
}
```

**Critical**: the aggregation code must be **verbatim** from the old function. Do not clean up, optimise, or "simplify" the cap logic. Byte-identical baseline diff demands an exact preservation.

If the old function declared `const matches = []` and populated it with `matches.push(...)` inline, the new code's `matches` (returned from the helper) is the same array shape. Any downstream use like `matches.sort`, `matches.slice`, `matches.reduce` works identically.

- [ ] **Step 4: Run Verification Recipe V**

```bash
npx tsc --noEmit
npm run build
bash scripts/refactor-R-checkpoint.sh
```

Expected: all green. **If baseline diff drifts**, the aggregation logic is not verbatim. Compare old vs new function with `git diff` and restore any dropped lines.

- [ ] **Step 5: Commit**

```bash
git add resources/js/workers/scout/synergy-graph/shared/affinity.ts resources/js/workers/scout/scorer.ts
git commit -m "$(cat <<'EOF'
refactor(scout): extract collectAffinityMatches + wire scorer (4a/2)

Creates synergy-graph/shared/affinity.ts with the pure collection
half (loop + filter + weight) of the affinity-match routine. Wires
scorer.ts::affinityBonus to use it; caller-side cap/sum aggregation
unchanged (scorer's defence against trait-diverse abuse stays where
it is — aggregation strategy is caller-specific by design).

Zero behavior change — verified via scout-cli baseline diff on
5 scenarios. All byte-identical.

Part of R (refactor) sub-project, Fix 4.
Spec: docs/superpowers/specs/2026-04-15-scout-refactor-cleanup-design.md

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 20 (Commit 4b): Wire quick-score.ts to collectAffinityMatches

**Files:**
- Modify: `resources/js/workers/scout/synergy-graph/quick-score.ts`

**Context:** `quick-score.ts` (moved in Task 2) still has an inline affinity loop copied from the old monolith. Replace with a call to `collectAffinityMatches`, keep its lighter aggregation (sum without cap) unchanged.

- [ ] **Step 1: Locate the inline loop in quick-score.ts**

Run: `grep -n "affinity\|aff\.trait" resources/js/workers/scout/synergy-graph/quick-score.ts`

Expected: the loop around where `quickScore` iterates `affinity[lookupApi]`. Read the surrounding code to identify the collection boundary (exactly as in Task 19 Step 2).

- [ ] **Step 2: Refactor the loop**

Add import:

```ts
import { collectAffinityMatches } from './shared/affinity';
```

Replace the inline collection with:

```ts
const affMatches = collectAffinityMatches(
  champion,
  activeTraitApis,
  affinity ?? {},
  { affinityMinGames: thresholds.affinityMinGames },
  { affinityBonus: weights.affinityBonus },
);

// keep quickScore's lighter aggregation verbatim — likely a sum:
for (const v of affMatches) score += v;
```

**Critical**: preserve the exact aggregation of quickScore. If it summed without cap in the old code, sum without cap now. If it used `score += matches.reduce(...)`, keep that. Do not align quickScore's aggregation with scorer's — they are intentionally different per spec.

- [ ] **Step 3: Run Verification Recipe V**

```bash
npx tsc --noEmit
npm run build
bash scripts/refactor-R-checkpoint.sh
```

Expected: all green.

- [ ] **Step 4: Final grep — no inline affinity loops remain**

```bash
grep -rn "aff\.trait\|affinity\[.*\]\.forEach\|for (.*of .*affinity\[" resources/js/workers/scout/
```

Expected: hits only in `shared/affinity.ts` (the helper) and in test/doc files (there are none). Any other hit is a residual copy — replace it or document it.

- [ ] **Step 5: Commit**

```bash
git add resources/js/workers/scout/synergy-graph/quick-score.ts
git commit -m "$(cat <<'EOF'
refactor(scout): wire quick-score to collectAffinityMatches (4b/2)

Replaces the inline affinity loop in quick-score.ts with a call to
the shared collectAffinityMatches helper. quickScore's lighter
aggregation (sum without cap) stays — scorer's cap-against-abuse
strategy is intentionally different.

Closes Fix 4 from the perf sprint deferred list — affinity
collection now lives in exactly one place
(synergy-graph/shared/affinity.ts).

Zero behavior change — verified via scout-cli baseline diff on
5 scenarios. All byte-identical.

Part of R (refactor) sub-project, Fix 4 complete. R sub-project
complete.
Spec: docs/superpowers/specs/2026-04-15-scout-refactor-cleanup-design.md

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final verification checklist (post-R)

Run these one-off checks after Task 20 commits. If any fails, open a follow-up commit to fix it before declaring R done.

- [ ] `wc -l resources/js/workers/scout/synergy-graph/**/*.ts` — no file over 400 lines.
- [ ] `grep -rn "activeBreakpointIdx\|findActiveBreakpointIdx" resources/js/workers/scout/` — all imports point to `shared/breakpoints.ts`; no local copies.
- [ ] `grep -rn "for.*aff.*of.*affinity\|affinity\[.*\]\.forEach" resources/js/workers/scout/` — no inline affinity collection loops outside `shared/affinity.ts`.
- [ ] `grep -rn "synergy-graph\.ts" resources/ scripts/` — the deleted monolith file is not referenced anywhere (exclude `.git/` and historical docs).
- [ ] `bash scripts/refactor-R-checkpoint.sh` — final baseline diff passes on 5 scenarios.
- [ ] Manual browser smoke at `/scout`:
  - No locks → top 10 comps, visual sanity.
  - Lock `ShieldTank:6` → 30 comps, ShieldTank:6 active in all.
  - Lock `DarkStar:4` + ShieldTank emblem → 30 comps.
  - Lock `Poppy_hero` → hero swap works, hero appears in final comp.
- [ ] `git log --oneline HEAD~20..HEAD` — 20 commits (or 21 with Task 0's checkpoint script), each tagged with the R sub-project message.
- [ ] scout-lab smoke: `SCOUT_LAB_ENABLED=1 SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 npm run scout -- experiment --preset level-sweep --tag post-R-smoke` — runs cleanly, produces results. (Full scout-lab diff is Phase V of the parent plan, not gated by R.)

## Rollback

Any single commit can be reverted via `git revert <sha>`. The R sub-project is behavior-preserving, so reverting a late commit (e.g. Task 20) leaves the earlier refactor in place — codebase is still cleaner than the pre-R state.

Worst case — revert the entire sub-project:

```bash
git revert --no-commit <Task0-sha>..HEAD
git commit -m "Revert R sub-project"
```

No database changes, no config changes, no cache. Worker bundle rebuilds on next `npm run build`.

## Open follow-ups (not part of R)

- **Phase P** — non-lock 201ms perf gap (deepVertical/traitSeeded/temperatureSweep tuning). Separate sub-project, spec after R ships.
- **Phase A** — `expectedStarPower` fallback scoring refactor + `costPenalty` tuning. Behavior changes, separate sub-project.
- **Phase V** — scout-lab batch 5 (post-perf-sprint baseline). User chose to skip as R-prerequisite; may run alongside Phase P.
- **Set-rules hook infrastructure** — `hero-exclusion.ts` TODO. Deferred until Set 18 ships.
- **scorer.ts organisational cleanup** — 562 LOC, multiple concerns, not currently painful. Separate sub-project if needed.
