# phaseLockedTraitSeeded Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `lockedTraits` drive team building instead of just post-filtering, so loose-case queries like `DarkStar:4` on a 7-champion pool return the full expected variety of compositions.

**Architecture:** Add a new phase `phaseLockedTraitSeeded` inside `resources/js/workers/scout/synergy-graph.ts` (inline with the existing phases, following project convention). The phase runs first in the pipeline when `lockedTraits` is non-empty, gets a dedicated cap of 50 attempts, and produces seeds via three strategies (top-unit-rating / companion-pair / cost-stratified). The engine boundary passes `lockedTraits` into `findTeams`; the post-filter in `engine.ts` is unchanged and still acts as a fail-safe.

**Tech Stack:** TypeScript worker (no framework), existing graph + buildOneTeam infrastructure, `npm run types:check` + `npm run lint:check` as the verification gates, `scout-cli` for end-to-end manual tests. No unit tests in V1 (consistent with the rest of the worker — see spec §Testing).

---

## File Structure

All changes live in two existing files:

- **`resources/js/workers/scout/engine.ts`** — modify `generate()` to pass `lockedTraits` into `findTeams` options (one new field).
- **`resources/js/workers/scout/synergy-graph.ts`** — modify `findTeams()` to accept + forward `lockedTraits` into the phase context, add the new phase function + its three seed-picking helpers + pool builder, register the phase as the first step in the pipeline.

No new files. Rationale: every existing phase (`phaseTemperatureSweep`, `phaseTraitSeeded`, `phaseCompanionSeeded`, …) lives inline in `synergy-graph.ts`; splitting one out now would break the pattern. If the phase grows a lot later, extracting to `phase-locked-trait-seeded.ts` is a trivial refactor.

**Verification model:** The worker has no unit tests, so each task ends with a `scout-cli` integration check + `types:check` + `lint:check`. Each task commits once it passes both gates.

---

## Task 1: Pass `lockedTraits` from engine into `findTeams`

**Files:**
- Modify: `resources/js/workers/scout/engine.ts` (the `findTeams` call site, around line 131–144)
- Modify: `resources/js/workers/scout/synergy-graph.ts::findTeams` options destructure + `context` object build

- [ ] **Step 1: Add `lockedTraits` to the `findTeams` call in `engine.ts`**

In `engine.ts`, locate the existing `findTeams(graph, {…})` call (search for `const rawTeams = findTeams`). Add `lockedTraits: traitLocks` to the options object, right after `seed`:

```typescript
  const rawTeams = findTeams(graph, {
    teamSize: effectiveTeamSize,
    startChamps: locked.map(c => c.apiName),
    maxResults: SEARCH_BUDGET * searchMultiplier,
    level,
    emblems: constraints.emblems || [],
    excludedTraits: constraints.excludedTraits || [],
    excludedChampions: constraints.excludedChampions || [],
    max5Cost: constraints.max5Cost ?? null,
    seed,
    lockedTraits: traitLocks,
  });
```

- [ ] **Step 2: Accept `lockedTraits` in `findTeams` and forward into `context`**

In `synergy-graph.ts`, locate `export function findTeams(graph, options = {})` (around line 1104). Add `lockedTraits = []` to the destructured options:

```javascript
  const {
    teamSize = 8, startChamps = [], maxResults = 20,
    level = null, emblems = [], excludedTraits = [], excludedChampions = [],
    max5Cost = null, lockedTraits = [],
  } = options;
```

Then in the `const context = { … }` block a few lines down (around line 1129), add `lockedTraits`:

```javascript
  const context = {
    emblems, excludedTraits, excludedChampions, level,
    max5Cost: effectiveMax5Cost,
    lockedChamps: startChamps,
    allowedSet,
    lockedSet,
    lockedTraits,
  };
```

- [ ] **Step 3: Verify types + lint**

```bash
npm run types:check
npm run lint:check
```

Expected: both exit 0, no output.

- [ ] **Step 4: Verify no regression on non-locked generate**

```bash
SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 npx tsx scripts/scout-cli.ts generate --top-n 5 --seed 42
```

Expected: rank-1 score `183.8`. This confirms forwarding `lockedTraits` as `[]` didn't perturb anything.

- [ ] **Step 5: Commit**

```bash
git add resources/js/workers/scout/engine.ts resources/js/workers/scout/synergy-graph.ts
git commit -m "$(cat <<'EOF'
refactor(scout): pass lockedTraits into findTeams context

Plumbing step for the upcoming phaseLockedTraitSeeded — the phase
needs access to the user's trait locks inside findTeams and the
existing code only consumed them as a post-filter in engine.ts.
Accept the array in findTeams options (default empty) and forward
it into the context object every phase receives. Behaviour is
unchanged: no existing phase reads the field yet.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Implement `buildLockedTraitPool` helper

**Files:**
- Modify: `resources/js/workers/scout/synergy-graph.ts` — add helper function alongside existing phases

- [ ] **Step 1: Add `buildLockedTraitPool` above `phaseTemperatureSweep`**

In `synergy-graph.ts`, locate `function phaseTemperatureSweep(…)` (around line 603). Immediately above it, add:

```javascript
// ── Locked-trait seeded phase ──────────────────────
//
// Activates only when the user requested trait locks. Produces seed
// combinations that actually satisfy every lock and feeds them to
// buildOneTeam so the lock constraint drives generation instead of
// being left to the post-filter. Runs first in the pipeline (see
// findTeams below) so lock-satisfying teams populate the result map
// before other phases consume their shared early-exit budget.

/**
 * Collect candidate champions for every locked trait. Returns a map
 * keyed by trait apiName or null when any lock is impossible given
 * the current pool (caller should bail without running any attempts).
 *
 * Hero variants and user-excluded champions are filtered out; the
 * allowed-set gate (level-based shop odds) is respected too.
 */
function buildLockedTraitPool(lockedTraits, graph, excludedSet, allowedSet) {
  const pool = new Map();

  for (const lock of lockedTraits) {
    const candidates = [];

    for (const [api, node] of Object.entries(graph.nodes)) {
      if (!node || node.variant === 'hero') {
        continue;
      }

      if (excludedSet.has(api)) {
        continue;
      }

      if (allowedSet && !allowedSet.has(api)) {
        continue;
      }

      if (!node.traits || !node.traits.includes(lock.apiName)) {
        continue;
      }

      candidates.push(api);
    }

    if (candidates.length < lock.minUnits) {
      return null;
    }

    pool.set(lock.apiName, candidates);
  }

  return pool;
}
```

- [ ] **Step 2: Verify types + lint**

```bash
npm run types:check
npm run lint:check
```

Expected: green (the helper is unused right now — no type errors).

- [ ] **Step 3: Commit**

```bash
git add resources/js/workers/scout/synergy-graph.ts
git commit -m "$(cat <<'EOF'
feat(scout): add buildLockedTraitPool helper

First building block for phaseLockedTraitSeeded. Collects the
per-trait candidate pool while respecting hero-variant filtering,
user excludes and the level-based allowedSet gate. Returns null
when any locked trait is impossible (pool size below minUnits) so
the caller can bail cleanly instead of generating attempts that
would never satisfy the constraint.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Implement `pickSeedsTopUnitRating` strategy

**Files:**
- Modify: `resources/js/workers/scout/synergy-graph.ts` — add strategy helper

- [ ] **Step 1: Add helper below `buildLockedTraitPool`**

Immediately after the `buildLockedTraitPool` function, add:

```javascript
/**
 * Deterministic seed strategy #1 — sort each trait's pool by the
 * MetaTFT unitRating score (higher is better) with an apiName
 * tie-breaker, then slice `minUnits` champs. The attemptIndex
 * rotates the slice window so attempt 0 takes the top minUnits,
 * attempt 1 shifts by 1, etc. With 20 attempts on a typical
 * pool of 6–10 champs this rotates through every realistic
 * top-K combination without explicit enumeration.
 */
function pickSeedsTopUnitRating(pool, lockedTraits, graph, unitRatings, attemptIndex) {
  const seeds = new Set();

  for (const lock of lockedTraits) {
    const candidates = pool.get(lock.apiName) ?? [];

    if (candidates.length === 0) {
      continue;
    }

    const sorted = [...candidates].sort((a, b) => {
      const ra = unitRatings?.[a]?.score ?? 0;
      const rb = unitRatings?.[b]?.score ?? 0;

      if (ra !== rb) {
        return rb - ra;
      }

      return a.localeCompare(b);
    });

    const windowStart = attemptIndex % Math.max(1, sorted.length - lock.minUnits + 1);

    for (let i = 0; i < lock.minUnits; i++) {
      const pick = sorted[(windowStart + i) % sorted.length];

      seeds.add(pick);
    }
  }

  return [...seeds];
}
```

- [ ] **Step 2: Verify types + lint**

```bash
npm run types:check
npm run lint:check
```

Expected: green.

- [ ] **Step 3: Commit**

```bash
git add resources/js/workers/scout/synergy-graph.ts
git commit -m "$(cat <<'EOF'
feat(scout): add top-unit-rating seed strategy for locked traits

First of three strategies feeding phaseLockedTraitSeeded. Sorts
each locked trait's pool by MetaTFT unitRating descending with an
apiName tie-breaker so the ordering is fully deterministic, then
slides a minUnits-wide window across the sorted list. Twenty
attempts with a window offset covers every realistic top-K slice
for typical TFT17 pool sizes without exploding into a full C(n,k)
enumeration.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Implement `pickSeedsCompanionPair` strategy

**Files:**
- Modify: `resources/js/workers/scout/synergy-graph.ts` — add strategy helper + shared pair-building helper

- [ ] **Step 1: Add helpers below `pickSeedsTopUnitRating`**

```javascript
/**
 * Enumerate companion-proven pairs from the locked-trait pool, sorted
 * by avgPlace ascending. A pair (A, B) qualifies when:
 *   - A is in some locked trait's pool,
 *   - B is in a (possibly different) locked trait's pool,
 *   - ctx.companions[baseOf(A)] contains an entry for baseOf(B),
 *   - that entry's avgPlace < 4.0 (top-half of placements).
 *
 * Returned once per findTeams call — computed lazily and cached by
 * the caller.
 */
function enumerateLockedTraitCompanionPairs(pool, lockedTraits, companions, graph) {
  if (!companions) {
    return [];
  }

  const unionPool = new Set();

  for (const lock of lockedTraits) {
    for (const api of pool.get(lock.apiName) ?? []) {
      unionPool.add(api);
    }
  }

  const baseOf = (api) => graph.nodes[api]?.baseApiName || api;
  const pairs = [];
  const seen = new Set();

  for (const a of unionPool) {
    const entries = companions[baseOf(a)];

    if (!entries) {
      continue;
    }

    for (const entry of entries) {
      const b = entry.companion;

      if (!unionPool.has(b) || a === b) {
        continue;
      }

      const key = [a, b].sort((x, y) => x.localeCompare(y)).join('+');

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);

      if (typeof entry.avgPlace === 'number' && entry.avgPlace < 4.0) {
        pairs.push({ a, b, avgPlace: entry.avgPlace });
      }
    }
  }

  pairs.sort((x, y) => x.avgPlace - y.avgPlace);

  return pairs;
}

/**
 * Deterministic seed strategy #2 — pick the N-th companion-proven pair
 * from the pre-sorted list, then fill each trait's minUnits requirement
 * by drawing from the unit-rating-sorted pool. Falls back to the
 * top-unit-rating strategy when no pairs exist (no MetaTFT companion
 * data for the pool or all avgPlaces ≥ 4.0).
 */
function pickSeedsCompanionPair(pool, lockedTraits, graph, unitRatings, pairs, attemptIndex) {
  if (pairs.length === 0) {
    return pickSeedsTopUnitRating(pool, lockedTraits, graph, unitRatings, attemptIndex);
  }

  const pair = pairs[attemptIndex % pairs.length];
  const seeds = new Set([pair.a, pair.b]);

  for (const lock of lockedTraits) {
    const members = (pool.get(lock.apiName) ?? []).filter(api => seeds.has(api));

    if (members.length >= lock.minUnits) {
      continue;
    }

    const sorted = [...(pool.get(lock.apiName) ?? [])]
      .filter(api => !seeds.has(api))
      .sort((a, b) => {
        const ra = unitRatings?.[a]?.score ?? 0;
        const rb = unitRatings?.[b]?.score ?? 0;

        if (ra !== rb) {
          return rb - ra;
        }

        return a.localeCompare(b);
      });

    const needed = lock.minUnits - members.length;

    for (let i = 0; i < needed && i < sorted.length; i++) {
      seeds.add(sorted[i]);
    }
  }

  return [...seeds];
}
```

- [ ] **Step 2: Verify types + lint**

```bash
npm run types:check
npm run lint:check
```

Expected: green.

- [ ] **Step 3: Commit**

```bash
git add resources/js/workers/scout/synergy-graph.ts
git commit -m "$(cat <<'EOF'
feat(scout): add companion-pair seed strategy for locked traits

Second of three strategies for phaseLockedTraitSeeded. Enumerates
champion pairs drawn from the union of every locked trait's pool
where MetaTFT companion data places them below avgPlace 4.0, sorts
by avgPlace ascending, and returns them one-per-attempt with the
rest of each trait's minUnits filled by unit-rating picks. Falls
back to the top-unit-rating strategy when no proven pairs exist in
the pool so the phase still produces seeds when MetaTFT data is
sparse.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Implement `pickSeedsCostStratified` strategy

**Files:**
- Modify: `resources/js/workers/scout/synergy-graph.ts` — add strategy helper

- [ ] **Step 1: Add helper below `pickSeedsCompanionPair`**

```javascript
/**
 * Deterministic seed strategy #3 — for each locked trait, pick
 * minUnits champions with a deliberate cost spread instead of clustering
 * on the cheapest ones. For pools with enough variety we take the
 * cheapest, the most expensive, and fill the middle from the
 * unit-rating-sorted remainder. For small minUnits (<3) we just take
 * cheapest + most expensive so the strategy degrades gracefully.
 *
 * Uses the shared RNG so the cost buckets are shuffled deterministically
 * per attempt — without it every attempt would pick the same stratified
 * seed and we'd lose the diversity we're paying for.
 */
function pickSeedsCostStratified(pool, lockedTraits, graph, unitRatings, rng) {
  const seeds = new Set();

  for (const lock of lockedTraits) {
    const candidates = pool.get(lock.apiName) ?? [];

    if (candidates.length === 0) {
      continue;
    }

    const byCost = [...candidates].sort((a, b) => {
      const ca = graph.nodes[a]?.cost ?? 0;
      const cb = graph.nodes[b]?.cost ?? 0;

      if (ca !== cb) {
        return ca - cb;
      }

      return a.localeCompare(b);
    });

    const picks = new Set();
    const minUnits = lock.minUnits;

    picks.add(byCost[0]);

    if (minUnits >= 2) {
      picks.add(byCost[byCost.length - 1]);
    }

    if (minUnits >= 3) {
      const mid = Math.floor(byCost.length / 2);
      picks.add(byCost[mid]);
    }

    // Fill remaining slots from a shuffled copy so later attempts
    // explore different fillers around the anchored endpoints.
    const remaining = byCost.filter(api => !picks.has(api));

    for (let i = remaining.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = remaining[i];

      remaining[i] = remaining[j];
      remaining[j] = tmp;
    }

    let idx = 0;

    while (picks.size < minUnits && idx < remaining.length) {
      picks.add(remaining[idx]);
      idx++;
    }

    for (const api of picks) {
      seeds.add(api);
    }
  }

  return [...seeds];
}
```

- [ ] **Step 2: Verify types + lint**

```bash
npm run types:check
npm run lint:check
```

Expected: green.

- [ ] **Step 3: Commit**

```bash
git add resources/js/workers/scout/synergy-graph.ts
git commit -m "$(cat <<'EOF'
feat(scout): add cost-stratified seed strategy for locked traits

Third of three strategies for phaseLockedTraitSeeded. Anchors each
trait's seed set on the cheapest and most expensive pool members
(and the median for minUnits >= 3), then fills the rest from a
seeded-shuffle of the remainder. Degrades cleanly when minUnits is
small and uses the shared RNG so each attempt explores different
fillers around the anchored endpoints — stops every attempt from
clustering on the same cost profile.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Implement `phaseLockedTraitSeeded` orchestrator

**Files:**
- Modify: `resources/js/workers/scout/synergy-graph.ts` — add phase entry point below the strategy helpers

- [ ] **Step 1: Add the phase function below `pickSeedsCostStratified`**

```javascript
/**
 * Phase entry point. Pulls lockedTraits from the shared context and
 * runs three batches of attempts:
 *   - 20 × top-unit-rating   (proven individual strength)
 *   - 20 × companion-pair    (MetaTFT "plays together" data)
 *   - 10 × cost-stratified   (diversity guard)
 *
 * Each attempt passes its seeds to buildOneTeam and writes any
 * successful team into the shared result map via addResult. Bounded
 * by a dedicated cap of 50 attempts regardless of maxResults so the
 * runtime contribution of this phase stays predictable (~250 ms at
 * ~5 ms per buildOneTeam) and does not eat into the budget for the
 * other phases that run afterwards.
 *
 * Uses the same buildOneTeam signature as every other phase — see
 * phaseTemperatureSweep for the canonical pattern.
 */
function phaseLockedTraitSeeded({ graph, teamSize, context, rng, addResult, excludedSet }) {
  const lockedTraits = context.lockedTraits ?? [];

  if (lockedTraits.length === 0) {
    return;
  }

  const pool = buildLockedTraitPool(lockedTraits, graph, excludedSet, context.allowedSet);

  if (pool === null) {
    return;
  }

  const unitRatings = graph.scoringCtx?.unitRatings ?? {};
  const companions = graph.scoringCtx?.companions ?? null;
  const pairs = enumerateLockedTraitCompanionPairs(pool, lockedTraits, companions, graph);

  const attempt = (seeds) => {
    if (seeds.length === 0) {
      return;
    }

    addResult(buildOneTeam(graph, teamSize, seeds, context, 0.1 + rng() * 0.2, rng));
  };

  for (let i = 0; i < 20; i++) {
    attempt(pickSeedsTopUnitRating(pool, lockedTraits, graph, unitRatings, i));
  }

  for (let i = 0; i < 20; i++) {
    attempt(pickSeedsCompanionPair(pool, lockedTraits, graph, unitRatings, pairs, i));
  }

  for (let i = 0; i < 10; i++) {
    attempt(pickSeedsCostStratified(pool, lockedTraits, graph, unitRatings, rng));
  }
}
```

- [ ] **Step 2: Make `scoringCtx` reachable from `graph`**

The helpers above read `graph.scoringCtx?.unitRatings` and `graph.scoringCtx?.companions`. Verify the graph already exposes this. In `synergy-graph.ts`, locate `export function buildGraph(champions, traits, scoringCtx = {}, exclusionLookup = {})` and its return statement. If the return does not include `scoringCtx`, add it:

```javascript
  return { nodes, traitBreakpoints, traitMap, exclusionLookup, scoringCtx };
```

(If the field is already there, leave the file untouched.)

- [ ] **Step 3: Verify types + lint**

```bash
npm run types:check
npm run lint:check
```

Expected: green. `phaseLockedTraitSeeded` is still unused but typechecks.

- [ ] **Step 4: Commit**

```bash
git add resources/js/workers/scout/synergy-graph.ts
git commit -m "$(cat <<'EOF'
feat(scout): add phaseLockedTraitSeeded orchestrator

Wires up the three seed strategies behind a single phase entry
point. 50-attempt dedicated cap (20 top-unit-rating + 20
companion-pair + 10 cost-stratified), early-returns when no trait
locks are active, aborts when any lock is impossible. Exposes
scoringCtx on the buildGraph return so the phase can read
unitRatings and companions without threading extra parameters.

Not yet wired into the findTeams pipeline — that's the next task.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Register the phase in the `findTeams` pipeline

**Files:**
- Modify: `resources/js/workers/scout/synergy-graph.ts::findTeams` — the phase invocation block

- [ ] **Step 1: Add the call at the top of the phase sequence**

Locate the phase invocation block in `findTeams` (around line 1201–1209 — the sequence that starts with `phaseTemperatureSweep(phaseCtx)`). Add `phaseLockedTraitSeeded(phaseCtx);` as the first line:

```javascript
  phaseLockedTraitSeeded(phaseCtx);
  phaseTemperatureSweep(phaseCtx);
  phaseTraitSeeded(phaseCtx);
  phaseDeepVertical(phaseCtx);
  phasePairSynergy(phaseCtx);
  phaseCompanionSeeded(phaseCtx);
  phaseMetaCompSeeded(phaseCtx);
  phaseFiveCostHeavy(phaseCtx);
  phaseCrossover(phaseCtx);
  phaseHillClimb(phaseCtx);
```

- [ ] **Step 2: Verify types + lint**

```bash
npm run types:check
npm run lint:check
```

Expected: green.

- [ ] **Step 3: Verify non-locked generate still deterministic**

```bash
for n in 5 20 50; do
  SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 \
    npx tsx scripts/scout-cli.ts generate --top-n $n --seed 42 2>/dev/null \
    | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log("n='$n' rank1:",j.results[0].score);'
done
```

Expected output exactly:
```
n=5 rank1: 183.8
n=20 rank1: 183.8
n=50 rank1: 183.8
```

If rank-1 shifted, the phase is running when it shouldn't — revisit the early-return guard in task 6 step 1.

- [ ] **Step 4: Verify the loose-case scenario (the original bug)**

```bash
SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 \
  npx tsx scripts/scout-cli.ts generate --top-n 30 --level 10 \
  --locked-trait TFT17_DarkStar:4 --seed 0 2>&1 \
  | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log("afterValidComps:",j.filtered.afterValidComps); console.log("unique ranks:",j.results.length);'
```

Expected: `afterValidComps` at least 20 (ideally 30), `unique ranks` at 30. Before this task the same command returned only a handful of results.

- [ ] **Step 5: Verify the tight-case regression (commit c686156 interaction)**

```bash
SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 \
  npx tsx scripts/scout-cli.ts generate --top-n 30 --level 10 \
  --locked-trait TFT17_ShieldTank:6 --seed 0 2>&1 \
  | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log("afterValidComps:",j.filtered.afterValidComps);'
```

Expected: `afterValidComps: 30`. Tight auto-promote and the new phase cooperate without stepping on each other.

- [ ] **Step 6: Verify multi-lock**

```bash
SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 \
  npx tsx scripts/scout-cli.ts generate --top-n 20 --level 10 \
  --locked-trait TFT17_DarkStar:4 --locked-trait TFT17_PsyOps:3 --seed 0 2>&1 \
  | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log("afterValidComps:",j.filtered.afterValidComps);'
```

Expected: `afterValidComps >= 10`. If 0 results, the union-pool / smart_pick interaction needs debugging — re-run with `--top-n 5` and print `j.filtered` to see where teams drop out.

- [ ] **Step 7: Verify impossible lock returns clean empty**

```bash
SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 \
  npx tsx scripts/scout-cli.ts generate --top-n 30 --level 10 \
  --locked-trait TFT17_DarkStar:9 --seed 0 2>&1 \
  | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log("afterValidComps:",j.filtered.afterValidComps); console.log("results length:",j.results.length);'
```

Expected: `afterValidComps: 0`, `results length: 0`, no error thrown.

- [ ] **Step 8: Measure performance delta**

```bash
time (SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 \
  npx tsx scripts/scout-cli.ts generate --top-n 30 --level 10 \
  --locked-trait TFT17_DarkStar:4 --seed 0 > /dev/null)
time (SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 \
  npx tsx scripts/scout-cli.ts generate --top-n 30 --level 10 --seed 0 > /dev/null)
```

Expected: the locked run takes no more than ~300 ms longer than the non-locked run (phase cap × ~5 ms buildOneTeam). tsx startup dominates both (~3 s), so the real compute delta is the interesting number — if it looks larger than 300 ms, the attempt cap isn't being honoured.

- [ ] **Step 9: Commit**

```bash
git add resources/js/workers/scout/synergy-graph.ts
git commit -m "$(cat <<'EOF'
feat(scout): wire phaseLockedTraitSeeded into findTeams pipeline

Runs the new phase first, before every other phase, whenever
lockedTraits is non-empty. Validated end-to-end with scout-cli:
DarkStar:4 at level 10 now returns the full topN of unique comps
(was producing only a handful), ShieldTank:6 tight-case still
delivers 30/30, multi-lock DarkStar:4 + PsyOps:3 reaches 10+ valid
comps, DarkStar:9 cleanly returns zero, and non-locked generate at
seed 42 stays at 183.8 across topN 5/20/50.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Confirm session-wide regression status

Final sanity sweep across every scenario the whole session has been protecting.

- [ ] **Step 1: Hero swap still works**

```bash
for hero in Aatrox_hero Nasus_hero Gragas_hero; do
  SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 \
    npx tsx scripts/scout-cli.ts generate --top-n 1 --locked TFT17_$hero --seed 42 2>/dev/null \
    | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8')); const r=j.results[0]; console.log('$hero','score='+r.score,'hero-in-team='+r.champions.includes('TFT17_$hero'));"
done
```

Expected: all three `hero-in-team=true`.

- [ ] **Step 2: Filler metric still present and zero on clean top-1**

```bash
SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 \
  npx tsx scripts/scout-cli.ts generate --top-n 1 --seed 42 2>/dev/null \
  | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log("filler:",j.results[0].breakdown.filler);'
```

Expected: `filler: 0`.

- [ ] **Step 3: Final types + lint sweep**

```bash
npm run types:check
npm run lint:check
```

Expected: both green.

- [ ] **Step 4: No commit needed — this task is verification only**

If every step passed, the feature is ready for manual browser testing and an optional scout-lab batch 5 run (out of scope for this plan).
