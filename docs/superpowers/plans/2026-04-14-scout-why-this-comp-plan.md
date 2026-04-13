# Scout "Why this comp?" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collapsible "Why this comp?" panel to every scout result card, showing plain-language strengths and concerns derived from MetaTFT data.

**Architecture:** Worker produces structured insight items (discriminated union by `kind`) inside each `ScoredTeam`; React component renders them to JSX via a `kind`-switch. Rules live in a single pure function; thresholds live in a single config file.

**Tech Stack:** TypeScript (strict), React 19 + Shadcn `accordion` (already installed), Web Worker messaging via existing `use-scout-worker` hook. No test runner — verification via `tsc --noEmit`, a small DevTools sanity script, and manual browser check.

**Spec:** `docs/superpowers/specs/2026-04-14-scout-why-this-comp-design.md` — read it first; every rule's trigger condition and thresholds are listed there and this plan does not duplicate them.

---

## File Map

### New files

- `resources/js/workers/scout/insights-config.ts` — single default-exported object with all thresholds (~20 lines).
- `resources/js/workers/scout/team-insights.ts` — `buildTeamInsights(team, ctx, batchMedianScore): TeamInsights` pure function (~250 lines, twelve rule helpers).
- `resources/js/components/scout/WhyThisComp.tsx` — React component, Shadcn `<Accordion>` with a single item, renders two sections via a `kind`-switch (~200 lines including render cases).

### Modified files

- `resources/js/workers/scout/types.ts` — add `InsightItem` discriminated union, `TeamInsights` type, nullable `insights` field on `ScoredTeam`.
- `resources/js/workers/scout/engine.ts` — after the scoring loop, compute `batchMedianScore`, then call `buildTeamInsights()` per team and attach to the result.
- `resources/js/components/scout/ScoutCompCard.tsx` — render `<WhyThisComp insights={team.insights} />` below the traits row.

---

## Task 1: Types + config

**Files:**
- Modify: `resources/js/workers/scout/types.ts` (append to end)
- Create: `resources/js/workers/scout/insights-config.ts`

- [ ] **Step 1: Add insight types to `types.ts`**

Append at the end of `resources/js/workers/scout/types.ts`:

```ts
// ── "Why this comp?" insights ────────────────────
// Produced by the worker (see team-insights.ts) and rendered by
// WhyThisComp.tsx. Discriminated union lets the UI switch on `kind`
// without needing any string parsing.

export type InsightItem =
    | { kind: 'metaMatch'; compName: string; avgPlace: number; games: number }
    | { kind: 'topCarry'; championApiName: string; displayName: string; avgPlace: number; games: number }
    | { kind: 'strongTrait'; traitApiName: string; displayName: string; count: number; avgPlace: number; games: number }
    | { kind: 'affinityHit'; championApiName: string; championName: string; traitApiName: string; traitName: string; avgPlace: number }
    | { kind: 'provenPair'; aApi: string; aName: string; bApi: string; bName: string; avgPlace: number }
    | { kind: 'highBreakpoint'; traitApiName: string; displayName: string; count: number; avgPlace: number }
    | { kind: 'weakChampion'; championApiName: string; championName: string; avgPlace: number; reasonTraitName: string }
    | { kind: 'lowBreakpoint'; traitApiName: string; displayName: string; count: number; avgPlace: number }
    | { kind: 'unprovenTrait'; traitApiName: string; displayName: string; games: number }
    | { kind: 'singleCore'; traitApiName: string; displayName: string }
    | { kind: 'noMetaMatch' }
    | { kind: 'staleData' };

export type TeamInsights = {
    strengths: InsightItem[];
    concerns: InsightItem[];
};
```

Then find the existing `ScoredTeam` type (currently ends with `metaMatch: { id: string; name: string; similarity: number } | null;`) and add one more field before the closing brace:

```ts
export type ScoredTeam = {
    // ...existing fields...
    metaMatch: { id: string; name: string; similarity: number } | null;
    insights: TeamInsights | null;
};
```

- [ ] **Step 2: Create `insights-config.ts`**

Create `resources/js/workers/scout/insights-config.ts`:

```ts
// Single source of truth for every threshold used by team-insights.ts.
// Keeping it one file makes tuning cheap — change a number, reload,
// re-run scout. See docs/superpowers/specs/2026-04-14-scout-why-this-comp-design.md
// for the reasoning behind each value and the ones marked for
// empirical tuning.

export const INSIGHTS_CONFIG = {
    metaMatch: {
        minOverlapPct: 0.7,
        maxAvgPlace: 4.2,
    },
    topCarry: {
        maxAvgPlace: 3.5,
        minGames: 200,
    },
    strongTrait: {
        maxAvgPlace: 3.8,
        minGames: 500,
    },
    affinityHit: {
        maxAvgPlace: 3.8,
        topN: 3,
    },
    provenPair: {
        maxAvgPlace: 3.8,
        minGames: 150,
        topN: 3,
    },
    highBreakpoint: {
        maxAvgPlace: 4.0,
    },
    weakChampion: {
        minAvgPlace: 4.6,
        minGames: 200,
        minCost: 2,
    },
    lowBreakpoint: {
        minAvgPlace: 4.4,
    },
    unprovenTrait: {
        maxGames: 100,
    },
    noMetaMatch: {
        minOverlapPctIgnore: 0.4,
    },
} as const;
```

- [ ] **Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: no errors. New types compile cleanly on their own.

- [ ] **Step 4: Commit**

```bash
git add resources/js/workers/scout/types.ts resources/js/workers/scout/insights-config.ts
git commit -m "$(cat <<'EOF'
feat(scout): add InsightItem/TeamInsights types + config

Introduces the discriminated union + tunable threshold file that
the upcoming buildTeamInsights() function will produce. ScoredTeam
gains a nullable insights field so worker responses without the new
field still parse.

Spec: docs/superpowers/specs/2026-04-14-scout-why-this-comp-design.md

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `team-insights.ts` — strength rules

**Files:**
- Create: `resources/js/workers/scout/team-insights.ts`

- [ ] **Step 1: Create the file skeleton with imports + signature + helpers**

Create `resources/js/workers/scout/team-insights.ts`:

```ts
// Pure function that inspects a scored team and builds a list of
// player-facing strength/concern insights from the scoring context.
// See docs/superpowers/specs/2026-04-14-scout-why-this-comp-design.md
// for the rule table and thresholds.

import type {
    InsightItem,
    MetaCompEntry,
    ScoredTeam,
    ScoringContext,
    TeamInsights,
} from './types';
import { INSIGHTS_CONFIG } from './insights-config';

const CFG = INSIGHTS_CONFIG;

// ── Helpers ─────────────────────────────────────

// Champions with variants (Miss Fortune Conduit/Challenger, Galio
// Enhanced) share a single MetaTFT row keyed by the base apiName.
// The scorer uses exactly this pattern — mirror it so insights
// talk about the same numbers the algorithm used.
function lookupApi(champion: { apiName: string; baseApiName: string | null }): string {
    return champion.baseApiName || champion.apiName;
}

// Active breakpoint index for a trait given its count. Returns -1
// if no breakpoint is reached (inactive). Iterates from the top
// down so the highest satisfied breakpoint wins.
function activeBreakpointIdx(count: number, breakpoints: { minUnits: number }[]): number {
    const sorted = [...breakpoints].sort((a, b) => a.minUnits - b.minUnits);
    for (let i = sorted.length - 1; i >= 0; i--) {
        if (count >= sorted[i].minUnits) return i;
    }
    return -1;
}

// Pair key for dedupe — sort two apiNames so {A,B} and {B,A} collapse.
function pairKey(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// ── Entry point ─────────────────────────────────

export function buildTeamInsights(
    team: ScoredTeam,
    ctx: ScoringContext,
    batchMedianScore: number,
): TeamInsights {
    const strengths: InsightItem[] = [];
    const concerns: InsightItem[] = [];

    // Rules fire by appending to strengths/concerns. Each rule is
    // a small function below that reads from `team` + `ctx` and
    // decides on its own whether to push.

    pushMetaMatch(team, ctx, strengths);
    pushTopCarry(team, ctx, strengths);
    pushStrongTrait(team, ctx, strengths);
    pushAffinityHit(team, ctx, strengths);
    pushProvenPair(team, ctx, strengths);
    pushHighBreakpoint(team, ctx, strengths);

    pushWeakChampion(team, ctx, concerns);
    pushLowBreakpoint(team, ctx, concerns);
    pushUnprovenTrait(team, ctx, concerns);
    pushSingleCore(team, concerns);
    pushNoMetaMatch(team, ctx, batchMedianScore, concerns);
    pushStaleData(ctx, concerns);

    return { strengths, concerns };
}

// ── Strength rules ──────────────────────────────
// (Implemented in subsequent steps.)

function pushMetaMatch(team: ScoredTeam, ctx: ScoringContext, out: InsightItem[]): void {
    // TODO — implemented in Step 2.
}
function pushTopCarry(team: ScoredTeam, ctx: ScoringContext, out: InsightItem[]): void {
    // TODO
}
function pushStrongTrait(team: ScoredTeam, ctx: ScoringContext, out: InsightItem[]): void {
    // TODO
}
function pushAffinityHit(team: ScoredTeam, ctx: ScoringContext, out: InsightItem[]): void {
    // TODO
}
function pushProvenPair(team: ScoredTeam, ctx: ScoringContext, out: InsightItem[]): void {
    // TODO
}
function pushHighBreakpoint(team: ScoredTeam, ctx: ScoringContext, out: InsightItem[]): void {
    // TODO
}

// ── Concern rules ───────────────────────────────

function pushWeakChampion(team: ScoredTeam, ctx: ScoringContext, out: InsightItem[]): void {
    // TODO — implemented in Task 3.
}
function pushLowBreakpoint(team: ScoredTeam, ctx: ScoringContext, out: InsightItem[]): void {
    // TODO — implemented in Task 3.
}
function pushUnprovenTrait(team: ScoredTeam, ctx: ScoringContext, out: InsightItem[]): void {
    // TODO — implemented in Task 3.
}
function pushSingleCore(team: ScoredTeam, out: InsightItem[]): void {
    // TODO — implemented in Task 3.
}
function pushNoMetaMatch(team: ScoredTeam, ctx: ScoringContext, median: number, out: InsightItem[]): void {
    // TODO — implemented in Task 3.
}
function pushStaleData(ctx: ScoringContext, out: InsightItem[]): void {
    // TODO — implemented in Task 3.
}
```

Note: the TODO stubs exist so `tsc` stays green while later steps fill them. Every stub has the exact signature the entry point calls.

- [ ] **Step 2: Implement `pushMetaMatch`**

Replace the `pushMetaMatch` stub with:

```ts
function pushMetaMatch(team: ScoredTeam, ctx: ScoringContext, out: InsightItem[]): void {
    const teamApis = new Set(team.champions.map(c => lookupApi(c)));
    let best: { meta: MetaCompEntry; overlap: number } | null = null;

    for (const meta of ctx.metaComps ?? []) {
        if (meta.avgPlace > CFG.metaMatch.maxAvgPlace) continue;
        const units: string[] = (meta as any).units ?? (meta as any).champs ?? [];
        if (units.length === 0) continue;
        const overlapCount = units.filter(u => teamApis.has(u)).length;
        const overlapPct = overlapCount / units.length;
        if (overlapPct < CFG.metaMatch.minOverlapPct) continue;
        if (!best || overlapCount > best.overlap) {
            best = { meta, overlap: overlapCount };
        }
    }

    if (best) {
        out.push({
            kind: 'metaMatch',
            compName: best.meta.name,
            avgPlace: best.meta.avgPlace,
            games: best.meta.games,
        });
    }
}
```

Why the `units ?? champs` fallback: an older worker build or cached context payload may still carry `champs`, the key the builder used before the bug fix. Belt-and-braces.

- [ ] **Step 3: Implement `pushTopCarry`**

Replace the stub with:

```ts
function pushTopCarry(team: ScoredTeam, ctx: ScoringContext, out: InsightItem[]): void {
    const seen = new Set<string>();
    for (const champ of team.champions) {
        const api = lookupApi(champ);
        if (seen.has(api)) continue;
        seen.add(api);
        const rating = ctx.unitRatings?.[api];
        if (!rating) continue;
        if (rating.games < CFG.topCarry.minGames) continue;
        if (rating.avgPlace > CFG.topCarry.maxAvgPlace) continue;
        out.push({
            kind: 'topCarry',
            championApiName: api,
            displayName: champ.name,
            avgPlace: rating.avgPlace,
            games: rating.games,
        });
    }
}
```

- [ ] **Step 4: Implement `pushStrongTrait`**

Replace the stub with:

```ts
function pushStrongTrait(team: ScoredTeam, ctx: ScoringContext, out: InsightItem[]): void {
    for (const trait of team.activeTraits) {
        if (trait.breakpoint == null) continue;
        const rating = ctx.traitRatings?.[trait.apiName]?.[trait.breakpoint];
        if (!rating) continue;
        if (rating.games < CFG.strongTrait.minGames) continue;
        if (rating.avgPlace > CFG.strongTrait.maxAvgPlace) continue;
        out.push({
            kind: 'strongTrait',
            traitApiName: trait.apiName,
            displayName: trait.name,
            count: trait.count,
            avgPlace: rating.avgPlace,
            games: rating.games,
        });
    }
}
```

- [ ] **Step 5: Implement `pushAffinityHit`**

Replace the stub with:

```ts
function pushAffinityHit(team: ScoredTeam, ctx: ScoringContext, out: InsightItem[]): void {
    const activeTraitsByApi = new Map(team.activeTraits.map(t => [t.apiName, t]));

    for (const champ of team.champions) {
        const api = lookupApi(champ);
        const rows = ctx.affinity?.[api];
        if (!rows || rows.length === 0) continue;
        const topN = [...rows]
            .sort((a, b) => a.avgPlace - b.avgPlace)
            .slice(0, CFG.affinityHit.topN);
        for (const row of topN) {
            const active = activeTraitsByApi.get(row.trait);
            if (!active) continue;
            if (row.avgPlace > CFG.affinityHit.maxAvgPlace) continue;
            out.push({
                kind: 'affinityHit',
                championApiName: api,
                championName: champ.name,
                traitApiName: row.trait,
                traitName: active.name,
                avgPlace: row.avgPlace,
            });
            break; // one affinityHit per champion; best hit wins
        }
    }
}
```

- [ ] **Step 6: Implement `pushProvenPair`**

Replace the stub with:

```ts
function pushProvenPair(team: ScoredTeam, ctx: ScoringContext, out: InsightItem[]): void {
    const teamByApi = new Map<string, { api: string; name: string }>();
    for (const c of team.champions) {
        const api = lookupApi(c);
        if (!teamByApi.has(api)) teamByApi.set(api, { api, name: c.name });
    }

    const firedPairs = new Set<string>();

    for (const { api: aApi, name: aName } of teamByApi.values()) {
        const rows = ctx.companions?.[aApi];
        if (!rows) continue;
        const topN = [...rows]
            .sort((x, y) => x.avgPlace - y.avgPlace)
            .slice(0, CFG.provenPair.topN);
        for (const row of topN) {
            const B = teamByApi.get(row.companion);
            if (!B) continue;
            if (B.api === aApi) continue;
            if (row.games < CFG.provenPair.minGames) continue;
            if (row.avgPlace > CFG.provenPair.maxAvgPlace) continue;
            const key = pairKey(aApi, B.api);
            if (firedPairs.has(key)) continue;
            firedPairs.add(key);
            out.push({
                kind: 'provenPair',
                aApi,
                aName,
                bApi: B.api,
                bName: B.name,
                avgPlace: row.avgPlace,
            });
        }
    }
}
```

- [ ] **Step 7: Implement `pushHighBreakpoint`**

Replace the stub with:

```ts
function pushHighBreakpoint(team: ScoredTeam, ctx: ScoringContext, out: InsightItem[]): void {
    const strongTraitApis = new Set(
        out
            .filter((i): i is Extract<InsightItem, { kind: 'strongTrait' }> => i.kind === 'strongTrait')
            .map(i => i.traitApiName),
    );

    for (const trait of team.activeTraits) {
        if (strongTraitApis.has(trait.apiName)) continue;
        const idx = activeBreakpointIdx(trait.count, trait.breakpoints as any);
        if (idx < 1) continue; // needs 2nd breakpoint or higher
        const rating = ctx.traitRatings?.[trait.apiName]?.[idx + 1];
        if (!rating) continue;
        if (rating.avgPlace > CFG.highBreakpoint.maxAvgPlace) continue;
        out.push({
            kind: 'highBreakpoint',
            traitApiName: trait.apiName,
            displayName: trait.name,
            count: trait.count,
            avgPlace: rating.avgPlace,
        });
    }
}
```

Note the use of `out` directly — this rule must run AFTER `pushStrongTrait` so the precedence check sees already-fired items. The entry point already calls them in that order.

`trait.breakpoints` is not declared on `ScoredActiveTrait` in `types.ts` today — it lives in the internal ported object. The `as any` cast mirrors the same pattern in `scorer.ts:308`. Leaving as-is per "follow existing patterns" rule.

- [ ] **Step 8: Type check**

Run: `npx tsc --noEmit`
Expected: no errors. Concerns stubs still present — that's fine, they type-check because they return `void`.

- [ ] **Step 9: Commit**

```bash
git add resources/js/workers/scout/team-insights.ts
git commit -m "$(cat <<'EOF'
feat(scout): add team-insights strength rules

Implements buildTeamInsights() with six strength rules: metaMatch,
topCarry, strongTrait, affinityHit, provenPair, highBreakpoint.
Concern rules stubbed for the next task. Thresholds read from
insights-config.ts.

Rules are isolated helpers that append to a shared out array so
precedence (highBreakpoint checks already-pushed strongTrait) is
just a list scan.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `team-insights.ts` — concern rules

**Files:**
- Modify: `resources/js/workers/scout/team-insights.ts`

- [ ] **Step 1: Implement `pushWeakChampion`**

Replace the `pushWeakChampion` stub with:

```ts
function pushWeakChampion(team: ScoredTeam, ctx: ScoringContext, out: InsightItem[]): void {
    const activeTraitSet = new Set(team.activeTraits.map(t => t.apiName));
    const activeTraitNames = new Map(team.activeTraits.map(t => [t.apiName, t.name]));
    const seen = new Set<string>();

    for (const champ of team.champions) {
        const api = lookupApi(champ);
        if (seen.has(api)) continue;
        seen.add(api);
        if (champ.cost < CFG.weakChampion.minCost) continue;
        const rating = ctx.unitRatings?.[api];
        if (!rating) continue;
        if (rating.games < CFG.weakChampion.minGames) continue;
        if (rating.avgPlace < CFG.weakChampion.minAvgPlace) continue;

        const reasonTraitApi = champ.traits.find(t => activeTraitSet.has(t)) ?? champ.traits[0] ?? '';
        const reasonTraitName = activeTraitNames.get(reasonTraitApi) ?? reasonTraitApi;

        out.push({
            kind: 'weakChampion',
            championApiName: api,
            championName: champ.name,
            avgPlace: rating.avgPlace,
            reasonTraitName,
        });
    }
}
```

- [ ] **Step 2: Implement `pushLowBreakpoint`**

Replace the stub with:

```ts
function pushLowBreakpoint(team: ScoredTeam, ctx: ScoringContext, out: InsightItem[]): void {
    for (const trait of team.activeTraits) {
        const idx = activeBreakpointIdx(trait.count, trait.breakpoints as any);
        if (idx !== 0) continue; // only fires when trait sits on its lowest active breakpoint
        const rating = ctx.traitRatings?.[trait.apiName]?.[1];
        if (!rating) continue;
        if (rating.avgPlace < CFG.lowBreakpoint.minAvgPlace) continue;
        out.push({
            kind: 'lowBreakpoint',
            traitApiName: trait.apiName,
            displayName: trait.name,
            count: trait.count,
            avgPlace: rating.avgPlace,
        });
    }
}
```

- [ ] **Step 3: Implement `pushUnprovenTrait`**

Replace the stub with:

```ts
function pushUnprovenTrait(team: ScoredTeam, ctx: ScoringContext, out: InsightItem[]): void {
    for (const trait of team.activeTraits) {
        if (trait.breakpoint == null) continue;
        const rating = ctx.traitRatings?.[trait.apiName]?.[trait.breakpoint];
        if (!rating) continue;
        if (rating.games >= CFG.unprovenTrait.maxGames) continue;
        out.push({
            kind: 'unprovenTrait',
            traitApiName: trait.apiName,
            displayName: trait.name,
            games: rating.games,
        });
    }
}
```

- [ ] **Step 4: Implement `pushSingleCore`**

Replace the stub with:

```ts
function pushSingleCore(team: ScoredTeam, out: InsightItem[]): void {
    const highBp = team.activeTraits.filter(t => {
        const idx = activeBreakpointIdx(t.count, t.breakpoints as any);
        return idx >= 1;
    });
    if (highBp.length === 1) {
        const only = highBp[0];
        out.push({
            kind: 'singleCore',
            traitApiName: only.apiName,
            displayName: only.name,
        });
    }
}
```

- [ ] **Step 5: Implement `pushNoMetaMatch`**

Replace the stub with:

```ts
function pushNoMetaMatch(
    team: ScoredTeam,
    ctx: ScoringContext,
    median: number,
    out: InsightItem[],
): void {
    if (team.score >= median) return; // only experimental-looking, below-median teams

    const teamApis = new Set(team.champions.map(c => lookupApi(c)));
    for (const meta of ctx.metaComps ?? []) {
        const units: string[] = (meta as any).units ?? (meta as any).champs ?? [];
        if (units.length === 0) continue;
        const overlap = units.filter(u => teamApis.has(u)).length / units.length;
        if (overlap >= CFG.noMetaMatch.minOverlapPctIgnore) return; // has some meta match, bail
    }

    out.push({ kind: 'noMetaMatch' });
}
```

- [ ] **Step 6: Implement `pushStaleData`**

Replace the stub with:

```ts
function pushStaleData(ctx: ScoringContext, out: InsightItem[]): void {
    if ((ctx as any).stale === true) {
        out.push({ kind: 'staleData' });
    }
}
```

The `ctx as any` cast is because `ScoringContext` does not declare a `stale` field today — the flag actually lives on the outer `ScoutContext`. The worker will need to pass it through. The engine wiring step (Task 4) handles this by augmenting the context before it reaches `buildTeamInsights`.

- [ ] **Step 7: Type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add resources/js/workers/scout/team-insights.ts
git commit -m "$(cat <<'EOF'
feat(scout): add team-insights concern rules

Adds the six concern rules: weakChampion, lowBreakpoint,
unprovenTrait, singleCore, noMetaMatch, staleData. buildTeamInsights
is now complete and deterministic given (team, ctx, batchMedian).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Wire into `engine.ts`

**Files:**
- Modify: `resources/js/workers/scout/engine.ts`

**Context for this task:**

- `engine.ts` has `// @ts-nocheck` at the top — the file is untyped on purpose (ported 1:1 from legacy JS). No `as any` casts needed; just write plain JS-ish code.
- `engine.ts` exports `generate(input)` taking a single input object with `{ champions, traits, scoringCtx, constraints, exclusionGroups, level, topN, seed }`.
- `index.ts:90` calls `generate({ champions: ctx.champions, ..., scoringCtx: ctx.scoringCtx, ... })`. The caller has `ctx.stale` available via the `ScoutContext` type — we pass it through as a new `stale` field on the input object.
- The scoring loop in `engine.ts` builds `enriched` then filters to `validComps`. Insights attach AFTER filtering so dropped teams don't waste cycles.

- [ ] **Step 1: Add `stale` to the `generate()` call in index.ts**

In `resources/js/workers/scout/index.ts`, find the `generate({ ... })` call around line 90 and add one field:

```ts
    const results = generate({
        champions: ctx.champions,
        traits: ctx.traits,
        scoringCtx: ctx.scoringCtx,
        constraints,
        exclusionGroups: ctx.exclusionGroups,
        level,
        topN,
        seed,
        stale: ctx.stale,
    });
```

- [ ] **Step 2: Add import + destructure `stale` in engine.ts**

At the top of `resources/js/workers/scout/engine.ts`, below the existing imports, add:

```ts
import { buildTeamInsights } from './team-insights';
```

In the same file, find the destructure block inside `generate(input)`:

```js
  const {
    champions,
    traits,
    scoringCtx = {},
    constraints = {},
    exclusionGroups = [],
    level = 8,
    topN = 10,
    seed = 0,
  } = input;
```

Add one line:

```js
  const {
    champions,
    traits,
    scoringCtx = {},
    constraints = {},
    exclusionGroups = [],
    level = 8,
    topN = 10,
    seed = 0,
    stale = false,
  } = input;
```

- [ ] **Step 3: Compute batch median + attach insights**

Find the line in `engine.ts` that reads `validComps.sort((a, b) => b.score - a.score);`. Immediately BEFORE that sort, insert:

```js
  // Compute batch median so the `noMetaMatch` concern rule can
  // decide which teams look "experimental" (below median) vs
  // just variants of a meta build.
  const scoresAsc = validComps.map(t => t.score).sort((a, b) => a - b);
  const batchMedianScore = scoresAsc.length === 0
    ? 0
    : scoresAsc[Math.floor(scoresAsc.length / 2)];

  // stale lives on ScoutContext, not ScoringContext — fold it in
  // so the staleData rule can read it through the same object.
  const ctxForInsights = { ...scoringCtx, stale };

  for (const team of validComps) {
    team.insights = buildTeamInsights(team, ctxForInsights, batchMedianScore);
  }
```

- [ ] **Step 4: Type check**

Run: `npx tsc --noEmit`
Expected: no errors. `engine.ts` is `@ts-nocheck` so its body is invisible to `tsc`, but `team-insights.ts` and `types.ts` (strictly typed) must still compile, and the import chain is checked end-to-end.

- [ ] **Step 5: Build check**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add resources/js/workers/scout/engine.ts resources/js/workers/scout/index.ts
git commit -m "$(cat <<'EOF'
feat(scout): attach insights to every scored team in the engine

Computes batch-median score once per run and feeds each team
through buildTeamInsights along with a stale-augmented context.
Insights ride on ScoredTeam.insights across the worker boundary.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `WhyThisComp.tsx` component

**Files:**
- Create: `resources/js/components/scout/WhyThisComp.tsx`

- [ ] **Step 1: Verify Shadcn accordion is installed**

Run: `ls resources/js/components/ui/accordion.tsx`
Expected: file exists (it does, verified 2026-04-14).

If it doesn't exist, run: `npx shadcn@latest add accordion` before continuing.

- [ ] **Step 2: Create `WhyThisComp.tsx`**

Create `resources/js/components/scout/WhyThisComp.tsx`:

```tsx
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from '@/components/ui/accordion';
import type { InsightItem, TeamInsights } from '@/workers/scout/types';

type Props = {
    insights: TeamInsights | null;
};

// Render one insight as a single list item. Discriminated-union switch
// means every kind must be handled — TypeScript catches a missing case.
function renderInsight(item: InsightItem): React.ReactNode {
    switch (item.kind) {
        case 'metaMatch':
            return (
                <>
                    Matches meta comp <strong>{item.compName}</strong> ({fmtAvg(item.avgPlace)} avg, {fmtGames(item.games)} games)
                </>
            );
        case 'topCarry':
            return (
                <>
                    <ChampIcon api={item.championApiName} />{' '}
                    <strong>{item.displayName}</strong> is a top carry this patch ({fmtAvg(item.avgPlace)} avg, {fmtGames(item.games)} games)
                </>
            );
        case 'strongTrait':
            return (
                <>
                    <TraitIcon api={item.traitApiName} />{' '}
                    <strong>{item.displayName} {item.count}</strong> is a strong trait ({fmtAvg(item.avgPlace)} avg across {fmtGames(item.games)} games)
                </>
            );
        case 'affinityHit':
            return (
                <>
                    <ChampIcon api={item.championApiName} />{' '}
                    <strong>{item.championName}</strong> performs best in{' '}
                    <TraitIcon api={item.traitApiName} /> <strong>{item.traitName}</strong> ({fmtAvg(item.avgPlace)} avg)
                </>
            );
        case 'provenPair':
            return (
                <>
                    <ChampIcon api={item.aApi} />{' '}
                    <strong>{item.aName} + {item.bName}</strong>{' '}
                    <ChampIcon api={item.bApi} /> — proven duo ({fmtAvg(item.avgPlace)} avg when together)
                </>
            );
        case 'highBreakpoint':
            return (
                <>
                    <TraitIcon api={item.traitApiName} />{' '}
                    <strong>{item.displayName} {item.count}</strong> — peak breakpoint, consistently top 4
                </>
            );
        case 'weakChampion':
            return (
                <>
                    <ChampIcon api={item.championApiName} />{' '}
                    <strong>{item.championName}</strong> struggles this patch ({fmtAvg(item.avgPlace)} avg) — held for {item.reasonTraitName} count
                </>
            );
        case 'lowBreakpoint':
            return (
                <>
                    <TraitIcon api={item.traitApiName} />{' '}
                    <strong>{item.displayName} {item.count}</strong> — weakest breakpoint, low impact
                </>
            );
        case 'unprovenTrait':
            return (
                <>
                    <TraitIcon api={item.traitApiName} />{' '}
                    <strong>{item.displayName}</strong> — too few games to know if it works ({fmtGames(item.games)})
                </>
            );
        case 'singleCore':
            return (
                <>
                    Comp leans on <TraitIcon api={item.traitApiName} />{' '}
                    <strong>{item.displayName}</strong> alone — no backup synergy
                </>
            );
        case 'noMetaMatch':
            return <>Experimental build — no matching meta comp on MetaTFT</>;
        case 'staleData':
            return <>MetaTFT data is over 24h old — numbers may be outdated</>;
    }
}

function ChampIcon({ api }: { api: string }) {
    return (
        <img
            src={`/icons/champions/${api}.png`}
            alt=""
            className="inline-block size-4 align-middle"
            loading="lazy"
        />
    );
}

function TraitIcon({ api }: { api: string }) {
    return (
        <img
            src={`/icons/traits/${api}.png`}
            alt=""
            className="inline-block size-4 align-middle"
            loading="lazy"
        />
    );
}

function fmtAvg(n: number): string {
    return n.toFixed(2);
}

function fmtGames(n: number): string {
    return n.toLocaleString('en-US');
}

export function WhyThisComp({ insights }: Props) {
    const strengths = insights?.strengths ?? [];
    const concerns = insights?.concerns ?? [];
    const empty = strengths.length === 0 && concerns.length === 0;

    return (
        <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="why">
                <AccordionTrigger className="text-sm" disabled={empty}>
                    {empty ? 'No insights for this comp' : 'Why this comp?'}
                </AccordionTrigger>
                <AccordionContent>
                    <div className="flex flex-col gap-4 pt-2 text-sm">
                        {strengths.length > 0 && (
                            <section>
                                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-emerald-400">
                                    💪 Strengths
                                </h4>
                                <ul className="flex flex-col gap-1 text-muted-foreground">
                                    {strengths.map((item, i) => (
                                        <li key={i} className="leading-snug">
                                            {renderInsight(item)}
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}
                        {concerns.length > 0 && (
                            <section>
                                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-amber-400">
                                    ⚠️ Concerns
                                </h4>
                                <ul className="flex flex-col gap-1 text-muted-foreground">
                                    {concerns.map((item, i) => (
                                        <li key={i} className="leading-snug">
                                            {renderInsight(item)}
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}
                    </div>
                </AccordionContent>
            </AccordionItem>
        </Accordion>
    );
}
```

- [ ] **Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: no errors. If the switch is missing a case, TypeScript will say "Type 'InsightItem' is not assignable to type 'never'" — add the missing case.

- [ ] **Step 4: Commit**

```bash
git add resources/js/components/scout/WhyThisComp.tsx
git commit -m "$(cat <<'EOF'
feat(scout): add WhyThisComp accordion component

Renders a single Shadcn accordion per comp with two sections
(Strengths / Concerns). Discriminated-union switch over InsightItem
means every new insight kind breaks the build until it's handled.

Champion and trait icons render inline using the same path
convention as ScoutCompCard.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Wire into `ScoutCompCard` + browser check

**Files:**
- Modify: `resources/js/components/scout/ScoutCompCard.tsx`

- [ ] **Step 1: Add import**

At the top of `ScoutCompCard.tsx`, add:

```tsx
import { WhyThisComp } from './WhyThisComp';
```

- [ ] **Step 2: Render the component at the bottom of the card**

Find the closing `</Card>` tag in `ScoutCompCard.tsx`. Immediately before it, add:

```tsx
            <WhyThisComp insights={team.insights} />
```

Full change context — the last block of the return statement should go from:

```tsx
            <div className="flex flex-wrap gap-1">
                {team.activeTraits.map((t) => {
                    /* ... */
                })}
            </div>
        </Card>
```

to:

```tsx
            <div className="flex flex-wrap gap-1">
                {team.activeTraits.map((t) => {
                    /* ... */
                })}
            </div>
            <WhyThisComp insights={team.insights} />
        </Card>
```

- [ ] **Step 3: Type check + build**

Run: `npx tsc --noEmit && npm run build`
Expected: both pass.

- [ ] **Step 4: Manual browser verification**

Start the dev server if not running: `npm run dev`

Open the scout page in the browser. Run a scout generation.

Verify each of the following in order (each is a separate check):

1. **Accordion appears** on every comp card. Default collapsed.
2. **Click expand** on the first comp. Text is readable, no `undefined`, no `NaN`, no raw `TFT17_X` apiNames visible in user-facing text.
3. **Icons render** — champion and trait icons load from `/icons/champions/*.png` and `/icons/traits/*.png`. Missing icons show broken-image placeholders (expected — icons for edge-case champions may not exist in `public/icons/`).
4. **Strengths-only comp exists** — scroll to find a high-score comp that only has strengths (no concerns section rendered).
5. **Concerns appear** — find a comp with at least one concern. Verify both headers render.
6. **Stale data toast** — if the MetaTFT sync is ≥24h old, `staleData` concern fires on every comp. (Not blocking; if fresh data is cached, skip.)
7. **No meta match** — low-score experimental comps show `noMetaMatch` concern.

Spot-check the sentences for grammar and tone. If any sound robotic or wrong, fix the template in `renderInsight()` (same file) — no need to re-run build, Vite HMR will pick it up.

- [ ] **Step 5: Commit**

```bash
git add resources/js/components/scout/ScoutCompCard.tsx
git commit -m "$(cat <<'EOF'
feat(scout): wire WhyThisComp into the result card

Mounts the insights accordion under the traits row on every
ScoutCompCard. The feature is now live end-to-end: worker
generates insights, component renders them, default collapsed.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Verification checklist (post-implementation)

- [ ] `npx tsc --noEmit` passes
- [ ] `npm run build` passes
- [ ] Scout runs in `npm run dev`, every comp card shows "Why this comp?" trigger
- [ ] Expanding a meta-matched comp shows the `metaMatch` insight with correct name/avg/games
- [ ] Expanding an experimental comp shows `noMetaMatch`
- [ ] Expanding a comp with a known weak champion shows `weakChampion` with a reason trait
- [ ] No `NaN`, `undefined`, or raw apiNames leaked into user-facing text
- [ ] Stale banner (`ctx.stale`) correlates with `staleData` insight on all comps when MetaTFT data is old

## Rollback

If insights break in production:

1. Revert the last commit (`ScoutCompCard.tsx` wiring). The component still exists but renders nowhere.
2. Build + redeploy. Feature is invisible, rest of scout keeps working.

If a deeper issue surfaces (e.g. worker crash on `buildTeamInsights`), revert all six commits in order. Zero backend impact — no migration, no API change, no cache to invalidate.
