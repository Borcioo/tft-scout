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

## Out of scope / follow-ups

- Web Workers pool (Phase E, separate spec if needed)
- WASM / native module rewrite
- Server-side generation
- Progressive result streaming (partial results while phases run)
- Replacing the MetaTFT context source with something faster

These may land in future sprints depending on what the sequential
fixes achieve.
