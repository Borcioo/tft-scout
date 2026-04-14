# Scout Role Filters & Card Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the legacy scout feature that lets the user filter results by minimum frontline / DPS counts and shows the role composition (frontline / dps / fighter) on each result card.

**Architecture:** Extends six existing files in two layers — worker (`types.ts`, `index.ts`, `engine.ts`) for the hard filter, and React UI (`Scout/Index.tsx`, `ScoutControls.tsx`, `ScoutCompCard.tsx`) for the controls + card icons. No new modules. Filter runs on already-scored candidates **before** the top-N slice. The pre-existing soft `roleBalance` penalty in `scorer.ts` is unrelated and remains untouched. `ScoredTeam.roles` is already populated by `engine.ts:114`, so no algorithmic work is needed beyond the new filter line.

**Tech Stack:** TypeScript, React 19, Inertia, shadcn (`Slider`), `lucide-react` icons, Vite. No test runner is configured in `package.json`, so verification uses `npm run types:check` + `npm run lint:check` plus a manual smoke test rather than unit tests. The spec explicitly waives new unit tests.

**Reference spec:** `docs/superpowers/specs/2026-04-14-scout-role-filters-and-display-design.md`

**Legacy reference (read-only):** `D:/Projekty/tft-generator/client/src/components/scout/ScoutPanel.jsx` (lines 21–43, 84–108) and `CompCard.jsx` (lines 87–103).

---

## File map

| File | Responsibility | Action |
|---|---|---|
| `resources/js/workers/scout/types.ts` | Worker DTOs | Modify — add `minFrontline?` and `minDps?` to `ScoutParams` and `ScoutConstraints` |
| `resources/js/workers/scout/index.ts` | Worker entry, message routing, param normalisation | Modify — destructure and forward the two params |
| `resources/js/workers/scout/engine.ts` | Generation pipeline | Modify — add hard filter to `validComps` predicate |
| `resources/js/components/scout/ScoutControls.tsx` | Left-aside scout controls | Modify — two new sliders + props |
| `resources/js/pages/Scout/Index.tsx` | Scout page state + worker bridge | Modify — state, `paramsKey`, `generate()` payload, `ScoutControls` props |
| `resources/js/components/scout/ScoutCompCard.tsx` | Result card | Modify — render role icon row when `team.roles != null` |

---

## Task 1: Add filter params to worker types

**Files:**
- Modify: `resources/js/workers/scout/types.ts:94-115`

- [ ] **Step 1: Update `ScoutConstraints` and `ScoutParams`**

In `resources/js/workers/scout/types.ts`, replace the two existing type blocks:

```ts
export type ScoutConstraints = {
    lockedChampions: string[];
    excludedChampions: string[];
    lockedTraits: { apiName: string; minUnits: number }[];
    excludedTraits: string[];
    emblems: { apiName: string; count: number }[];
    max5Cost: number | null;
    roleBalance: boolean | null;
    minFrontline: number;
    minDps: number;
};

export type ScoutParams = {
    lockedChampions?: string[];
    excludedChampions?: string[];
    lockedTraits?: { apiName: string; minUnits: number }[];
    excludedTraits?: string[];
    emblems?: { apiName: string; count: number }[];
    level?: number;
    topN?: number;
    max5Cost?: number | null;
    roleBalance?: boolean | null;
    minFrontline?: number;
    minDps?: number;
    seed?: number;
};
```

`ScoutConstraints` is the strict shape used inside the worker bridge; the new fields are required there because the worker assigns defaults. `ScoutParams` is the public shape sent over `postMessage` and the new fields stay optional so existing callers still compile.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npm run types:check`
Expected: PASS — no new errors. (If it fails, the only callsite that constructs a `ScoutConstraints` literal lives in `resources/js/workers/scout/index.ts`, which Task 2 updates next.)

- [ ] **Step 3: Commit**

```bash
git add resources/js/workers/scout/types.ts
git commit -m "feat(scout): add minFrontline/minDps to worker params types"
```

---

## Task 2: Forward filter params through worker entry

**Files:**
- Modify: `resources/js/workers/scout/index.ts:66-90`

- [ ] **Step 1: Destructure and forward the new params**

In `resources/js/workers/scout/index.ts`, replace the body of `runGenerate` (lines 66–90) so the destructure list and the `constraints` literal include the two new fields:

```ts
async function runGenerate(ctx: ScoutContext, params: ScoutParams) {
    const p = params as any;
    const {
        lockedChampions = [],
        excludedChampions = [],
        lockedTraits = [],
        excludedTraits = [],
        emblems = [],
        level = 8,
        topN = 10,
        max5Cost = null,
        roleBalance = null,
        minFrontline = 0,
        minDps = 0,
        seed = 0,
    } = p;

    const constraints: any = {
        lockedChampions,
        excludedChampions,
        lockedTraits,
        excludedTraits,
        emblems,
        max5Cost,
        roleBalance,
        minFrontline,
        minDps,
    };
```

Leave the rest of the function (the `generate({...})` call and the `generateInsights` call) unchanged.

The default of `0` matches the spec's fast-path requirement: when both are zero the engine skips the filter entirely.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npm run types:check`
Expected: PASS — no new errors.

- [ ] **Step 3: Commit**

```bash
git add resources/js/workers/scout/index.ts
git commit -m "feat(scout): forward minFrontline/minDps through worker entry"
```

---

## Task 3: Apply hard filter inside engine

**Files:**
- Modify: `resources/js/workers/scout/engine.ts:131-139`

- [ ] **Step 1: Extend the `validComps` predicate**

In `resources/js/workers/scout/engine.ts`, locate the existing `validComps` filter (currently lines 131–139):

```js
const maxSlots = level;
const validComps = enriched.filter(r => {
  if (r.slotsUsed > maxSlots) return false;
  for (const lock of traitLocks) {
    const active = r.activeTraits.find(t => t.apiName === lock.apiName);
    if (!active || active.count < lock.minUnits) return false;
  }
  return true;
});
```

Replace it with the version below. The new branch reads the optional `minFrontline` and `minDps` off `constraints`, applies the legacy `effectiveFL = frontline + 0.5 * fighter` formula, and skips the whole block when both mins are zero.

```js
const maxSlots = level;
const minFrontline = constraints.minFrontline ?? 0;
const minDps = constraints.minDps ?? 0;
const applyRoleFilter = minFrontline > 0 || minDps > 0;
const validComps = enriched.filter(r => {
  if (r.slotsUsed > maxSlots) return false;
  for (const lock of traitLocks) {
    const active = r.activeTraits.find(t => t.apiName === lock.apiName);
    if (!active || active.count < lock.minUnits) return false;
  }
  if (applyRoleFilter) {
    if (!r.roles) return false;
    const fl = r.roles.frontline + 0.5 * r.roles.fighter;
    const dps = r.roles.dps + 0.5 * r.roles.fighter;
    if (fl < minFrontline) return false;
    if (dps < minDps) return false;
  }
  return true;
});
```

`engine.ts` carries `// @ts-nocheck` so no type annotations are needed. The filter sits **inside** `validComps.filter` (not as a second `.filter` call) because the meta-match annotation, batch median, and team insights blocks immediately downstream all consume `validComps` — keeping it in one pass means each survivor goes through every downstream step exactly once.

- [ ] **Step 2: Trace the data flow once mentally**

Confirm the change preserves these invariants from the spec:
- Filter runs **after** scoring (`enriched` already has full scores) but **before** the top-N slice on line 182.
- Fighter half-counts toward both axes.
- `r.roles == null` drops the comp (defensive — should never happen because line 114 always assigns `roles`).
- Both mins at zero → the inner block is skipped entirely (fast path).

No code change in this step — just confirm the placement is correct before moving on.

- [ ] **Step 3: Verify TypeScript still compiles**

Run: `npm run types:check`
Expected: PASS.

- [ ] **Step 4: Verify ESLint is clean**

Run: `npm run lint:check`
Expected: PASS — the new variables and conditionals follow the same patterns as the surrounding code.

- [ ] **Step 5: Commit**

```bash
git add resources/js/workers/scout/engine.ts
git commit -m "feat(scout): hard-filter comps by min frontline/dps before top-N"
```

---

## Task 4: Add filter sliders to ScoutControls

**Files:**
- Modify: `resources/js/components/scout/ScoutControls.tsx`

- [ ] **Step 1: Extend `Props` and the destructure**

In `resources/js/components/scout/ScoutControls.tsx`, replace the `Props` type and the function signature so they accept the two new value/handler pairs:

```tsx
type Props = {
    level: number;
    topN: number;
    max5Cost: number | null;
    roleBalance: boolean;
    minFrontline: number;
    minDps: number;
    isRunning: boolean;
    onLevelChange: (value: number) => void;
    onTopNChange: (value: number) => void;
    onMax5CostChange: (value: number | null) => void;
    onRoleBalanceChange: (value: boolean) => void;
    onMinFrontlineChange: (value: number) => void;
    onMinDpsChange: (value: number) => void;
    onRun: () => void;
};

export function ScoutControls({
    level,
    topN,
    max5Cost,
    roleBalance,
    minFrontline,
    minDps,
    isRunning,
    onLevelChange,
    onTopNChange,
    onMax5CostChange,
    onRoleBalanceChange,
    onMinFrontlineChange,
    onMinDpsChange,
    onRun,
}: Props) {
```

- [ ] **Step 2: Insert the two new slider blocks**

After the existing "Role balance" `<div>` block (the `Switch`, currently lines 81–88) and **before** the `<Button>` (currently line 90), insert two new control groups that mirror the existing slider markup. The structure copies the `Level` / `Top results` / `Max 5-cost` blocks directly:

```tsx
<div className="flex flex-col gap-2">
    <div className="flex items-baseline justify-between">
        <Label>Min Frontline</Label>
        <span className="font-mono text-sm">{minFrontline}</span>
    </div>
    <Slider
        value={[minFrontline]}
        min={0}
        max={6}
        step={1}
        onValueChange={([v]) => onMinFrontlineChange(v)}
    />
</div>

<div className="flex flex-col gap-2">
    <div className="flex items-baseline justify-between">
        <Label>Min DPS</Label>
        <span className="font-mono text-sm">{minDps}</span>
    </div>
    <Slider
        value={[minDps]}
        min={0}
        max={6}
        step={1}
        onValueChange={([v]) => onMinDpsChange(v)}
    />
</div>
```

The label format (`Min Frontline` / `Min DPS`), the `0..6` range, the `step={1}`, and the literal `0` value display all come straight from the spec's "UI controls" section.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npm run types:check`
Expected: FAIL — `Scout/Index.tsx` does not yet pass `minFrontline`, `minDps`, or the two handlers, so its `<ScoutControls .../>` JSX will report missing required props. This is expected; Task 5 fixes it.

- [ ] **Step 4: Commit**

```bash
git add resources/js/components/scout/ScoutControls.tsx
git commit -m "feat(scout): add Min Frontline and Min DPS sliders to ScoutControls"
```

---

## Task 5: Wire filters into Scout page state

**Files:**
- Modify: `resources/js/pages/Scout/Index.tsx`

- [ ] **Step 1: Add state declarations**

In `resources/js/pages/Scout/Index.tsx`, just below the existing `roleBalance` state declaration (currently line 59), add the two new pieces of state:

```tsx
const [minFrontline, setMinFrontline] = useState(0);
const [minDps, setMinDps] = useState(0);
```

- [ ] **Step 2: Pass the new params into `generate(...)`**

Update the `generate({...})` call inside the `run` callback (currently lines 71–79) so it forwards the two new values. The whole `generate` payload becomes:

```tsx
generate({
    level,
    topN,
    max5Cost,
    roleBalance,
    minFrontline,
    minDps,
    lockedChampions,
    lockedTraits,
    emblems,
})
```

- [ ] **Step 3: Add the new params to the `run` dependency list**

Update the `useCallback` dep array on line 88 so the closure picks up changes:

```tsx
}, [generate, level, topN, max5Cost, roleBalance, minFrontline, minDps, lockedChampions, lockedTraits, emblems]);
```

- [ ] **Step 4: Add the new params to `paramsKey`**

Update the `paramsKey` literal (currently lines 94–102) so the debounced re-trigger fires when either slider moves:

```tsx
const paramsKey = JSON.stringify({
    level,
    topN,
    max5Cost,
    roleBalance,
    minFrontline,
    minDps,
    lockedChampions,
    lockedTraits,
    emblems,
});
```

- [ ] **Step 5: Pass the new props to `<ScoutControls />`**

Update the `<ScoutControls .../>` JSX (currently lines 116–127) to pass the two new values and handlers:

```tsx
<ScoutControls
    level={level}
    topN={topN}
    max5Cost={max5Cost}
    roleBalance={roleBalance}
    minFrontline={minFrontline}
    minDps={minDps}
    isRunning={isRunning}
    onLevelChange={setLevel}
    onTopNChange={setTopN}
    onMax5CostChange={setMax5Cost}
    onRoleBalanceChange={setRoleBalance}
    onMinFrontlineChange={setMinFrontline}
    onMinDpsChange={setMinDps}
    onRun={run}
/>
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npm run types:check`
Expected: PASS — the `ScoutControls` props from Task 4 are now satisfied.

- [ ] **Step 7: Verify ESLint is clean**

Run: `npm run lint:check`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add resources/js/pages/Scout/Index.tsx
git commit -m "feat(scout): wire min frontline/dps state into Scout page"
```

---

## Task 6: Render role icons on result card

**Files:**
- Modify: `resources/js/components/scout/ScoutCompCard.tsx`

- [ ] **Step 1: Import the three lucide icons**

At the top of `resources/js/components/scout/ScoutCompCard.tsx`, add an import line below the existing `cn` import:

```tsx
import { Hand, Shield, Swords } from 'lucide-react';
```

`lucide-react` is already a dependency (`package.json`).

- [ ] **Step 2: Add the role row above the champion grid**

Inside the JSX, locate the champion grid `<div className="flex flex-wrap gap-1.5">` (currently line 80). **Immediately above** that opening `<div>`, insert the role row. It renders only when `team.roles` is present, and the fighter slot only when it's > 0:

```tsx
{team.roles && (
    <div className="flex items-center gap-3 text-xs font-mono text-muted-foreground">
        <span className="flex items-center gap-1 text-blue-400">
            <Shield className="size-3.5" />
            {team.roles.frontline}
        </span>
        <span className="flex items-center gap-1 text-red-400">
            <Swords className="size-3.5" />
            {team.roles.dps}
        </span>
        {team.roles.fighter > 0 && (
            <span className="flex items-center gap-1 text-yellow-400">
                <Hand className="size-3.5" />
                {team.roles.fighter}
            </span>
        )}
    </div>
)}
```

The colours (`text-blue-400` / `text-red-400` / `text-yellow-400`) and the icon choices (`Shield` / `Swords` / `Hand`) come straight from the spec's "Card display" section.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npm run types:check`
Expected: PASS — `team.roles` is typed as `Record<string, number> | null` in `types.ts:147`, so the truthy guard narrows it correctly and the index accesses (`.frontline`, `.dps`, `.fighter`) are allowed under `Record<string, number>`.

- [ ] **Step 4: Verify ESLint is clean**

Run: `npm run lint:check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add resources/js/components/scout/ScoutCompCard.tsx
git commit -m "feat(scout): show frontline/dps/fighter icons on result card"
```

---

## Task 7: Manual smoke test

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

In a separate terminal:

```bash
npm run dev
```

Wait for Vite to report the local URL.

- [ ] **Step 2: Start the Laravel server (if not already running)**

```bash
php artisan serve
```

(Only needed if the user does not already have Herd serving the project.)

- [ ] **Step 3: Open the Scout page**

Navigate to `/scout` in a browser. Wait for the first generate cycle to settle.

- [ ] **Step 4: Verify role row renders on every card**

Each result card should now show three (or two, when `fighter == 0`) icon+number pairs above the champion grid:
- Blue shield + frontline count
- Red swords + dps count
- Yellow hand + fighter count (omitted when zero)

- [ ] **Step 5: Verify the Min Frontline filter cuts results**

In the left aside, drag `Min Frontline` to `4`. After the 300 ms debounce, the result list should regenerate. Every visible card should now show a frontline number `>= 4` (fighters count for `0.5` each, so a card with `3` frontline and `2` fighters also passes — `3 + 1 = 4`).

- [ ] **Step 6: Verify the Min DPS filter cuts results**

Drag `Min Frontline` back to `0`, then drag `Min DPS` to `4`. Every visible card should show a dps number `>= 4` (same fighter half-count rule).

- [ ] **Step 7: Verify the fast path**

Drag both sliders back to `0`. The result list should return to baseline (same length and ordering as the very first generation).

- [ ] **Step 8: Verify the empty state**

Set `Min Frontline = 6` **and** `Min DPS = 6`. The list should drop to `0 comps` (header counter shows `0`) and the existing empty state should render. No crash.

- [ ] **Step 9: Stop the dev server**

`Ctrl+C` in the dev server terminal.

- [ ] **Step 10: Final commit gate**

No code changes in this task. If any of the manual checks failed, do **not** mark this task complete — diagnose and fix in the appropriate earlier task before moving on.

---

## Out of scope (do not implement)

- Persisting filter state across reloads.
- Showing role composition anywhere other than `ScoutCompCard`.
- A third slider for `minFighter` or a `maxFrontline` cap.
- Changes to the `roleBalance` soft-penalty toggle.
- New unit tests for the worker filter (the spec explicitly waives them).
