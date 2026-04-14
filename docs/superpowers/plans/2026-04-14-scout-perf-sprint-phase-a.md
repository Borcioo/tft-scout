# Scout Performance Sprint — Phase A (Discovery) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Instrument the scout worker with an env-gated profiler, add a `scout-cli profile` command that runs three benchmark scenarios, add a code duplication scanner, run everything, and commit two Markdown reports (perf + audit) so Phase B can design data-driven fixes.

**Architecture:** The profiler is a leaf module in `resources/js/workers/scout/scout-profiler.ts` with zero dependencies on the rest of the worker — it exports `startSpan` / `resetProfiler` / `dumpProfile` and is gated by `SCOUT_PROFILE=1` env var (Node) or `globalThis.__SCOUT_PROFILE__` (browser). When the flag is off, `startSpan` returns a cached no-op closure and there's no runtime cost. `engine.ts` and `synergy-graph.ts` wrap each significant section with `const end = startSpan(name); try { … } finally { end(); }`. A new `scout-cli profile` subcommand runs three deterministic scenarios, collects the spans, and writes a Markdown report. A standalone duplication scanner at `scripts/scout-audit/duplication.ts` walks every `.ts` under the worker, tokenises each file, and reports sliding-window block hash collisions. All generated reports land in `docs/superpowers/research/`.

**Tech Stack:** TypeScript, tsx (for scout-cli runtime), Node `performance.now()`, `scout-cli` infrastructure. No new dependencies.

---

## Scope

**In scope for this plan:**
- Profiler module
- Instrumentation in `engine.ts` and `synergy-graph.ts`
- `scout-cli profile` subcommand
- Duplication scanner script
- Running all three scenarios + scanner
- Manual code audit pass
- Two committed reports under `docs/superpowers/research/`

**Out of scope (Phase C+D plan, written later):**
- Any runtime behaviour changes — the profiler gate must be off by default
- Actual performance fixes based on the reports
- Code refactorings (`synergy-graph.ts` split, `shared-helpers.ts`)
- Cache layer
- Parallelism

**Success gate before Phase B:** the final commit of this plan is a stop point. The user reviews both reports and the existing spec (`docs/superpowers/specs/2026-04-14-scout-perf-sprint-design.md`) gets updated with a concrete fix list before any implementation starts.

---

## File Structure

### New files

- **`resources/js/workers/scout/scout-profiler.ts`** — single-responsibility span collector. Exports `startSpan`, `resetProfiler`, `dumpProfile`, plus internal `enabled` check. Zero dependencies.
- **`scripts/scout-cli/commands/profile.ts`** — one subcommand handler. Runs three hardcoded scenarios, invokes `engine.generate` with `SCOUT_PROFILE=1`, collects spans, writes Markdown.
- **`scripts/scout-audit/duplication.ts`** — standalone executable: walks `resources/js/workers/scout/`, tokenises each `.ts`, hashes 8-line windows, reports collisions.
- **`docs/superpowers/research/scout-perf-2026-04-14.md`** — generated.
- **`docs/superpowers/research/scout-code-audit-2026-04-14.md`** — half generated (duplication) + half manual (modularity, dead code).

### Modified files

- **`resources/js/workers/scout/engine.ts`** — import `startSpan`, wrap 8 sections (see Task 2 for the exact list).
- **`resources/js/workers/scout/synergy-graph.ts`** — import `startSpan`, wrap `buildGraph`, `findTeams`, all 10 phases, `diversifyResults`.
- **`scripts/scout-cli.ts`** — register the `profile` subcommand in the dispatcher switch.

---

## Task 1: Profiler module

**Files:**
- Create: `resources/js/workers/scout/scout-profiler.ts`

- [ ] **Step 1: Create the profiler module**

```typescript
// @ts-nocheck
/**
 * Env-gated span collector for measuring scout pipeline hot spots.
 *
 * Enabled by either:
 *   - Node: SCOUT_PROFILE=1 env var
 *   - Browser: globalThis.__SCOUT_PROFILE__ = true
 *
 * When disabled, startSpan returns a cached no-op closure so the hot
 * path pays essentially nothing. When enabled, each span contributes
 * one Map lookup + one subtraction + (on first hit per name) one Map
 * insertion — all aggregated across the scenario run.
 *
 * Usage:
 *
 *   const end = startSpan('engine.findTeams');
 *   try {
 *     // ...work...
 *   } finally {
 *     end();
 *   }
 *
 * Reports by summing `durationMs` per name and dividing by `count` if
 * you want a mean. Names are flat strings (no nesting) so the ordering
 * in the final table is trivial — sort by durationMs descending.
 */

type Span = { name: string; durationMs: number; count: number };

const spans = new Map<string, Span>();

function isEnabled(): boolean {
    if (typeof process !== 'undefined' && process.env && process.env.SCOUT_PROFILE === '1') {
        return true;
    }

    if (typeof globalThis !== 'undefined' && (globalThis as any).__SCOUT_PROFILE__ === true) {
        return true;
    }

    return false;
}

const NOOP = () => {};

export function startSpan(name: string): () => void {
    if (!isEnabled()) {
        return NOOP;
    }

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

export function resetProfiler(): void {
    spans.clear();
}

export function dumpProfile(): Span[] {
    return [...spans.values()].sort((a, b) => b.durationMs - a.durationMs);
}
```

- [ ] **Step 2: Type + lint check**

Run: `npm run types:check && npm run lint:check`
Expected: both exit 0, no output.

- [ ] **Step 3: Sanity check — module loads, exports expected symbols**

Run:
```bash
SCOUT_PROFILE=1 npx tsx -e "
import { startSpan, resetProfiler, dumpProfile } from './resources/js/workers/scout/scout-profiler.ts';
const end = startSpan('sanity.check');
for (let i = 0; i < 1000000; i++) {}
end();
const spans = dumpProfile();
console.log(JSON.stringify(spans, null, 2));
resetProfiler();
console.log('after reset:', dumpProfile().length);
"
```

Expected: prints a JSON array with one span named `sanity.check`, `count: 1`, `durationMs` a small positive number, then `after reset: 0`.

- [ ] **Step 4: Commit**

```bash
git add resources/js/workers/scout/scout-profiler.ts
git commit -m "$(cat <<'EOF'
feat(scout): add env-gated profiler module

Leaf module with zero dependencies. Exposes startSpan /
resetProfiler / dumpProfile. Gated on SCOUT_PROFILE=1
(Node) or globalThis.__SCOUT_PROFILE__ = true (browser);
returns a cached no-op closure when disabled so the hot
path pays nothing. Aggregates per span name; dumpProfile
returns spans sorted by durationMs descending.

First step of the scout performance sprint Phase A —
instrumentation for the engine and synergy-graph lands
in the next commits.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Instrument `engine.ts`

**Files:**
- Modify: `resources/js/workers/scout/engine.ts` — add import + wrap 8 sections

- [ ] **Step 1: Add import at the top of `engine.ts`**

Locate the existing import block near the top of `engine.ts` (around lines 19–24). Add the profiler import alongside the others:

```typescript
import { startSpan } from './scout-profiler';
```

It does not matter whether it goes alphabetically or at the end — the file already has `@ts-nocheck` and lint is relaxed there.

- [ ] **Step 2: Wrap the whole `generate` body**

Find `export function generate(input) {` (around line 32). Immediately inside the function body, before any other work, add:

```typescript
export function generate(input) {
  const _endGenerateTotal = startSpan('engine.generate.total');
  try {
```

And just before every `return` statement from `generate` (there's only one at the very end — look for `return finalComps;` or the equivalent near the end of the function), add the matching `} finally { _endGenerateTotal(); }` wrapping the whole body. The cleanest way is to push `return` into a local, call the span end, then return:

```typescript
    // ... existing return preparation (validComps.sort, slice, hero swap back) ...

    const finalResult = finalComps;

    _endGenerateTotal();

    return finalResult;
  } catch (e) {
    _endGenerateTotal();
    throw e;
  }
}
```

If there is already a local like `finalComps` being returned, just call `_endGenerateTotal()` on the line before the `return` and wrap the whole body in a `try/finally`. The goal: the total span is always ended, even on exception.

- [ ] **Step 3: Wrap `filterCandidates` call**

Find the `const candidates = filterCandidates(...)` line (around line 57). Replace with:

```typescript
    const _endFilterCandidates = startSpan('engine.filterCandidates');
    const candidates = filterCandidates(champions, constraints, effectiveExclusionGroups);
    _endFilterCandidates();
```

- [ ] **Step 4: Wrap tight auto-promote loop**

Find the `for (const lock of traitLocks)` loop for the tight auto-promote (comment `// Tight-trait-lock auto-promotion`). Add markers around the whole for-loop:

```typescript
    const _endTightAutoPromote = startSpan('engine.tightAutoPromote');
    for (const lock of traitLocks) {
      // ... existing body unchanged ...
    }
    _endTightAutoPromote();
```

- [ ] **Step 5: Wrap `buildGraph` call**

Find `const graph = buildGraph(...)` (around line 187). Replace with:

```typescript
    const _endBuildGraph = startSpan('engine.buildGraph');
    const graph = buildGraph(eligibleChampions, traits, scoringCtx, exclusionLookup);
    _endBuildGraph();
```

- [ ] **Step 6: Wrap `findTeams` call**

Find `const rawTeams = findTeams(graph, {` (around line 205). Wrap it:

```typescript
    const _endFindTeams = startSpan('engine.findTeams');
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
    _endFindTeams();
```

- [ ] **Step 7: Wrap the enrich loop + its sub-calls**

Find `const enriched = rawTeams.map(team => {`. Wrap the whole `rawTeams.map(...)` call, and also wrap the three aggregated sub-calls inside the map lambda. The new block reads:

```typescript
    const _endEnrichLoop = startSpan('engine.enrichLoop');
    const enriched = rawTeams.map(team => {
      let totalSlots = 0;

      for (const c of team.champions) {
        totalSlots += c.slotsUsed || 1;
      }

      const _endBAT = startSpan('engine.enrichLoop.buildActiveTraits');
      const activeTraits = buildActiveTraits(team.champions, traits, constraints.emblems || []);
      _endBAT();

      const _endTS = startSpan('engine.enrichLoop.teamScore');
      const score = teamScore({
        champions: team.champions,
        activeTraits,
        level,
        roleBalance: constraints.roleBalance ?? null,
      }, scoringCtx);
      _endTS();

      const _endTSB = startSpan('engine.enrichLoop.teamScoreBreakdown');
      const breakdown = teamScoreBreakdown({ champions: team.champions, activeTraits, level, roleBalance: constraints.roleBalance ?? null }, scoringCtx);
      _endTSB();

      const roles = teamRoleBalance(team.champions);

      return {
        champions: team.champions,
        activeTraits,
        score,
        breakdown,
        level,
        slotsUsed: totalSlots,
        roles: { frontline: roles.frontline, dps: roles.dps, fighter: roles.fighter },
      };
    });
    _endEnrichLoop();
```

The three inner spans aggregate across all `rawTeams.length` iterations — that's intentional, so you see the total cost of each component across the whole enrich pass.

- [ ] **Step 8: Wrap `validComps` filter**

Find the `const validComps = enriched.filter(r => {` line. Wrap it:

```typescript
    const _endValidCompsFilter = startSpan('engine.validCompsFilter');
    const validComps = enriched.filter(r => {
      // ... existing body unchanged ...
    });
    _endValidCompsFilter();
```

- [ ] **Step 9: Wrap meta-comp match block**

Find `// Meta-comp match detection` and the whole block underneath (the `if (metaComps.length > 0) { for (const comp of validComps) { … } }` block). Wrap:

```typescript
    const _endMetaCompMatch = startSpan('engine.metaCompMatch');
    const metaComps = scoringCtx.metaComps || [];

    if (metaComps.length > 0) {
      // ... existing body unchanged ...
    }
    _endMetaCompMatch();
```

- [ ] **Step 10: Wrap insights loop**

Find `for (const team of validComps) { team.insights = buildTeamInsights(...) }`. Wrap:

```typescript
    const _endInsights = startSpan('engine.insightsLoop');
    for (const team of validComps) {
      team.insights = buildTeamInsights(team, ctxForInsights, batchMedianScore);
    }
    _endInsights();
```

- [ ] **Step 11: Type + lint check**

Run: `npm run types:check && npm run lint:check`
Expected: both exit 0, no output.

- [ ] **Step 12: Sanity — non-locked generate still deterministic**

Run:
```bash
SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 \
  npx tsx scripts/scout-cli.ts generate --top-n 5 --seed 42 2>/dev/null \
  | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log("rank1:",j.results[0].score);'
```

Expected output exactly: `rank1: 183.8`

If it drifted, the try/finally wrapping corrupted control flow. Revert and retry more carefully.

- [ ] **Step 13: Commit**

```bash
git add resources/js/workers/scout/engine.ts
git commit -m "$(cat <<'EOF'
feat(scout): instrument engine.ts with profiler spans

Wraps filterCandidates, tight auto-promote, buildGraph,
findTeams, the enrich loop (including buildActiveTraits,
teamScore, teamScoreBreakdown sub-spans), validComps filter,
meta-comp match, insights loop, and the whole generate call.
Spans only fire when SCOUT_PROFILE=1 (Node) or
globalThis.__SCOUT_PROFILE__ = true (browser). Non-locked
generate at seed 42 still returns rank-1 = 183.8.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Instrument `synergy-graph.ts`

**Files:**
- Modify: `resources/js/workers/scout/synergy-graph.ts`

- [ ] **Step 1: Add import**

Locate the import block at the top of `synergy-graph.ts`. Add:

```typescript
import { startSpan } from './scout-profiler';
```

- [ ] **Step 2: Wrap `buildGraph` function body**

Find `export function buildGraph(champions, traits, scoringCtx = {}, exclusionLookup = {}) {`. Wrap the whole body with a try/finally using the `synergy.buildGraph` span:

```typescript
export function buildGraph(champions, traits, scoringCtx = {}, exclusionLookup = {}) {
  const _end = startSpan('synergy.buildGraph');

  try {
    // ... existing body ...

    return { nodes, traitMap, adjacency, traitBreakpoints, traitStyles, scoringCtx, exclusionLookup };
  } finally {
    _end();
  }
}
```

(Use whatever the current return shape is — keep the existing return verbatim, just push it inside the try.)

- [ ] **Step 3: Wrap `findTeams` body**

Find `export function findTeams(graph, options = {}) {`. Wrap the whole body in `try/finally` with `synergy.findTeams` span. The return at the bottom moves inside the try:

```typescript
export function findTeams(graph, options = {}) {
  const _end = startSpan('synergy.findTeams');

  try {
    // ... existing body up to the final return ...

    return diverse;
  } finally {
    _end();
  }
}
```

- [ ] **Step 4: Wrap each phase invocation inside `findTeams`**

Inside `findTeams`, locate the phase invocation block (the sequence that starts with `phaseLockedTraitSeeded(phaseCtx);`). Replace the whole block with per-phase spans:

```typescript
  {
    const _e = startSpan('synergy.phase.lockedTraitSeeded');
    phaseLockedTraitSeeded(phaseCtx);
    _e();
  }
  const lockedTraitSeedKeys = new Set(results.keys());
  {
    const _e = startSpan('synergy.phase.temperatureSweep');
    phaseTemperatureSweep(phaseCtx);
    _e();
  }
  {
    const _e = startSpan('synergy.phase.traitSeeded');
    phaseTraitSeeded(phaseCtx);
    _e();
  }
  {
    const _e = startSpan('synergy.phase.deepVertical');
    phaseDeepVertical(phaseCtx);
    _e();
  }
  {
    const _e = startSpan('synergy.phase.pairSynergy');
    phasePairSynergy(phaseCtx);
    _e();
  }
  {
    const _e = startSpan('synergy.phase.companionSeeded');
    phaseCompanionSeeded(phaseCtx);
    _e();
  }
  {
    const _e = startSpan('synergy.phase.metaCompSeeded');
    phaseMetaCompSeeded(phaseCtx);
    _e();
  }
  {
    const _e = startSpan('synergy.phase.fiveCostHeavy');
    phaseFiveCostHeavy(phaseCtx);
    _e();
  }
  {
    const _e = startSpan('synergy.phase.crossover');
    phaseCrossover(phaseCtx);
    _e();
  }
  {
    const _e = startSpan('synergy.phase.hillClimb');
    phaseHillClimb(phaseCtx);
    _e();
  }
```

Each phase is in its own block scope so the local `_e` variable doesn't shadow across phases.

- [ ] **Step 5: Wrap `diversifyResults` call**

Still inside `findTeams`, find `const diverse = diversifyResults(results, maxResults, traitBreakpoints, emblems);`. Wrap:

```typescript
    const _endDiversify = startSpan('synergy.diversify');
    const diverse = diversifyResults(results, maxResults, traitBreakpoints, emblems);
    _endDiversify();
```

- [ ] **Step 6: Type + lint check**

Run: `npm run types:check && npm run lint:check`
Expected: both exit 0, no output.

- [ ] **Step 7: Sanity — non-locked generate still deterministic**

Run:
```bash
SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 \
  npx tsx scripts/scout-cli.ts generate --top-n 5 --seed 42 2>/dev/null \
  | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log("rank1:",j.results[0].score);'
```

Expected output exactly: `rank1: 183.8`

- [ ] **Step 8: Commit**

```bash
git add resources/js/workers/scout/synergy-graph.ts
git commit -m "$(cat <<'EOF'
feat(scout): instrument synergy-graph.ts with profiler spans

Wraps buildGraph, findTeams, each of the 10 phases, and
diversifyResults with per-section spans. Phase invocations
moved into block-scoped start/end pairs so the per-phase
breakdown shows up in the profile report. Non-locked
generate at seed 42 still returns rank-1 = 183.8.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `scout-cli profile` subcommand

**Files:**
- Create: `scripts/scout-cli/commands/profile.ts`
- Modify: `scripts/scout-cli.ts` — dispatch new command

- [ ] **Step 1: Create the profile command handler**

```typescript
// @ts-nocheck
/**
 * `scout-cli profile` — runs three benchmark scenarios with the
 * profiler enabled, collects spans, and writes a Markdown report to
 * docs/superpowers/research/scout-perf-<YYYY-MM-DD>.md.
 *
 * Each scenario runs twice: the first run warms up the JIT and is
 * discarded; the second run is what we report. Both numbers appear
 * in the report so drift between warmup and steady state is visible.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { resetProfiler, dumpProfile } from '../../../resources/js/workers/scout/scout-profiler';
import { generate } from '../../../resources/js/workers/scout/engine';
import { loadContext } from '../context-loader';

type Scenario = {
    id: string;
    label: string;
    params: any;
};

const SCENARIOS: Scenario[] = [
    {
        id: 'no-lock',
        label: 'No lock, lvl 8, topN=10',
        params: {
            level: 8,
            topN: 10,
            max5Cost: null,
            minFrontline: 0,
            minDps: 0,
            lockedChampions: [],
            lockedTraits: [],
            excludedChampions: [],
            excludedTraits: [],
            emblems: [],
            seed: 0,
        },
    },
    {
        id: 'tight-lock',
        label: 'Tight lock ShieldTank:6, lvl 10, topN=30',
        params: {
            level: 10,
            topN: 30,
            max5Cost: null,
            minFrontline: 0,
            minDps: 0,
            lockedChampions: [],
            lockedTraits: [{ apiName: 'TFT17_ShieldTank', minUnits: 6 }],
            excludedChampions: [],
            excludedTraits: [],
            emblems: [],
            seed: 0,
        },
    },
    {
        id: 'loose-lock-emblem',
        label: 'Loose ShieldTank:6 + RangedTrait:4 + emblem, lvl 10, topN=30',
        params: {
            level: 10,
            topN: 30,
            max5Cost: null,
            minFrontline: 0,
            minDps: 0,
            lockedChampions: [],
            lockedTraits: [
                { apiName: 'TFT17_ShieldTank', minUnits: 6 },
                { apiName: 'TFT17_RangedTrait', minUnits: 4 },
            ],
            excludedChampions: [],
            excludedTraits: [],
            emblems: [{ apiName: 'TFT17_RangedTrait', count: 1 }],
            seed: 0,
        },
    },
];

function runScenario(scenario: Scenario, ctx: any, label: string) {
    resetProfiler();

    const t0 = performance.now();
    generate({
        champions: ctx.champions,
        traits: ctx.traits,
        scoringCtx: ctx.scoringCtx,
        constraints: scenario.params,
        exclusionGroups: ctx.exclusionGroups,
        level: scenario.params.level,
        topN: scenario.params.topN,
        seed: scenario.params.seed,
        stale: ctx.stale,
    });
    const wallMs = performance.now() - t0;

    return { label, wallMs, spans: dumpProfile() };
}

function formatSpanTable(spans: Array<{ name: string; durationMs: number; count: number }>): string {
    const lines = ['| span | durationMs | count | mean ms |', '| --- | ---: | ---: | ---: |'];

    for (const s of spans) {
        const mean = s.count > 0 ? (s.durationMs / s.count).toFixed(3) : '-';
        lines.push(`| ${s.name} | ${s.durationMs.toFixed(2)} | ${s.count} | ${mean} |`);
    }

    return lines.join('\n');
}

export async function runProfile(_argv: string[]): Promise<void> {
    if (process.env.SCOUT_PROFILE !== '1') {
        throw new Error('scout-cli profile: set SCOUT_PROFILE=1 before running so the profiler actually collects spans');
    }

    const ctx = await loadContext();
    const date = new Date().toISOString().slice(0, 10);
    const outPath = resolve(process.cwd(), `docs/superpowers/research/scout-perf-${date}.md`);

    mkdirSync(dirname(outPath), { recursive: true });

    const sections: string[] = [
        `# Scout performance profile — ${date}`,
        '',
        '> Generated by `scout-cli profile`. Each scenario runs twice;',
        '> the second run is the one you care about (first warms up JIT).',
        '',
    ];

    for (const scenario of SCENARIOS) {
        sections.push(`## ${scenario.label}`);
        sections.push('');

        const warm = runScenario(scenario, ctx, 'warmup');
        sections.push(`**Warmup wall time:** ${warm.wallMs.toFixed(1)} ms`);
        sections.push('');

        const measured = runScenario(scenario, ctx, 'measured');
        sections.push(`**Measured wall time:** ${measured.wallMs.toFixed(1)} ms`);
        sections.push('');
        sections.push('### Top spans (measured run, sorted by total durationMs)');
        sections.push('');
        sections.push(formatSpanTable(measured.spans.slice(0, 25)));
        sections.push('');
    }

    writeFileSync(outPath, sections.join('\n'), 'utf8');

    console.log(`profile report written to ${outPath}`);
}
```

- [ ] **Step 2: Register the `profile` command in the dispatcher**

In `scripts/scout-cli.ts`, find the `switch (command) { … }` block that dispatches to other commands (there's one for `generate`, `phase`, `lab`, etc.). Add a case for `profile`:

```typescript
        case 'profile': {
            const { runProfile } = await import('./scout-cli/commands/profile');

            await runProfile(rest);
            break;
        }
```

- [ ] **Step 3: Check whether `loadContext` exists at the path the command imports**

Run:
```bash
ls scripts/scout-cli/context-loader.ts 2>&1
```

Expected: the file prints its path.

If it does **not** exist, open `scripts/scout-cli/commands/generate.ts` and look for how it loads the context (search for `loadContext` or `snapshot` near the top). Whatever helper that file uses, import it from the same path in `profile.ts`. If generate.ts uses a direct inline fetch from the snapshot file, replicate that same inline loader in `profile.ts` — do not introduce a new helper just for this task.

- [ ] **Step 4: Type + lint check**

Run: `npm run types:check && npm run lint:check`
Expected: both exit 0, no output.

- [ ] **Step 5: Dry-run the command without writing the report**

Run:
```bash
SCOUT_PROFILE=1 SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 \
  npx tsx scripts/scout-cli.ts profile 2>&1 | tail -20
```

Expected: a single line `profile report written to …/scout-perf-YYYY-MM-DD.md` and no stack traces.

Do not inspect or commit the report yet — Task 6 runs it properly and commits.

- [ ] **Step 6: Commit**

```bash
git add scripts/scout-cli/commands/profile.ts scripts/scout-cli.ts
git commit -m "$(cat <<'EOF'
feat(scout-cli): add 'profile' subcommand

Runs three hardcoded benchmark scenarios (no-lock topN=10,
tight lock ShieldTank:6, loose lock+emblem RangedTrait:4),
each twice (warmup + measured), collects spans via the
scout profiler, and writes a Markdown report to
docs/superpowers/research/scout-perf-<date>.md. Requires
SCOUT_PROFILE=1 to be set — fails fast with a clear error
otherwise.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Duplication scanner

**Files:**
- Create: `scripts/scout-audit/duplication.ts`

- [ ] **Step 1: Create the scanner**

```typescript
// @ts-nocheck
/**
 * Duplication scanner for the scout worker.
 *
 * Walks `resources/js/workers/scout/` for `.ts` files, tokenises each
 * one, hashes sliding 8-line windows after normalising identifiers to
 * `_`, and prints any hash collisions as potential duplicated blocks.
 *
 * Output is raw — manual review filters false positives before the
 * audit report is written. The scanner is strictly observational:
 * it never touches source files.
 *
 * Usage:
 *   npx tsx scripts/scout-audit/duplication.ts
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const WINDOW = 8;
const ROOT = resolve(process.cwd(), 'resources/js/workers/scout');

function walk(dir: string): string[] {
    const out: string[] = [];

    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        const st = statSync(full);

        if (st.isDirectory()) {
            out.push(...walk(full));
        } else if (name.endsWith('.ts')) {
            out.push(full);
        }
    }

    return out;
}

function normalise(line: string): string {
    return line
        .replace(/\/\/.*$/, '')
        .replace(/\b[A-Za-z_$][A-Za-z0-9_$]*\b/g, '_')
        .replace(/\s+/g, ' ')
        .trim();
}

function hashWindow(lines: string[]): string {
    return createHash('sha1').update(lines.join('\n')).digest('hex').slice(0, 12);
}

type Hit = { file: string; startLine: number; preview: string };

const buckets = new Map<string, Hit[]>();

for (const file of walk(ROOT)) {
    const raw = readFileSync(file, 'utf8').split('\n');
    const normalised = raw.map(normalise);

    for (let i = 0; i + WINDOW <= normalised.length; i++) {
        const window = normalised.slice(i, i + WINDOW);

        if (window.filter(l => l.length > 0).length < WINDOW / 2) {
            continue;
        }

        const h = hashWindow(window);
        const hit: Hit = {
            file: file.replace(process.cwd() + '/', '').replace(process.cwd() + '\\', ''),
            startLine: i + 1,
            preview: raw[i].trim().slice(0, 80),
        };

        if (!buckets.has(h)) {
            buckets.set(h, []);
        }

        buckets.get(h)!.push(hit);
    }
}

const collisions = [...buckets.values()].filter(hits => hits.length > 1);

console.log(`# Duplication scan — ${collisions.length} collision buckets\n`);

for (const hits of collisions) {
    console.log('## collision');

    for (const h of hits) {
        console.log(`- ${h.file}:${h.startLine}  \`${h.preview}\``);
    }

    console.log('');
}
```

- [ ] **Step 2: Type + lint check**

Run: `npm run types:check && npm run lint:check`
Expected: both exit 0, no output.

If lint complains about the `@ts-nocheck` or non-null assertion, leave them — the file is a one-shot scanner, not production code. If necessary, add a `/* eslint-disable */` at the very top.

- [ ] **Step 3: Dry run the scanner**

Run:
```bash
npx tsx scripts/scout-audit/duplication.ts 2>&1 | head -30
```

Expected: prints `# Duplication scan — N collision buckets` followed by collision listings. `N` will be non-zero; the exact count is discovery data, not a test expectation.

Do not commit the output — Task 7 uses it as input for the audit report.

- [ ] **Step 4: Commit**

```bash
git add scripts/scout-audit/duplication.ts
git commit -m "$(cat <<'EOF'
chore(scout-audit): add duplication scanner

Standalone tsx script that walks resources/js/workers/scout/,
tokenises each .ts file (normalising identifiers so literal
names don't dominate the hash), and reports sliding 8-line
window hash collisions. Output is raw — manual review in the
Phase A audit report filters false positives. Script is
strictly observational and never touches source files.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Run the profiler and write the perf report

**Files:**
- Create: `docs/superpowers/research/scout-perf-2026-04-14.md` (generated)

- [ ] **Step 1: Run the profile command**

```bash
SCOUT_PROFILE=1 SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 \
  npx tsx scripts/scout-cli.ts profile
```

Expected: prints `profile report written to …/scout-perf-2026-04-14.md` and exits 0.

- [ ] **Step 2: Inspect the report**

```bash
cat docs/superpowers/research/scout-perf-2026-04-14.md
```

Expected: a Markdown document with three `## Scenario …` sections, each containing warmup + measured wall time and a top-25 span table. Numbers are real, not placeholders. If the file is empty or the tables are missing, go back to Task 4 and debug the command.

- [ ] **Step 3: Annotate the report with a summary**

Open `docs/superpowers/research/scout-perf-2026-04-14.md` and prepend a summary block between the header and the first scenario. The summary lists the **top 5 spans by total durationMs across all three scenarios combined**, computed by hand from the existing tables:

```markdown
## Summary — hottest spans across all scenarios

Sum of `durationMs` for the measured run across every scenario
where the span fires. Use this as the prioritisation input for
Phase B fix ranking.

| rank | span | total ms | notes |
| ---: | --- | ---: | --- |
| 1 | … | … | pick the obvious hot spot |
| 2 | … | … | |
| 3 | … | … | |
| 4 | … | … | |
| 5 | … | … | |

## Observations

(1-3 short bullet observations that jump out — e.g. "phaseTemperatureSweep
dominates non-lock runs" or "enrichLoop.teamScore aggregates to >1 s on
the tight lock scenario". Do not design fixes here — that is Phase B.)
```

Fill in the rank/span/total ms columns by reading the existing tables. Keep the observations factual.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/research/scout-perf-2026-04-14.md
git commit -m "$(cat <<'EOF'
docs(research): scout performance profile — Phase A baseline

Three scenarios (no-lock topN=10, tight lock ShieldTank:6,
loose lock+emblem RangedTrait:4), each run twice with
SCOUT_PROFILE=1. Report lists per-span durationMs sorted
descending plus a manually computed summary of the top
five cross-scenario hot spots and 1-3 factual observations.
Input for Phase B fix prioritisation.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Run the audit scanner and write the code audit report

**Files:**
- Create: `docs/superpowers/research/scout-code-audit-2026-04-14.md`

- [ ] **Step 1: Run the duplication scanner and save raw output**

```bash
npx tsx scripts/scout-audit/duplication.ts > /tmp/scout-dup-raw.md 2>&1
wc -l /tmp/scout-dup-raw.md
```

Expected: non-zero line count. The raw output has many false positives (short utility lines, signatures) — Step 3 filters them.

- [ ] **Step 2: Start writing the audit report**

Create `docs/superpowers/research/scout-code-audit-2026-04-14.md` with three sections:

```markdown
# Scout code audit — 2026-04-14

Input for Phase B fix prioritisation alongside `scout-perf-2026-04-14.md`.
Observational only — no code touched during Phase A.

## Duplicated code blocks

(Manually filtered from `scripts/scout-audit/duplication.ts` output.
Only meaningful collisions are listed — trivial repeats like
"const lockedSet = new Set(…)" are filtered out.)

| suggested helper | locations | est. lines saved |
| --- | --- | ---: |
| … | file:line → file:line | … |

## File structure recommendations

### synergy-graph.ts modularity review

- Current size: N lines, M top-level functions
- Phases defined inline: list them, mark which are self-contained
  (>= 50 lines, only public helper dependencies, no shared locals
  with other phases).
- Recommended splits: list each phase that qualifies with a target
  filename like `synergy-graph/phase-temperature-sweep.ts`. If nothing
  qualifies, say so explicitly and explain why (e.g. shared local
  helpers prevent clean extraction).

### Other files

Any other file > 500 lines gets a similar review. Most likely just
engine.ts — note whether its `generate()` function is a candidate for
splitting into sub-functions (weight by how much of it reads
sequentially vs. branching logic).

## Dead code / simplifications

(Short list of concrete observations with file:line references.
Examples of the kind of thing to look for:

- Exported functions with zero inbound imports
- Branches for impossible cases (e.g. `if (pool === null)` when the
  caller always guarantees non-null)
- `Object.entries(graph.nodes)` called multiple times in the same hot
  path when one pass + cache would do
- Triple-nested loops that could flatten to a single pass over a
  precomputed index
- Repeated `?.` chains into the same deep field

Each entry: file:line — observation — suggested action in 1 sentence.
Do not implement any of them during Phase A.)
```

- [ ] **Step 3: Fill in the Duplicated code blocks section**

Open `/tmp/scout-dup-raw.md` and walk through each `## collision` group. For each collision that references more than one file or more than one location within the same file:

1. Read the lines at each reported `file:line`
2. Decide if the duplicated block is meaningful (≥ 5 significant lines that express the same logic) or noise (short signatures, boilerplate)
3. If meaningful, add a row to the table with a suggested helper name and a best-guess line count saved

Target: at most 10 rows. If the scanner found 50 collisions and only 2 are meaningful, list those 2. Quality > quantity.

- [ ] **Step 4: Fill in the File structure recommendations section**

Run the counts first:
```bash
wc -l resources/js/workers/scout/synergy-graph.ts resources/js/workers/scout/engine.ts
grep -cE '^(function|export function) ' resources/js/workers/scout/synergy-graph.ts
```

Write the counts into the report (replace `N` and `M` placeholders). Then read `synergy-graph.ts` enough to identify which phases are self-contained candidates and list them under "Recommended splits". If you cannot tell without a deeper read, say "Needs deeper review before Phase C decides to split" and move on — the audit is observational, not exhaustive.

- [ ] **Step 5: Fill in the Dead code / simplifications section**

Scan `engine.ts`, `synergy-graph.ts`, and the newer helpers (`scorer.ts`, `candidates.ts`, `active-traits.ts`, `hero-exclusion.ts`) for the patterns listed in the section template. Add 3-8 concrete entries with file:line pointers. Do not expand the list past 8 — this is a prioritisation input, not a comprehensive review.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/research/scout-code-audit-2026-04-14.md
git commit -m "$(cat <<'EOF'
docs(research): scout code audit — Phase A baseline

Three sections: meaningful duplicated blocks (filtered from
the scanner output), modularity review of synergy-graph.ts
and engine.ts with recommended file splits where applicable,
and concrete dead-code / simplification observations. Paired
with scout-perf-2026-04-14.md as input for Phase B fix
prioritisation. Observational only — no code touched.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Stop point — hand off to Phase B

**Files:**
- None — this task is a coordination gate, not a code change.

- [ ] **Step 1: Session-wide regression sweep**

Run the full regression set from the spec's Success Criteria — every check must pass:

```bash
# Non-lock seed 42 determinism
for n in 5 20 50; do
  SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 \
    npx tsx scripts/scout-cli.ts generate --top-n $n --seed 42 2>/dev/null \
    | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log("n='$n' rank1:",j.results[0].score);'
done
```

Expected: every line prints `rank1: 183.8`.

```bash
# Hero swap
SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 \
  npx tsx scripts/scout-cli.ts generate --top-n 1 --locked TFT17_Aatrox_hero --seed 42 2>/dev/null \
  | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log("hero-in-team:",j.results[0].champions.includes("TFT17_Aatrox_hero"));'
```

Expected: `hero-in-team: true`.

```bash
# Filler metric present on clean top-1
SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 \
  npx tsx scripts/scout-cli.ts generate --top-n 1 --seed 42 2>/dev/null \
  | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log("filler:",j.results[0].breakdown.filler);'
```

Expected: `filler: 0`.

```bash
# Tight lock alone
SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 \
  npx tsx scripts/scout-cli.ts generate --top-n 30 --level 10 --locked-trait TFT17_ShieldTank:6 --seed 0 2>&1 \
  | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log("valid:",j.filtered.afterValidComps);'
```

Expected: `valid: 30`.

```bash
# Loose DarkStar
SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 \
  npx tsx scripts/scout-cli.ts generate --top-n 30 --level 10 --locked-trait TFT17_DarkStar:4 --seed 0 2>&1 \
  | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log("valid:",j.filtered.afterValidComps);'
```

Expected: `valid: 14` (14 is the current DarkStar:4 baseline — any value ≥ 14 passes).

```bash
# Multi-lock with emblem
SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 \
  npx tsx scripts/scout-cli.ts generate --top-n 30 --level 10 --locked-trait TFT17_ShieldTank:6 --locked-trait TFT17_RangedTrait:4 --emblem TFT17_RangedTrait:1 --seed 0 2>&1 \
  | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log("valid:",j.filtered.afterValidComps);'
```

Expected: `valid: 15` (15 is the current post-fix baseline — any value ≥ 15 passes).

- [ ] **Step 2: Verify types + lint one more time**

Run: `npm run types:check && npm run lint:check`
Expected: both exit 0, no output.

- [ ] **Step 3: Stop — hand off to Phase B**

No commit in this task. Phase A is complete when:

1. All prior tasks committed
2. Regression sweep in Step 1 is green
3. Types + lint green
4. Both reports exist at `docs/superpowers/research/scout-perf-2026-04-14.md` and `docs/superpowers/research/scout-code-audit-2026-04-14.md`

The next session should:

1. Read both reports
2. Open `docs/superpowers/specs/2026-04-14-scout-perf-sprint-design.md`
3. Append a new `## Phase B — Concrete fix list` section with the data-driven fix ordering (impact × risk × effort rubric from the spec)
4. Commit the updated spec
5. Request user review
6. Only after user approval, write the Phase C+D implementation plan and start executing fixes

Do **not** start any Phase C implementation work in the same session as Phase A completion. The user-review stop between A and B is the whole point of the profile-first approach.
