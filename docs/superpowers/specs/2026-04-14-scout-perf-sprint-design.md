# Scout algorithm performance sprint — design

## Problem

Generating a single batch of team comps takes too long end-to-end
(non-lock generate runs ~4 s wall-clock, locked runs push past 15 s
on heavy scenarios). The pain is broad — no single "slow case" —
so targeted fixes guessed from prior sessions may miss the actual
hot spots. The user is also asking for a code audit alongside the
perf work: `synergy-graph.ts` has grown past 1,600 lines with ten
phases inline, and previous reviews flagged duplicated sort/emblem
logic that never got cleaned up.

## Goal

Cut real generate compute (excluding tsx cold-start) to a target
of **rank-1 ≤ 800 ms / topN=10 ≤ 2,000 ms** across the three
benchmark scenarios defined below, without regressing any of the
session's existing fixes (hero swap, filler metric, tight/loose
locks, emblem handling). Stretch targets push further where the
data allows. Cleanup of duplicated helpers and modular split of
`synergy-graph.ts` is included when the audit surfaces concrete
opportunities.

## Non-goals

- Rewriting the scorer in Rust/WASM.
- Switching to a service-side generator (keeping worker-side pure).
- Redesigning the phases themselves (only their wiring, counts and
  shared helpers).
- Adding a Web Workers pool. Parallelism is a Phase E candidate
  (own spec, own session) if the sequential fixes cannot hit the
  target.

## Success criteria

| scenario | target rank-1 | target topN=10 | stretch |
|---|---|---|---|
| no-lock lvl 8 | ≤ 600 ms | ≤ 1,500 ms | ≤ 400 ms / ≤ 1,000 ms |
| tight lock (ShieldTank:6, lvl 10) | ≤ 800 ms | ≤ 2,000 ms | ≤ 500 ms / ≤ 1,200 ms |
| loose lock + emblem (RangedTrait:4 + emblem :1, lvl 10) | ≤ 1,000 ms | ≤ 2,500 ms | ≤ 600 ms / ≤ 1,500 ms |

Cold-start tsx startup (~3 s) is excluded from the measurement —
we time from the start of `engine.generate` to its return.

Regression set (all must still pass):

- Non-lock seed 42: rank-1 == 183.8 across topN 5 / 20 / 50
- `--locked TFT17_Aatrox_hero --seed 42`: hero present in top team
- `breakdown.filler` present and zero on clean top-1
- Tight `ShieldTank:6` alone: 30/30 valid
- Loose `DarkStar:4`: at least 14 valid
- Multi-lock `ShieldTank:6 + RangedTrait:4 + emblem :1`: at least
  15 valid with varied flex carriers
- `types:check` and `lint:check` green after every implementation
  commit

## Approach — profile first, decisions later

The sprint runs in four phases:

### Phase A — Discovery

Add lightweight, opt-in profiling and a code audit scanner, then
run them against three benchmark scenarios and commit the resulting
reports. No runtime behaviour changes during this phase — the
profiler is gated by an env flag and a window global, and the audit
scanner is a standalone script.

**Profiler (`resources/js/workers/scout/scout-profiler.ts`):**

```ts
type Span = { name: string; durationMs: number; count: number };

const spans: Map<string, Span> = new Map();
const enabled =
    (typeof process !== 'undefined' && process.env?.SCOUT_PROFILE === '1') ||
    (typeof globalThis !== 'undefined' && (globalThis as any).__SCOUT_PROFILE__ === true);

export function startSpan(name: string): () => void {
    if (!enabled) return () => {};

    const t0 = performance.now();

    return () => {
        const dur = performance.now() - t0;
        const existing = spans.get(name);

        if (existing) {
            existing.durationMs += dur;
            existing.count += 1;
        } else {
            spans.set(name, { name, durationMs: dur, count: 1 });
        }
    };
}

export function resetProfiler(): void { spans.clear(); }
export function dumpProfile(): Span[] {
    return [...spans.values()].sort((a, b) => b.durationMs - a.durationMs);
}
```

When the flag is off, `startSpan` returns a no-op closure —
zero overhead on production path.

**Instrumentation points** (each wrapped `const end = startSpan(…); try { … } finally { end(); }`):

| Span | Where | Why |
|---|---|---|
| `engine.generate.total` | `engine.ts` whole function | upper bound |
| `engine.filterCandidates` | around `filterCandidates` | pre-filter cost |
| `engine.tightAutoPromote` | around tight auto-promote loop | small but visible |
| `engine.buildGraph` | around `buildGraph` | graph construction |
| `engine.findTeams` | around `findTeams` | main solver |
| `engine.enrichLoop` | `rawTeams.map(…)` | per-team |
| `engine.enrichLoop.buildActiveTraits` | inside lambda | aggregated |
| `engine.enrichLoop.teamScore` | inside lambda | aggregated |
| `engine.enrichLoop.teamScoreBreakdown` | inside lambda | aggregated |
| `engine.validCompsFilter` | around `enriched.filter` | |
| `engine.metaCompMatch` | around meta-comp block | |
| `engine.insightsLoop` | around insights generation | |
| `findTeams.phase.<name>` | each of 10 phases | per-phase breakdown |
| `findTeams.diversify` | around `diversifyResults` | |

**Scout-cli subcommand (`scout-cli profile`):**

- Runs three benchmark scenarios with `SCOUT_PROFILE=1` and
  `--seed 0`:
  1. No-lock, lvl 8, topN=10
  2. Tight lock ShieldTank:6, lvl 10, topN=30
  3. Loose lock + emblem RangedTrait:4 + emblem :1, lvl 10, topN=30
- Calls `resetProfiler()` between scenarios
- Collects `dumpProfile()` after each
- Writes a Markdown report to `docs/superpowers/research/scout-perf-<YYYY-MM-DD>.md`
  with one sorted table per scenario

**Code audit scanner (`scripts/scout-audit/duplication.ts`):**

- Walks every `.ts` file under `resources/js/workers/scout/`
- Tokenises each file (split on whitespace + normalise identifiers
  to `_` placeholders so literal names don't dominate the hash)
- Hashes sliding 8-line blocks
- Reports hash collisions with file:line coordinates and a
  suggested shared helper name

**Modularity and dead-code scan** is a manual pass against
`synergy-graph.ts` looking for:

- Top-level function count vs file length
- Shared-state usage between phases
- Phases self-contained enough to extract into a dedicated file
  (≥ 50 lines, uses only public helpers, doesn't touch internals
  of other phases)
- Branches for impossible cases (`if (x === null)` when the caller
  already guaranteed non-null)
- Repeated work in hot paths (`Object.entries(graph.nodes)`
  recomputed by multiple helpers)

**Output of Phase A:**

- `docs/superpowers/research/scout-perf-<date>.md` — timing tables
  per scenario, top 10 spans by `durationMs`
- `docs/superpowers/research/scout-code-audit-<date>.md` — three
  sections: `Duplicated code blocks`, `File structure recommendations`,
  `Dead code / simplifications`
- Single commit: `docs(research): scout perf + code audit baseline`

### Phase B — Design fixes

Review both reports and map findings onto concrete fixes from the
categories below, then update this spec inline with the chosen
fix list before touching any implementation code. User reviews the
updated spec before Phase C begins.

**Fix categories and candidate actions:**

1. **Reduce attempts / prune search space**
   - Lower per-phase attempt multipliers (`maxResults * N` factors)
     where the profiler shows a phase running 1,000+ iterations to
     contribute a handful of surviving comps
   - Lower `SEARCH_BUDGET` (currently 40) if diverse cap is hit
     well before the budget runs out
   - Early-return whole generic phases (temperatureSweep,
     traitSeeded, pairSynergy, …) when `lockedTraits` is non-empty
     and `phaseLockedTraitSeeded` already covers the space
   - Tighten `diversifyResults` cap when most result-map entries
     are dropped anyway
2. **Cache / memoize**
   - Params-hash cache in the React hook layer
     (`use-scout-worker.ts`): identical `paramsKey` reuses prior
     worker output without re-invocation. Cache key includes
     context `syncedAt` so a new MetaTFT sync busts the cache.
   - `buildGraph` cache keyed on champion+trait apiName fingerprint
     if the profiler shows graph construction as a hot spot
   - `quickScore` memoisation by sorted-team-key if phases produce
     many duplicate mid-search teams
   - `buildActiveTraits` memoisation by sorted-team-key +
     emblems-key
3. **Algorithm substitution**
   - Replace `[...arr].sort()` with a partial heap sort when the
     caller only needs top-K
   - Replace `filter(…).includes(x)` with precomputed `Set` lookup
     in hot loops
   - Precompute `graph.nodes[api]?.cost`, `graph.nodes[api]?.traits`,
     etc., into flat arrays indexed by champion ordinal instead of
     re-fetching via `?.` chains inside tight loops
   - Replace `Object.entries/values/keys` in hot paths with
     iteration over precomputed arrays
4. **Structural refactoring** (tail end of the sprint)
   - Extract audit-flagged duplicated helpers
     (e.g. `sortByUnitRating`, a shared emblem-count helper) into
     a new `resources/js/workers/scout/shared-helpers.ts`
   - Split `synergy-graph.ts` into a `synergy-graph/` directory
     with one file per phase (only for phases the audit confirms
     are self-contained), re-exporting through an index file
   - Break `engine.ts::generate` into focused sub-functions if the
     profiler shows its inline sections as independently slow
5. **Parallelism (out of scope unless needed)**
   - Web Workers pool, `SharedArrayBuffer`, `requestIdleCallback`
     for insights — tracked as Phase E in follow-ups

**Prioritisation rubric** (applied in Phase B):

Each candidate fix is scored on three axes:
- **Expected impact** — % reduction of total generate time, read
  straight off the profile tables
- **Risk** — chance of regressing any of the success-criteria
  regression tests (low / medium / high)
- **Effort** — rough hours-of-work estimate

Ordering in Phase C is high-impact × low-risk × low-effort first.
Structural refactoring comes last because it touches diff layout
and is easier to review in isolation. Parallelism only enters
scope if the sum of sequential fixes falls short of the 800 ms /
2,000 ms target.

### Phase C — Implementation

Work through the Phase B fix list in priority order. One fix per
commit. After each fix:

- Re-run `scout-cli profile` on all three scenarios
- Compare the targeted span's `durationMs` to the Phase A baseline
- Commit if the gain is confirmed and no regression-set check
  fails, revert if either check fails
- `types:check` and `lint:check` must stay green

Code split refactorings happen last, each as its own commit for
clean review. When a file is split, the commit touches only the
move + re-export wiring — no behaviour change in the same commit.

### Phase D — Verification sweep

- Final `scout-cli profile` run on all three scenarios
- Before/after comparison table included in the final commit
  message
- Full regression-set run as documented in Success Criteria
- Update memory note with achieved numbers so future sessions
  know the current baseline

## Architecture

The sprint introduces three new code artefacts and a standalone
script:

```
resources/js/workers/scout/
  scout-profiler.ts            # new — env-gated span collector
  engine.ts                    # modified — startSpan wrappers
  synergy-graph.ts             # modified — startSpan wrappers
  shared-helpers.ts            # new (Phase C, audit-driven)
  synergy-graph/               # new directory (Phase C, optional)
    index.ts                   # re-exports public API
    phase-*.ts                 # one file per self-contained phase

scripts/
  scout-cli/
    commands/profile.ts        # new — runs benchmark scenarios
  scout-audit/
    duplication.ts             # new — code audit scanner

docs/superpowers/research/
  scout-perf-<date>.md         # generated
  scout-code-audit-<date>.md   # generated
```

The profiler is a **leaf module** — it depends on nothing else in
`resources/js/workers/scout/`, which lets us wire it into every
phase without import cycles.

`shared-helpers.ts` and the `synergy-graph/` directory only exist
if the audit surfaces concrete opportunities; their creation is
deferred until Phase C and the targeted audit findings are in hand.

## Data flow (timing)

```
scout-cli profile → resetProfiler
  → engine.generate (instrumented)
    → filterCandidates            span engine.filterCandidates
    → tight auto-promote          span engine.tightAutoPromote
    → buildGraph                  span engine.buildGraph
    → findTeams                   span engine.findTeams
      → phaseLockedTraitSeeded    span findTeams.phase.lockedTraitSeeded
      → phaseTemperatureSweep     span findTeams.phase.temperatureSweep
      → … (other phases)          span findTeams.phase.<name>
      → diversifyResults          span findTeams.diversify
    → enriched map                span engine.enrichLoop
      → buildActiveTraits         span engine.enrichLoop.buildActiveTraits
      → teamScore                 span engine.enrichLoop.teamScore
      → teamScoreBreakdown        span engine.enrichLoop.teamScoreBreakdown
    → enriched.filter             span engine.validCompsFilter
    → meta-comp match             span engine.metaCompMatch
    → insights                    span engine.insightsLoop
  → dumpProfile → write markdown report
```

Each scenario dumps its profile independently, so comparisons
across the three benchmark configurations are apples-to-apples.

## Edge cases

| Case | Handling |
|---|---|
| Profiler flag off | `startSpan` returns a cached no-op closure; zero allocation hot path. |
| Profiler flag on in a browser session by accident | Span data accumulates in memory but is never written anywhere; small GC pressure, visible in memory snapshots but not in UX. Cleared on page reload. |
| Benchmark scenario fails mid-run (e.g. network fetch for context fails) | `scout-cli profile` aborts that scenario with a clear error and moves to the next; the report marks the failed scenario as `n/a`. |
| Cache layer (if added) returns stale results after a MetaTFT sync | Cache key includes `syncedAt` timestamp from the context snapshot; a new sync produces a new cache key automatically. |
| Code split breaks an import cycle | Phase C keeps the split in its own commit; if the split fails types:check, the commit is reverted and the phase stays inline. |
| Profile numbers swing run-to-run because of V8 JIT warmup | The `scout-cli profile` command runs each scenario twice and reports the second run — first run warms up JIT. Both numbers are in the report for transparency. |
| Audit scanner false-positives on boilerplate | Manual review filters them before writing the audit report; the scanner output is raw input, not the final document. |

## Testing

**Automated checks** after every implementation commit in Phase C:

- `npm run types:check`
- `npm run lint:check`
- `scout-cli generate --top-n 5 --seed 42` → rank-1 score must be
  exactly 183.8
- `scout-cli generate --top-n 1 --locked TFT17_Aatrox_hero --seed 42`
  → hero in top team
- `scout-cli generate --top-n 30 --level 10 --locked-trait TFT17_ShieldTank:6 --seed 0`
  → 30 valid
- `scout-cli generate --top-n 30 --level 10 --locked-trait TFT17_DarkStar:4 --seed 0`
  → at least 14 valid
- `scout-cli generate --top-n 30 --level 10 --locked-trait TFT17_ShieldTank:6 --locked-trait TFT17_RangedTrait:4 --emblem TFT17_RangedTrait:1 --seed 0`
  → at least 15 valid

**Profile re-run** after every meaningful fix (not every single
line commit):

- `scout-cli profile` → compare against Phase A baseline
- Targeted span's `durationMs` must have improved for the fix to
  ship

No automated unit tests for the profiler itself — it is
observational instrumentation, and the integration checks above
cover its correctness implicitly.

## Phase B — Concrete fix list

Filled in after Phase A discovery. The two reports
(`docs/superpowers/research/scout-perf-2026-04-14.md` and
`scout-code-audit-2026-04-14.md`) identified two dominant hot spots
and four secondary cleanup opportunities. This section ranks the
fixes by impact × risk × effort and sequences them for Phase C.

### Headline data recap

| scenario | measured | target B (topN) | gap |
| --- | ---: | ---: | ---: |
| No-lock lvl 8 topN=10 | 2 767 ms | 1 500 ms | +1 267 |
| Tight lock ShieldTank:6 lvl 10 topN=30 | 17 677 ms | 2 000 ms | **+15 677** |
| Loose lock+emblem lvl 10 topN=30 | 17 865 ms | 2 500 ms | **+15 365** |

| span | total ms (3 scenarios) | notes |
| --- | ---: | --- |
| `synergy.phase.companionSeeded` | **23 971** | >65% of locked runtime |
| `synergy.phase.temperatureSweep` | **12 037** | second biggest |
| `synergy.phase.traitSeeded` + `deepVertical` | 1 487 | order of magnitude smaller |
| `engine.enrichLoop` (+ sub-spans) | <100 | NOT a bottleneck — full scorer is fine |
| `engine.buildGraph` | 9 ms total | trivial |

### Fix 1 — `phaseCompanionSeeded` redesign (PRIMARY, biggest win)

The current phase iterates every champion in `companionData` (~64
entries) and for each qualifying companion (~20 per champion, filtered
by `companionMaxAvg` and `companionMinGames`) calls `buildOneTeam` with
seeds `[...startChamps, comp.companion]`. That's up to ~1 280
`buildOneTeam` calls per generate, with no inner cap and an outer
early-exit at `results.size >= maxResults * 4` (= 1 440 on locked runs)
that essentially never fires. The phase also ignores
`context.lockedTraits`, so on locked runs it spends its entire budget
generating teams that the engine-side filter will mostly throw away.

**The core observation (user's intuition)**: MetaTFT already gave us
empirical pairwise `avgPlace` numbers. We are currently using those
numbers only to SEED extra work — one `buildOneTeam` per companion
hit — instead of using them to RANK pre-built candidates or to steer
the team builder directly.

**Five candidate redesigns:**

- **A — Dedup + global top-K seeds** (cheapest change)
  Aggregate a single flat list of all `(a, b, avgPlace)` pair records
  across every champion's companion list, dedupe by sorted `{a, b}`
  key, sort ascending by `avgPlace`, take the top 40, and call
  `buildOneTeam` once per surviving pair with seeds
  `[...startChamps, a, b]`. Attempt count drops from ~1 280 to 40 —
  expected **~25-30× reduction** in phase wall time. Uses the richer
  pair seed (2 champs, not 1) so each seed is empirically proven
  rather than "random companion of random champion".

  **Impact**: very high (removes the primary hot spot). **Risk**: low
  — shape of seeds change but `buildOneTeam` handles multi-seed
  already, and we're adding deterministic ordering that only helps
  reproducibility. **Effort**: ~45 min.

- **B — Greedy companion-driven team builder** (most ambitious)
  Skip `buildOneTeam` entirely for this phase. Build one (or a few)
  teams by greedy pairwise average: start with the strongest
  `startChamps` core, then repeatedly add the champion that most
  improves the team's average pairwise `avgPlace`, until `teamSize`.
  Zero `buildOneTeam` calls from this phase — compute is
  `O(teamSize × |candidates|)` lookups.

  **Impact**: very high (could drop phase to sub-50 ms). **Risk**:
  medium-high — it's a whole new team builder. Greedy is local-optimal
  and may produce a monotonous comp. **Effort**: ~3 h. Interacts with
  `context.allowedSet`, emblem handling, exclusion groups; easy to
  get wrong.

- **C — Bake companions into the graph edges** (architectural)
  At `buildGraph` time, add a companion-bonus weight to edges between
  champs where MetaTFT has a strong pairing. The existing generic
  phases (`temperatureSweep`, `traitSeeded`, `pairSynergy`) that
  already walk the graph naturally prefer those edges. Delete
  `phaseCompanionSeeded` entirely.

  **Impact**: high — removes the phase + lets other phases amortise
  their graph traversal cost. **Risk**: medium — changes the graph's
  semantics and will shift non-lock scoring output (different teams
  may win rank-1). **Effort**: ~4 h plus regression validation.

- **D — Skip phase when locked traits are present** (trivial, partial)
  Wrap the phase body in `if (context.lockedTraits.length > 0) return;`.
  Cheap but wrong: locked runs still want filler champions that
  synergise with the already-mandated core, not just "whatever the
  lock phase left behind". Rejected — keeping the entry for posterity.

- **E — Stepped cross-referenced filler with cost weighting** (RECOMMENDED)
  The core idea, surfaced by the user: stop seeding random
  companions. Instead use companion data to RANK filler candidates
  against the champions already in the team, weighted by how much
  each team member "cares" about its companions (high-cost champs
  care a lot, low-cost champs are fungible). Algorithm:

  ```
  anchors = context.lockedChamps          // from explicit locks +
                                          // tight auto-promote +
                                          // hero swap
  if anchors.length == 0:
    anchors = top-K champs by unitRating  // bootstrap for non-lock path

  costWeight(c) = [0.2, 0.4, 0.7, 0.9, 1.0][c.cost - 1]

  candidateScore = new Map()
  for each anchor A in anchors:
    top_comps = companionData[baseOf(A)]
                .filter(games >= minGames, avgPlace < maxAvg)
                .sort asc by avgPlace
                .take top K (e.g. K=10)
    for each (comp, avgPlace) in top_comps:
      if comp in anchors: continue       // already in team
      if !allowedSet.has(comp): continue // level gate
      candidateScore[comp] += costWeight(A) * (1 - avgPlace / 8)

  fillerPicks = sort candidateScore desc, take top M (e.g. M=30)

  for filler in fillerPicks:
    seeds = [...anchors, filler]
    addResult(buildOneTeam(graph, teamSize, seeds, ...))
  ```

  Key properties:
  - **Context-aware**: same user lock set produces the same top
    fillers (deterministic).
  - **Data-driven**: a champion that is a top companion for MULTIPLE
    anchors accumulates score from all of them — natural
    cross-referencing of the companion lists.
  - **Cost-weighted**: a 4-cost carry in the anchor set pulls its
    favourite companions up the ranking harder than a 1-cost
    frontliner does. Matches the intuition "build around the
    expensive units, fill around them".
  - **Scalable seed count**: M is a cap, not a function of pool
    size. ~30 `buildOneTeam` calls per generate regardless of
    whether the anchor set has 1 champion or 6.
  - **Covers locked case**: when `lockedChamps` is non-empty,
    stepped filler directly runs on those anchors — which is
    exactly what locked scenarios need (the fix D was trying to
    address the wrong way).
  - **Covers non-lock case**: bootstrap from top-unitRating champs
    gives a reasonable anchor set. Equivalent intent to current
    `phaseCompanionSeeded` but using ranking instead of seeding.

  **Impact**: locked runs drop companionSeeded from ~12 s → ~150 ms
  (30 calls × ~5 ms). Non-lock runs drop from ~333 ms → ~150 ms.
  Both scenarios benefit substantially, and the algorithm makes
  the phase USEFUL on locked runs instead of redundant.
  **Risk**: low-medium. The stepped algorithm is new but the
  operations are straightforward (map + sort + slice + loop). Main
  risk is the cost-weight constants being wrong on first try —
  easy to tune post-landing.
  **Effort**: ~1.5-2 h (build the filler ranker, wire it in,
  verify it produces diverse outputs, regression check).

**Recommendation**: **E**. Directly addresses the user insight
("use companion data to rank candidates, not to seed work"),
produces context-aware filler selection that is actually useful
on locked runs (unlike D), and trims the phase to a predictable
budget. A (global dedupe pairs) was a good first pass but E does
strictly more with the same data at similar cost. B (greedy
builder) and C (edge baking) remain deferred — E should be
enough. A is kept as mental fallback if E's ranking turns out to
produce monotonous seeds in practice (easy regression check via
scout-cli).

**Expected gain**: locked runs drop from ~17 s → ~5 s (eliminate
~12 s of companionSeeded). Non-lock from ~2.8 s → ~2.6 s (smaller
drop because current phase does less work on non-lock). We still
need Fix 2 to close the rest of the locked gap.

### Fix 2 — `phaseTemperatureSweep` attempt budget cut

Current: `const attempts = Math.max(maxResults * 3, 60);` — that's
1 080 iterations per locked run (`maxResults = 360`). Each iteration
runs one `buildOneTeam`. Early exit at `results.size >= maxResults * 2`
rarely fires because this phase runs right after
`phaseLockedTraitSeeded` populates only 15-50 entries; 720 before
the cap triggers.

**Two candidate fixes:**

- **A — Reduce multiplier + skip when locked**
  Drop `maxResults * 3` to `maxResults * 1` (= 360 attempts on locked,
  still plenty for diversity) AND return early when
  `context.lockedTraits.length > 0` — `phaseLockedTraitSeeded` already
  seeds the lock-satisfying space. Non-lock runs get 3× fewer
  iterations.

  **Impact**: locked runs save ~5 s (phase goes to zero), non-lock
  saves ~900 ms. **Risk**: low on locked (phase was dumping most of
  its work anyway), low-medium on non-lock (could slightly narrow
  top-K diversity). **Effort**: ~10 min.

- **B — Dynamic budget based on result growth rate**
  Track how many unique teams arrived per attempt in a rolling window;
  bail when the growth rate drops below a threshold. Self-tuning.

  **Impact**: similar to A but data-driven. **Risk**: medium — more
  logic, harder to test. **Effort**: ~1 h.

**Recommendation**: **A**. Simple, cheap, immediate, easy to tune if
the numbers drift. **Expected gain**: locked runs drop by ~5 s,
non-lock by ~900 ms.

### Fix 3 — Extract `findActiveBreakpointIdx` helper

The audit flagged three near-identical copies of a breakpoint-walk
loop in `scorer.ts` (lines ~240, ~420, ~522) plus a fourth variation
in the champion-score block (line ~120). Not a perf win — just a
cleanup to prevent future drift. Do this alongside Fix 1/2 if the
implementer is already in `scorer.ts`.

**Impact**: near-zero (scorer is already fast). **Risk**: tiny.
**Effort**: ~20 min. Ship if convenient, defer otherwise.

### Fix 4 — Extract `collectAffinityMatches` shared helper

`scorer.ts::affinityBonus` and `synergy-graph.ts::quickScore`'s
affinity branch are near-identical. Not a perf win, but both will
need the same fix next time we tune affinity weights.

**Impact**: near-zero. **Risk**: low-medium — any drift in the two
copies is now a bug. **Effort**: ~30 min. Defer unless Fix 1 touches
one of them.

### Fix 5 — `engine.ts::generate` constraint mutation cleanup

The emblem normalisation block at lines 57-75 mutates the caller's
`constraints.emblems`. Not a bug today (no caller memoises), but
surprising side-effect. Replace with a local `normalisedEmblems`
variable and thread it downstream. Audit item #7.

**Impact**: none today, prevents a future footgun. **Risk**: tiny.
**Effort**: ~15 min.

### Fix 6 — Phase files split (optional)

The audit recommends splitting `synergy-graph.ts` (1 677 lines, 10
phases inline) into a `synergy-graph/` directory. This is pure
maintainability — no runtime impact. Recommend deferring to the
VERY end of Phase C as its own commit, after every perf fix has
landed and been measured. If time pressure at that point, skip to
a future cleanup sprint. Memory note: `correctness_first` — defer
cleanup that isn't strictly required to hit the target.

### Priority ordering for Phase C

1. **Fix 1 E** (phaseCompanionSeeded → stepped cross-referenced filler
   with cost weighting — the user-proposed design)
2. **Fix 2 A** (temperatureSweep multiplier + skip-on-locked)
3. Re-run `scout-cli profile`, compare to baseline
4. **Fix 5** (constraint mutation cleanup — safe, trivial)
5. Evaluate: did we hit target B? If yes, stop. If no, consider Fix 3 + Fix 4 + a second pass at the profile
6. **Fix 6** (phase split) only if target hit AND time remains

Each fix lands in its own commit, with the profile re-run before
commit so the span numbers in the commit message show the delta.

### Estimated post-fix wall times

Targets vs expected actuals after Fix 1 + Fix 2:

| scenario | current | after Fix 1+2 (est) | target B |
| --- | ---: | ---: | ---: |
| No-lock lvl 8 topN=10 | 2 767 ms | ~1 500 ms | 1 500 ms |
| Tight lock lvl 10 topN=30 | 17 677 ms | ~2 000 ms | 2 000 ms |
| Loose lock+emblem lvl 10 topN=30 | 17 865 ms | ~2 500 ms | 2 500 ms |

If the estimates hold, we hit target B exactly on all three scenarios
with just Fix 1 + Fix 2 + a re-measurement. Stretch targets
(400-600 ms rank-1) would require Fix 1B (greedy builder) or Fix 1C
(graph edge baking), which are deferred.

## Out of scope / follow-ups

- Web Workers pool (Phase E, separate spec if needed)
- WASM / native module rewrite
- Server-side generation
- Progressive result streaming (partial results while phases run)
- Replacing the MetaTFT context source with something faster

These may land in future sprints depending on what the sequential
fixes achieve.
