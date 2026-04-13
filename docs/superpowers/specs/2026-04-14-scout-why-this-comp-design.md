# Scout "Why this comp?" — player-facing insights accordion

> Status: design, approved 2026-04-14
> Author: brainstorm between Borcioo and Claude
> Target: `resources/js/workers/scout/` + `resources/js/components/scout/`

## Problem

The scout page lists top teams with a numeric score and a trait/champion strip, but gives the player zero information about **why** a specific team scored high. When a player sees "8 Mecha + Rammus at 67.4 pts" they have to guess whether the score comes from a known meta comp, a proven carry, strong trait breakpoints, or just a lucky combination of weak bonuses.

The scoring breakdown that already lives in `scorer.ts` (`teamScoreBreakdown()`) exposes per-category points (champions, traits, affinity, companions, synergy, proven, balance, orphan, total) — but the numbers are implementation artifacts. A player does not care that "affinity" contributed 6.2 pts. The player wants to read a few plain sentences explaining the call.

## Goal

Add a per-team collapsible panel — "Why this comp?" — that renders an adaptive list of plain-language insights sourced from the same MetaTFT data the algorithm used. Two sections inside: **Strengths** (things pulling the score up) and **Concerns** (things a careful player should know). Tone is "neighbour who plays this game", not "scoring engine verbose log".

Non-goals:

- No numeric score breakdown exposed to the player. The score column already exists.
- No i18n. Everything English, hardcoded, matching the rest of scout UI.
- No tier-list layout, pie charts, or radar diagrams. Bullets only.
- No per-item edit/tune controls. This is a read-only view.

## Approach

Insights are generated in the worker during the same pass that runs `teamScoreBreakdown()`. The worker produces **structured data** (discriminated union by `kind`), not strings. The React component maps each kind to JSX — icon + bold display name + tail text. Separation matches the project rule "algorithm pure, mappers on the boundary" (memory: `feedback_v2_architecture`).

The insight set is **adaptive** — a comp with a clear thesis may yield three bullets, an experimental one eight. There is no fixed ceiling; each rule either fires or does not, and only firing rules contribute items.

Grouping is **Strengths / Concerns**, not mixed — the player scanning a list often wants "is there something to worry about", and split sections answer that without reading the full list.

The panel is a Shadcn `<Accordion>`, default collapsed, mounted inside `ScoutCompCard` under the traits row. Default-collapsed keeps the list view compact for fast scanning; expanding pulls the full picture for one comp at a time.

## Insight rules

All thresholds live in `insights-config.ts` so they can be tuned without touching rule code. Initial values below are first-pass guesses; many need empirical tuning and are marked with ⓘ.

### Strengths

| `kind` | Trigger | Text template |
|---|---|---|
| `metaMatch` | ≥70% overlap with a `metaComps` entry AND that comp's `avgPlace ≤ 4.2` | "Matches meta comp **{compName}** ({avgPlace} avg, {games} games)" |
| `topCarry` | champion `unitRatings[api].avgPlace ≤ 3.5` AND `games ≥ 200` ⓘ | "**{championName}** is a top carry this patch ({avgPlace} avg, {games} games)" |
| `strongTrait` | active trait at current breakpoint has `traitRatings[api][bp].avgPlace ≤ 3.8` AND `games ≥ 500` ⓘ | "**{traitName} {count}** is a strong trait ({avgPlace} avg across {games} games)" |
| `affinityHit` | for a champion in the team, sort `ctx.affinity[championApiName]` ascending by `avgPlace`, take top 3; fire if any of those top-3 entries' `traitApiName` is active in the team AND that row's `avgPlace ≤ 3.8` | "**{championName}** performs best in **{traitName}** ({avgPlace} avg)" |
| `provenPair` | for a champion A in the team, sort `ctx.companions[A]` ascending by `avgPlace`, take top 3; fire if any of those entries' `companion` apiName is also in the team (champion B) AND the row's `avgPlace ≤ 3.8` AND `games ≥ 150` ⓘ. Each unordered pair {A,B} fires at most once (dedupe by sorted apiName tuple). | "**{championA} + {championB}** — proven duo ({avgPlace} avg when together)" |
| `highBreakpoint` | active trait at 2nd or higher breakpoint AND `avgPlace ≤ 4.0` AND no `strongTrait` already fired for it | "**{traitName} {count}** — peak breakpoint, consistently top 4" |

### Concerns

| `kind` | Trigger | Text template |
|---|---|---|
| `weakChampion` | champion `avgPlace ≥ 4.6` AND `games ≥ 200` AND `cost ≥ 2` (1-cost fillers exempt) ⓘ | "**{championName}** struggles this patch ({avgPlace} avg) — held for {reasonTrait} count" |
| `lowBreakpoint` | active trait only at its lowest breakpoint (`activeIdx === 0`) AND `avgPlace ≥ 4.4` ⓘ | "**{traitName} {count}** — weakest breakpoint, low impact" |
| `unprovenTrait` | active trait breakpoint has `games < 100` ⓘ | "**{traitName}** — too few games to know if it works" |
| `singleCore` | only one active trait at 2nd+ breakpoint across the whole team | "Comp leans on **{traitName}** alone — no backup synergy" |
| `noMetaMatch` | zero `metaComps` matched at ≥40% overlap AND team score is below median of the returned batch | "Experimental build — no matching meta comp on MetaTFT" |
| `staleData` | `ctx.stale === true` | "MetaTFT data is >24h old — numbers may be outdated" |

**Rule precedence:** rules fire independently. When two rules would produce near-duplicate messages (e.g. `strongTrait` and `highBreakpoint` on the same trait), the stronger one wins via explicit check inside `highBreakpoint` ("AND no `strongTrait` already fired for it").

**`reasonTrait` in `weakChampion`:** pick the first active trait the champion contributes to (via `champion.traits ∩ team.activeTraits`). Fallback to the champion's first trait if none overlap (edge case — should not happen for in-team champions).

**Formatting conventions:**

- `avgPlace` rendered with 2 decimals ("3.21"), no units — context makes it clear.
- `games` rendered with thousands separator: "1,520", "15,432". Helper `formatGames(n: number): string`.
- Display names come from `ScoredTeam.champions[].name` / `activeTraits[].name` for in-team references. When the insight refers to a trait or champion not in the team, the worker puts the display name directly on the `InsightItem` (see types below).

## Types

Added to `resources/js/workers/scout/types.ts`:

```ts
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

export type ScoredTeam = {
    // ...existing fields...
    insights: TeamInsights | null;
};
```

`insights` is nullable so an older worker response or a caught exception can set it to `null` without breaking the UI — the component renders nothing in that case.

## File map

### New files

**`resources/js/workers/scout/insights-config.ts`** — single default-exported object with all thresholds. ~20 lines.

```ts
export const INSIGHTS_CONFIG = {
    metaMatch: { minOverlapPct: 0.7, maxAvgPlace: 4.2 },
    topCarry: { maxAvgPlace: 3.5, minGames: 200 },
    strongTrait: { maxAvgPlace: 3.8, minGames: 500 },
    affinityHit: { maxAvgPlace: 3.8 },
    provenPair: { maxAvgPlace: 3.8, minGames: 150 },
    highBreakpoint: { maxAvgPlace: 4.0 },
    weakChampion: { minAvgPlace: 4.6, minGames: 200, minCost: 2 },
    lowBreakpoint: { minAvgPlace: 4.4 },
    unprovenTrait: { maxGames: 100 },
    noMetaMatch: { minOverlapPctIgnore: 0.4 },
} as const;
```

**`resources/js/workers/scout/team-insights.ts`** — pure function.

```ts
export function buildTeamInsights(
    team: ScoredTeamInternal,
    ctx: ScoringContext,
    batchMedianScore: number,
): TeamInsights
```

Takes the scored team, the scoring context, and the batch median score (needed for `noMetaMatch`). Returns `{ strengths, concerns }`. Pure, no side effects, deterministic given inputs. ~200-300 lines, mostly shaped as twelve small `maybePush*` helpers so each rule is isolated and testable.

**`resources/js/components/scout/WhyThisComp.tsx`** — React component.

```tsx
type Props = { insights: TeamInsights | null };
export function WhyThisComp({ insights }: Props) { ... }
```

Uses Shadcn `<Accordion>` with a single `AccordionItem`. Trigger text: "Why this comp?". Content renders two sections:

```
💪 Strengths
  <bullet> <icon> <bold name> <tail text>
  ...

⚠️ Concerns
  <bullet> <icon> <bold name> <tail text>
  ...
```

Empty sections are omitted (e.g. a comp with only strengths shows no "Concerns" header). When both arrays are empty, the trigger renders disabled with helper text "No insights for this comp".

Internally uses a `renderInsight(item: InsightItem): ReactNode` switch that dispatches on `kind` — ~12 cases, each returning a single `<li>` with icon + text. Icons: `/icons/champions/${apiName}.png`, `/icons/traits/${apiName}.png`.

### Changed files

- **`resources/js/workers/scout/engine.ts`** — after the `teamScoreBreakdown()` call in the scoring loop, compute `batchMedianScore` from the intermediate results once, then call `buildTeamInsights(team, scoringCtx, batchMedianScore)` per team and attach. One line per team plus a one-shot median calc.
- **`resources/js/workers/scout/types.ts`** — add `InsightItem`, `TeamInsights`; add `insights: TeamInsights | null` to `ScoredTeam`.
- **`resources/js/components/scout/ScoutCompCard.tsx`** — render `<WhyThisComp insights={team.insights} />` below the traits row.

### Dependencies

Shadcn `accordion` may or may not be installed. Check `resources/js/components/ui/accordion.tsx`; add via `npx shadcn@latest add accordion` if missing.

## Testing

The project has no JS test runner installed — scout algorithm was ported 1:1 from legacy without tests and the rest of `resources/js/` has none either. Adding vitest just for this feature would be scope creep (memory: "don't add features beyond what the task requires").

**Verification plan:**

1. **Type check.** `team-insights.ts` uses the discriminated union `InsightItem` — `tsc --noEmit` fails the build if any `maybePush*` returns the wrong shape or misses a kind field. This is the main safety net.
2. **Manual sanity script.** A small throwaway file `resources/js/workers/scout/__devtools__/insights-sanity.ts` (gitignored? no — committed as `.example.ts`) that constructs three hand-built teams and `ctx` fixtures, calls `buildTeamInsights()` for each, and `console.log`s the result. Run once in the browser via `import(...)` from DevTools or by temporarily importing from the worker. Verifies: meta-match fires, experimental comp produces `noMetaMatch`, stale data fires.
3. **Browser check after wiring.** Run scout on the page, expand "Why this comp?" on 3-5 different comps (a matched meta comp, a fresh experimental one, one with weak champions), eyeball that the sentences make sense and no NaN/undefined leaks through.

If insights turn out load-bearing enough to justify a test runner later, add vitest + move the sanity fixtures into `*.test.ts` — the pure function signature makes that cheap.

## Rollout + rollback

No backend changes. No migration. Purely client-side. Ship in one branch, one commit. If the build passes and `npm run dev` renders a scout result with an "Why this comp?" trigger on each card, the feature is live.

Rollback: revert the worker changes + delete `WhyThisComp` render call in `ScoutCompCard`. `insights: null` is backward-compatible so an old worker response does not break a new UI.

## Open questions for empirical tuning

These are thresholds I guessed. Revisit after first real scout runs:

- `topCarry.minGames = 200` — too loose for a fresh patch?
- `strongTrait.minGames = 500` — might exclude niche traits with real data.
- `weakChampion.minAvgPlace = 4.6` — floor is debatable; 4.5 might be right.
- `noMetaMatch` firing condition — may be too noisy if the scout returns mostly experimental builds by design.

Each is a one-constant change in `insights-config.ts` so tuning is cheap.
