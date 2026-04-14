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

**Hard invariant (new as of Phase B refinement):**

The algorithm must return **exactly `topN` results** for every
generate call, unless the user's constraints make fewer teams
mathematically impossible (e.g. `DarkStar:9` with a 7-champion
pool). "Fewer results than requested" is never an acceptable
outcome just because the remaining candidates score below some
threshold — low-scoring variants MUST still appear in the slate.
This is a UX contract: the user asked for 30 proposals and
expects 30 proposals, even if the 30th is noticeably weaker than
the 1st.

Implementation implication: every phase and every filter that
could narrow the candidate set below `topN` must either be
widened, softened, or followed by a fallback path that backfills
from the next-best available candidates. Scoring is for ordering,
not for elimination.

Regression set (all must still pass):

- Non-lock seed 42: rank-1 == 183.8 across topN 5 / 20 / 50
- `--locked TFT17_Aatrox_hero --seed 42`: hero present in top team
- `breakdown.filler` present and zero on clean top-1
- Tight `ShieldTank:6` alone: 30/30 valid
- Loose `DarkStar:4`: at least 14 valid
- Multi-lock `ShieldTank:6 + RangedTrait:4 + emblem :1`: at least
  15 valid with varied flex carriers
- **TopN contract**: every `--top-n N` generate (where N is
  within reason, say ≤ 100) returns either `N` results OR the
  mathematical maximum when N is unreachable given the
  constraints. Verified by:
  - `--top-n 30` on the three benchmark scenarios → 30 / 30 / 30
    (or documented maximum if impossible)
  - `--top-n 50` on a no-lock call → 50 results
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

- **E — Stepped cross-referenced filler with meta-aware weighting**
  (RECOMMENDED, refined from user feedback)

  The core idea: stop seeding random companions. Use companion
  data to RANK filler candidates against the champions already
  in the team, with **meta-aware cost weighting**, **5-cost
  throttling**, and **diversity-preserving pick decay** so a
  single "flex filler" (Shen-style champion that appears in
  every archetype's top companion list) can surface as one
  option without monopolising the slate.

  Algorithm:

  ```
  anchors = context.lockedChamps          // explicit locks +
                                          // tight auto-promote +
                                          // hero swap
  if anchors.length == 0:
    anchors = top-K champs by unitRating  // bootstrap for non-lock path

  // TFT17 meta is 3-4 cost centric. 3 and 4 are top priority,
  // 5-cost is a power spike but not the core, 1-2 are commodity
  // frontline / fodder. Weighting reflects that the 3/4-cost
  // anchors drive filler selection more strongly than anything
  // else in the team.
  costWeight(cost) = [0.3, 0.5, 1.0, 0.95, 0.55][cost - 1]

  candidateScore = new Map()
  for each anchor A in anchors:
    top_comps = companionData[baseOf(A)]
                .filter(games >= minGames, avgPlace < maxAvg)
                .sort asc by avgPlace
                .take top K (e.g. K=10)
    for each (comp, avgPlace) in top_comps:
      if comp in anchors: continue        // already in team
      if !allowedSet.has(comp): continue  // level gate
      candidateScore[comp] += costWeight(A.cost) * (1 - avgPlace / 8)

  // Iterative top-with-decay. Each pick halves that candidate's
  // remaining weight so the next iteration prefers a different
  // champion. After ~3 picks a given "flex filler" (Shen / Rhaast /
  // etc.) drops off the top of the list and another candidate
  // takes over, producing organically varied seed sets.
  const DECAY = 0.5
  const MAX_FIVE_COST_SEEDS = min(max5Cost or 2, 3)
  picks = []
  fiveCostCount = 0
  while picks.length < M and candidateScore has entries:
    best = argmax candidateScore
    if node[best].cost == 5 and fiveCostCount >= MAX_FIVE_COST_SEEDS:
      candidateScore.delete(best)         // skip, don't penalise
      continue
    picks.push(best)
    if node[best].cost == 5:
      fiveCostCount += 1
    candidateScore[best] *= DECAY         // decay, don't delete

  // Ensure picks.length >= desired buffer. If the candidate pool
  // was too small (very rare — usually only when locks make the
  // pool tiny), fall back to the top-unitRating champs that haven't
  // been picked yet so we always produce enough seeds.
  while picks.length < M:
    filler = next champion by unitRating not already in picks / anchors
    if filler is null: break              // truly exhausted pool
    picks.push(filler)

  for filler in picks:
    seeds = [...anchors, filler]
    addResult(buildOneTeam(graph, teamSize, seeds, ...))
  ```

  Key properties (REFINED):

  - **No 5-cost bias**. Cost weighting caps at 3-cost (1.0) and
    4-cost (0.95); 5-cost is 0.55. This matches the TFT17 meta
    observation that 3/4-cost carries (Karma, MF, Samira, Viktor,
    TahmKench, Nasus) drive comp identity; 5-costs are spike units,
    not anchors.

  - **5-cost throttle**. `MAX_FIVE_COST_SEEDS` caps how many of the
    M=30 seeds can have a 5-cost as the filler. Respects the
    caller-specified `max5Cost` if set (defaults to level-based
    caps). Prevents the phase from burning all its budget on
    5-cost-filler variants.

  - **Diversity via pick decay**. A champion like Shen who scores
    top-1 because he's on multiple anchors' companion lists gets
    picked first with full weight, then his remaining weight is
    halved. Second iteration will likely pick someone else (because
    the next candidate now out-ranks halved-Shen). After 2-3 picks
    Shen's weight is `0.125×` — well below any fresh candidate.
    Shen appears as one or two proposals, not twenty. Deterministic
    (no randomness), context-aware (depends on what's left in the
    map), cheap.

  - **Always produces M seeds**. The fallback loop fills from
    unit-rating-sorted candidates if the cross-referenced ranking
    runs out. This is the insurance policy for the new global
    invariant (see Success Criteria below): `phaseCompanionSeeded`
    must contribute enough raw teams that the engine post-filter
    can still deliver `topN` outputs after diversify.

  - **Cross-referencing is implicit**. A champion appearing as a
    top companion for multiple anchors accumulates score naturally.
    No separate "intersection" step.

  - **Context-aware**: lock set changes ⇒ anchor list changes ⇒
    different top fillers emerge. Locked scenarios get targeted
    filler for their specific core.

  **Impact**: locked runs drop companionSeeded from ~12 s →
  ~150 ms (30 calls × ~5 ms). Non-lock from ~333 ms → ~150 ms.
  Diversity is preserved without sacrificing empirical proof.

  **Risk**: low-medium. The ranker is new but each piece is
  straightforward (map + sort + argmax loop). Main risks are
  (a) cost-weight constants being wrong on first try — easy to
  tune after profiling; (b) DECAY being too aggressive and
  killing strong fillers prematurely — 0.5 is conservative,
  iterate if needed; (c) MAX_FIVE_COST_SEEDS default needing
  tuning — starts at 3 which gives each scenario 3 possible
  5-cost filler teams.

  **Effort**: ~2-2.5 h (ranker + decay + throttle + fallback
  + regression check).

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

### Fix 7 — TopN guarantee / backfill path (NEW, MANDATORY)

Enforces the new hard invariant: every generate call returns
exactly `topN` results unless constraints make that impossible.

Current behaviour failure modes:
- `phaseCompanionSeeded` (before Fix 1E) generates lots of teams
  but many are duplicates or don't satisfy locks → filter drops
  them → fewer than `topN` survive on locked runs
- Diversify cap can drop lock-satisfying teams when generic phases
  flood the result map (already partially addressed by the
  post-diversify splice in the previous sprint)
- Filter in `engine.ts::validCompsFilter` is hard — any team
  failing a trait lock check is dropped, and nothing backfills

Fix:
1. After `validComps` filter runs, count survivors.
2. If `validComps.length < topN`:
   a. Take the remaining teams from `enriched` (teams rejected
      by the filter) sorted by `score` descending.
   b. Mark each with a "relaxed" flag in `breakdown` so the UI
      can label them `(doesn't fully match your filters)`.
   c. Append to `validComps` until it reaches `topN` or the
      enriched pool is exhausted.
3. If `enriched` is also < topN, the constraints are
   mathematically impossible — return what we have and let the
   UI show an explicit "only N possible" message.

The relaxed flag is new metadata on the comp object; UI work is
out of scope for this sprint but the backend produces the
information so the UI can surface it later.

**Impact**: shifts the user experience contract — instead of
"here are the comps that pass your filters", it becomes "here
are your 30 proposals, the first K pass your filters exactly and
the rest are closest-fit alternatives". Much better UX for
heavy-constraint queries.

**Risk**: medium. Needs careful thought about which comps count
as "closest fit" when a lock is missed — simplest heuristic is
just engine score, but we might want to prefer ones that miss
the lock by the smallest amount (e.g. DarkStar:4 locked, team
has DarkStar:3 → closer fit than DarkStar:1). Start with plain
score ordering and iterate if it feels wrong.

**Effort**: ~1 h. Small piece of code, but the semantic
implications deserve testing.

**Placement**: ships alongside Fix 1E. The guarantee has no
value if `phaseCompanionSeeded` is still starving the candidate
pool — Fix 1E feeds enough raw teams, Fix 7 makes the final
slate actually land at topN.

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
   with meta-aware cost weighting + 5-cost throttle + decay
   diversity — refined from user feedback)
2. **Fix 7** (topN guarantee / backfill path) — ships in the same
   session as Fix 1E because the new invariant depends on both
3. **Fix 2 A** (temperatureSweep multiplier + skip-on-locked)
4. Re-run `scout-cli profile`, compare to baseline
5. Verify the topN contract manually on the benchmark scenarios
   (`--top-n 30` must return 30 / 30 / 30 unless impossible)
6. **Fix 5** (constraint mutation cleanup — safe, trivial)
7. Evaluate: did we hit target B? If yes, stop. If no, consider Fix 3 + Fix 4 + a second pass at the profile
8. **Fix 6** (phase split) only if target hit AND time remains

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
