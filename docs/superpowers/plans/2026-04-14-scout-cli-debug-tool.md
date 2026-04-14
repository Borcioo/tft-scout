# Scout CLI Debug Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a thin Node CLI under `scripts/scout-cli/` that lets the assistant invoke `engine.generate` end-to-end or any individual phase of the scout algorithm directly from the terminal, with controlled inputs and machine-readable JSON output.

**Architecture:** Single entry point `scripts/scout-cli.ts` dispatches to per-command modules under `scripts/scout-cli/`. Worker modules in `resources/js/workers/scout/` are imported directly via relative paths and run unmodified through `tsx`. The CLI loads a `ScoutContext` either from a snapshot file (`tmp/scout-context.json`) or by hitting the live `/api/scout/context` endpoint, then calls the requested worker function. Every command outputs pretty JSON to stdout.

**Tech Stack:** Node 18+ (global `fetch`), `tsx` (new devDep) to load `.ts` worker files without a build step, native `node:fs` / `node:path` / `node:process`. No new runtime deps.

**Reference spec:** `docs/superpowers/specs/2026-04-14-scout-cli-debug-tool-design.md`

---

## File map

| File | Responsibility | Action |
|---|---|---|
| `package.json` | npm scripts + devDeps | Modify — add `tsx` devDep + `"scout"` script |
| `.gitignore` | exclude tmp dir | Modify — add `/tmp` |
| `tmp/.gitkeep` | keep dir under git | Create (empty) |
| `scripts/scout-cli.ts` | Entry point — argv parsing + command dispatch + top-level error handler | Create |
| `scripts/scout-cli/context.ts` | Snapshot read/write + live fetch + context type re-export | Create |
| `scripts/scout-cli/lookup.ts` | Champion / trait lookup with nearest-name suggestions | Create |
| `scripts/scout-cli/params.ts` | Argv flag parser → `ScoutParams` + `ScoutConstraints` builder | Create |
| `scripts/scout-cli/format.ts` | Smart-summary formatters per command | Create |
| `scripts/scout-cli/commands/snapshot.ts` | `snapshot` + `snapshot --inspect` | Create |
| `scripts/scout-cli/commands/context.ts` | `context` + `--champion` / `--trait` lookup | Create |
| `scripts/scout-cli/commands/generate.ts` | `generate` end-to-end | Create |
| `scripts/scout-cli/commands/phase.ts` | All seven `phase <name>` subcommands | Create |

Worker modules under `resources/js/workers/scout/` are **imported only**, never modified.

---

## Task 1: Scaffold deps + npm script + skeleton entry

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`
- Create: `tmp/.gitkeep`
- Create: `scripts/scout-cli.ts`

- [ ] **Step 1: Add tsx devDep**

From `D:/Herd/tft-scout`, run:

```bash
npm install --save-dev tsx
```

Expected: `tsx` appears in `devDependencies` in `package.json`. No other version bumps. Lockfile updated.

- [ ] **Step 2: Add the `scout` npm script**

In `package.json`, the existing `scripts` block looks like:

```json
"scripts": {
    "build": "vite build",
    "build:ssr": "vite build && vite build --ssr",
    "dev": "vite",
    "format": "prettier --write resources/",
    "format:check": "prettier --check resources/",
    "lint": "eslint . --fix",
    "lint:check": "eslint .",
    "types:check": "tsc --noEmit"
},
```

Add a `"scout"` line so the block becomes:

```json
"scripts": {
    "build": "vite build",
    "build:ssr": "vite build && vite build --ssr",
    "dev": "vite",
    "format": "prettier --write resources/",
    "format:check": "prettier --check resources/",
    "lint": "eslint . --fix",
    "lint:check": "eslint .",
    "scout": "tsx scripts/scout-cli.ts",
    "types:check": "tsc --noEmit"
},
```

- [ ] **Step 3: Add `/tmp` to `.gitignore`**

The current `.gitignore` ends with `.worktrees/`. Append a new line:

```
/tmp
```

(The leading slash anchors it to the project root so it does not match nested `tmp/` directories inside `node_modules` or `vendor`.)

- [ ] **Step 4: Create the tmp directory placeholder**

Create the file `D:/Herd/tft-scout/tmp/.gitkeep` (empty). This exists only so the directory survives a fresh clone even though everything inside it is gitignored.

Note: the `.gitkeep` itself is NOT ignored because `.gitignore` only excludes `/tmp` as a directory pattern — git tracks files explicitly added inside it. To make sure git tracks it, run `git add -f tmp/.gitkeep` later in the commit step.

- [ ] **Step 5: Create the entry-point stub**

Create `scripts/scout-cli.ts` with this exact content:

```ts
#!/usr/bin/env tsx
/**
 * scout-cli — debug entry into the scout algorithm.
 *
 * Usage: npm run scout -- <command> [flags]
 *
 * See docs/superpowers/specs/2026-04-14-scout-cli-debug-tool-design.md
 * for the full command and flag reference.
 */

const HELP = `scout-cli — debug entry into the scout algorithm

Commands:
  snapshot              Fetch /api/scout/context and write tmp/scout-context.json
  snapshot --inspect    Fetch but print meta to stdout instead of writing
  context               Print meta of the saved snapshot
  context --champion N  Print one champion record from the saved snapshot
  context --trait N     Print one trait record from the saved snapshot
  generate [flags]      Run engine.generate end-to-end
  phase <name> [flags]  Run a single phase (candidates|graph|find-teams|score|active-traits|role-balance|insights)

Common flags:
  --level N             Player level (default 8)
  --top-n N             Number of results (default 10)
  --max-5cost N         Cap on 5-cost units
  --min-frontline N     Min frontline filter (default 0)
  --min-dps N           Min dps filter (default 0)
  --locked A,B,C        Locked champions
  --excluded A,B,C      Excluded champions
  --locked-trait T:N    Locked trait with min units
  --emblem T:N          Emblem on trait
  --seed N              RNG seed
  --team A,B,C          Required by per-team phase commands
  --params file.json    Full ScoutParams JSON (overrides individual flags)
  --raw-input file.json Per-phase escape hatch (skip auto-build)
  --full                Disable smart summary
  --live                Skip snapshot, fetch /api/scout/context fresh
  --snapshot path.json  Override snapshot path (default tmp/scout-context.json)
`;

async function main() {
    const argv = process.argv.slice(2);
    const command = argv[0];

    if (!command || command === '--help' || command === '-h') {
        process.stdout.write(HELP);
        return;
    }

    process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
    process.exit(1);
}

main().catch((err) => {
    process.stderr.write(`scout-cli: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
});
```

- [ ] **Step 6: Verify the skeleton runs**

Run from `D:/Herd/tft-scout`:

```bash
npm run scout -- --help
```

Expected: the `HELP` text above is printed to stdout. Exit code `0`.

```bash
npm run scout -- nonsense
```

Expected: error line + `HELP` to stderr, exit code `1`.

- [ ] **Step 7: Commit**

```bash
cd D:/Herd/tft-scout && git add -f tmp/.gitkeep && git add package.json package-lock.json .gitignore scripts/scout-cli.ts && git commit -m "feat(scout-cli): scaffold tsx CLI entry + npm script"
```

---

## Task 2: Context loader module

**Files:**
- Create: `scripts/scout-cli/context.ts`

- [ ] **Step 1: Create the loader module**

Create `scripts/scout-cli/context.ts` with this exact content:

```ts
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import type { ScoutContext } from '../../resources/js/workers/scout/types';

export const DEFAULT_SNAPSHOT_PATH = 'tmp/scout-context.json';

export type LoadOptions = {
    live: boolean;
    snapshotPath: string;
};

/**
 * Load the ScoutContext.
 *
 * - --live                  Always fetches /api/scout/context.
 * - default + snapshot      Reads the snapshot file from disk.
 * - default + no snapshot   Throws with a hint to run `snapshot` or pass --live.
 */
export async function loadContext(opts: LoadOptions): Promise<ScoutContext> {
    if (opts.live) {
        return await fetchLive();
    }
    if (!existsSync(opts.snapshotPath)) {
        throw new Error(
            `No snapshot at ${opts.snapshotPath}. Run \`npm run scout -- snapshot\` first or pass --live.`,
        );
    }
    const raw = readFileSync(opts.snapshotPath, 'utf8');
    try {
        return JSON.parse(raw) as ScoutContext;
    } catch (err) {
        throw new Error(
            `Snapshot at ${opts.snapshotPath} is malformed JSON: ${(err as Error).message}. Re-run \`npm run scout -- snapshot\`.`,
        );
    }
}

export async function fetchLive(): Promise<ScoutContext> {
    const base = process.env.SCOUT_API_BASE ?? 'http://localhost';
    const url = `${base}/api/scout/context`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
        throw new Error(`Live fetch ${url} failed: HTTP ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as ScoutContext;
}

export function writeSnapshot(path: string, ctx: ScoutContext): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(ctx, null, 2), 'utf8');
}
```

- [ ] **Step 2: Verify TypeScript

From `D:/Herd/tft-scout`, run:

```bash
npm run types:check
```

Expected: PASS for the new file. Pre-existing UI auth errors remain unchanged.

- [ ] **Step 3: Commit**

```bash
cd D:/Herd/tft-scout && git add scripts/scout-cli/context.ts && git commit -m "feat(scout-cli): add context loader (snapshot + live fetch)"
```

---

## Task 3: Champion / trait lookup utility

**Files:**
- Create: `scripts/scout-cli/lookup.ts`

- [ ] **Step 1: Create the lookup module**

Create `scripts/scout-cli/lookup.ts` with this exact content:

```ts
import type { Champion, ScoutContext, Trait } from '../../resources/js/workers/scout/types';

/**
 * Find a champion by case-insensitive apiName. Throws with the three
 * nearest matches if not found, so the caller can surface a helpful error.
 */
export function findChampion(ctx: ScoutContext, apiName: string): Champion {
    const lower = apiName.toLowerCase();
    const exact = ctx.champions.find((c) => c.apiName.toLowerCase() === lower);
    if (exact) return exact;
    const nearest = nearestNames(
        apiName,
        ctx.champions.map((c) => c.apiName),
    );
    throw new Error(
        `Unknown champion apiName: "${apiName}". Did you mean: ${nearest.join(', ')}?`,
    );
}

export function findTrait(ctx: ScoutContext, apiName: string): Trait {
    const lower = apiName.toLowerCase();
    const exact = ctx.traits.find((t) => t.apiName.toLowerCase() === lower);
    if (exact) return exact;
    const nearest = nearestNames(
        apiName,
        ctx.traits.map((t) => t.apiName),
    );
    throw new Error(
        `Unknown trait apiName: "${apiName}". Did you mean: ${nearest.join(', ')}?`,
    );
}

/** Map a list of apiNames to champions, throwing on the first unknown. */
export function findChampions(ctx: ScoutContext, apiNames: string[]): Champion[] {
    return apiNames.map((name) => findChampion(ctx, name));
}

/**
 * Return up to `k` candidates ranked by case-insensitive substring match
 * first, then by Levenshtein distance. Used only for error messages, so
 * a naive O(n * m) loop is fine for ~60 champions / ~30 traits.
 */
function nearestNames(query: string, pool: string[], k = 3): string[] {
    const q = query.toLowerCase();
    const scored = pool.map((name) => {
        const lname = name.toLowerCase();
        const substring = lname.includes(q) || q.includes(lname) ? 0 : 1;
        const distance = levenshtein(q, lname);
        return { name, substring, distance };
    });
    scored.sort((a, b) => {
        if (a.substring !== b.substring) return a.substring - b.substring;
        return a.distance - b.distance;
    });
    return scored.slice(0, k).map((s) => s.name);
}

function levenshtein(a: string, b: string): number {
    if (a === b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const prev: number[] = new Array(b.length + 1);
    const curr: number[] = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
        curr[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
        }
        for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
    }
    return prev[b.length];
}
```

- [ ] **Step 2: Verify TypeScript

```bash
npm run types:check
```

Expected: PASS for new file.

- [ ] **Step 3: Commit**

```bash
cd D:/Herd/tft-scout && git add scripts/scout-cli/lookup.ts && git commit -m "feat(scout-cli): add champion/trait lookup with nearest-name hints"
```

---

## Task 4: Snapshot command

**Files:**
- Create: `scripts/scout-cli/commands/snapshot.ts`
- Modify: `scripts/scout-cli.ts`

- [ ] **Step 1: Create the snapshot command module**

Create `scripts/scout-cli/commands/snapshot.ts`:

```ts
import { DEFAULT_SNAPSHOT_PATH, fetchLive, writeSnapshot } from '../context';
import type { ScoutContext } from '../../../resources/js/workers/scout/types';

export type SnapshotArgs = {
    inspect: boolean;
    snapshotPath: string;
};

export function parseSnapshotArgs(argv: string[]): SnapshotArgs {
    let inspect = false;
    let snapshotPath = DEFAULT_SNAPSHOT_PATH;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--inspect') inspect = true;
        else if (a === '--snapshot') snapshotPath = argv[++i];
        else throw new Error(`Unknown flag for snapshot: ${a}`);
    }
    return { inspect, snapshotPath };
}

export async function runSnapshot(args: SnapshotArgs): Promise<void> {
    const ctx = await fetchLive();
    if (args.inspect) {
        process.stdout.write(JSON.stringify(meta(ctx), null, 2) + '\n');
        return;
    }
    writeSnapshot(args.snapshotPath, ctx);
    process.stdout.write(
        JSON.stringify(
            {
                wrote: args.snapshotPath,
                ...meta(ctx),
            },
            null,
            2,
        ) + '\n',
    );
}

function meta(ctx: ScoutContext) {
    return {
        champions: ctx.champions.length,
        traits: ctx.traits.length,
        exclusionGroups: ctx.exclusionGroups?.length ?? 0,
        scoringCtx: {
            unitRatings: Object.keys(ctx.scoringCtx?.unitRatings ?? {}).length,
            traitRatings: Object.keys(ctx.scoringCtx?.traitRatings ?? {}).length,
            metaComps: ctx.scoringCtx?.metaComps?.length ?? 0,
        },
        syncedAt: ctx.syncedAt ?? null,
        stale: ctx.stale ?? false,
    };
}
```

- [ ] **Step 2: Wire snapshot into the dispatcher**

Update `scripts/scout-cli.ts`. Replace the entire `main` function with:

```ts
async function main() {
    const argv = process.argv.slice(2);
    const command = argv[0];
    const rest = argv.slice(1);

    if (!command || command === '--help' || command === '-h') {
        process.stdout.write(HELP);
        return;
    }

    if (command === 'snapshot') {
        const { parseSnapshotArgs, runSnapshot } = await import('./scout-cli/commands/snapshot');
        await runSnapshot(parseSnapshotArgs(rest));
        return;
    }

    process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
    process.exit(1);
}
```

The dynamic `import()` keeps the entry file lightweight: each command module is loaded only when its command runs.

- [ ] **Step 3: Smoke-test snapshot (Herd must be running)**

```bash
npm run scout -- snapshot --inspect
```

Expected: a JSON object with `champions`, `traits`, `exclusionGroups`, `scoringCtx`, `syncedAt`, `stale` printed to stdout. Exit code `0`. `tmp/scout-context.json` is NOT created.

```bash
npm run scout -- snapshot
```

Expected: same JSON object plus a `wrote: "tmp/scout-context.json"` field. The file `tmp/scout-context.json` exists and is non-empty.

If Herd is not currently running, skip these two checks and document that in the report so the controller can re-verify after starting Herd.

- [ ] **Step 4: Commit**

```bash
cd D:/Herd/tft-scout && git add scripts/scout-cli/commands/snapshot.ts scripts/scout-cli.ts && git commit -m "feat(scout-cli): add snapshot command"
```

---

## Task 5: Context command

**Files:**
- Create: `scripts/scout-cli/commands/context.ts`
- Modify: `scripts/scout-cli.ts`

- [ ] **Step 1: Create the context command module**

Create `scripts/scout-cli/commands/context.ts`:

```ts
import { DEFAULT_SNAPSHOT_PATH, loadContext } from '../context';
import { findChampion, findTrait } from '../lookup';
import type { ScoutContext } from '../../../resources/js/workers/scout/types';

export type ContextArgs = {
    champion: string | null;
    trait: string | null;
    snapshotPath: string;
    live: boolean;
};

export function parseContextArgs(argv: string[]): ContextArgs {
    let champion: string | null = null;
    let trait: string | null = null;
    let snapshotPath = DEFAULT_SNAPSHOT_PATH;
    let live = false;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--champion') champion = argv[++i];
        else if (a === '--trait') trait = argv[++i];
        else if (a === '--snapshot') snapshotPath = argv[++i];
        else if (a === '--live') live = true;
        else throw new Error(`Unknown flag for context: ${a}`);
    }
    return { champion, trait, snapshotPath, live };
}

export async function runContext(args: ContextArgs): Promise<void> {
    const ctx = await loadContext({ live: args.live, snapshotPath: args.snapshotPath });
    if (args.champion) {
        process.stdout.write(JSON.stringify(findChampion(ctx, args.champion), null, 2) + '\n');
        return;
    }
    if (args.trait) {
        process.stdout.write(JSON.stringify(findTrait(ctx, args.trait), null, 2) + '\n');
        return;
    }
    process.stdout.write(JSON.stringify(meta(ctx), null, 2) + '\n');
}

function meta(ctx: ScoutContext) {
    return {
        champions: ctx.champions.length,
        traits: ctx.traits.length,
        exclusionGroups: ctx.exclusionGroups?.length ?? 0,
        scoringCtx: {
            unitRatings: Object.keys(ctx.scoringCtx?.unitRatings ?? {}).length,
            traitRatings: Object.keys(ctx.scoringCtx?.traitRatings ?? {}).length,
            metaComps: ctx.scoringCtx?.metaComps?.length ?? 0,
        },
        syncedAt: ctx.syncedAt ?? null,
        stale: ctx.stale ?? false,
    };
}
```

- [ ] **Step 2: Wire context into the dispatcher**

Update `scripts/scout-cli.ts`. Inside `main`, AFTER the `snapshot` block and BEFORE the `Unknown command` line, insert:

```ts
    if (command === 'context') {
        const { parseContextArgs, runContext } = await import('./scout-cli/commands/context');
        await runContext(parseContextArgs(rest));
        return;
    }
```

- [ ] **Step 3: Smoke-test context (snapshot must exist from Task 4)**

```bash
npm run scout -- context
```

Expected: same meta object as `snapshot --inspect` produced in Task 4, but read from disk.

```bash
npm run scout -- context --champion Aatrox
```

Expected: full Aatrox record (apiName, name, cost, traits, etc.) printed as JSON.

```bash
npm run scout -- context --champion FooBar
```

Expected: error `Unknown champion apiName: "FooBar". Did you mean: ...` to stderr, exit code 1.

- [ ] **Step 4: Commit**

```bash
cd D:/Herd/tft-scout && git add scripts/scout-cli/commands/context.ts scripts/scout-cli.ts && git commit -m "feat(scout-cli): add context command with champion/trait lookup"
```

---

## Task 6: Common params parser

**Files:**
- Create: `scripts/scout-cli/params.ts`

- [ ] **Step 1: Create the params parser**

Create `scripts/scout-cli/params.ts`:

```ts
import { readFileSync } from 'node:fs';

import { DEFAULT_SNAPSHOT_PATH } from './context';
import type { ScoutParams } from '../../resources/js/workers/scout/types';

/**
 * Shared flag set understood by the `generate` and `phase` commands.
 * Per-team phases additionally accept `--team`.
 */
export type CommonArgs = {
    params: ScoutParams;
    team: string[] | null;
    full: boolean;
    live: boolean;
    snapshotPath: string;
    rawInputPath: string | null;
};

export function parseCommonArgs(argv: string[]): CommonArgs {
    const out: CommonArgs = {
        params: {},
        team: null,
        full: false,
        live: false,
        snapshotPath: DEFAULT_SNAPSHOT_PATH,
        rawInputPath: null,
    };

    let paramsFile: string | null = null;

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        switch (a) {
            case '--level':
                out.params.level = Number(argv[++i]);
                break;
            case '--top-n':
                out.params.topN = Number(argv[++i]);
                break;
            case '--max-5cost':
                out.params.max5Cost = Number(argv[++i]);
                break;
            case '--min-frontline':
                out.params.minFrontline = Number(argv[++i]);
                break;
            case '--min-dps':
                out.params.minDps = Number(argv[++i]);
                break;
            case '--locked':
                out.params.lockedChampions = csv(argv[++i]);
                break;
            case '--excluded':
                out.params.excludedChampions = csv(argv[++i]);
                break;
            case '--locked-trait':
                out.params.lockedTraits = parseTraitLocks(argv[++i]);
                break;
            case '--emblem':
                out.params.emblems = parseEmblems(argv[++i]);
                break;
            case '--seed':
                out.params.seed = Number(argv[++i]);
                break;
            case '--team':
                out.team = csv(argv[++i]);
                break;
            case '--params':
                paramsFile = argv[++i];
                break;
            case '--raw-input':
                out.rawInputPath = argv[++i];
                break;
            case '--full':
                out.full = true;
                break;
            case '--live':
                out.live = true;
                break;
            case '--snapshot':
                out.snapshotPath = argv[++i];
                break;
            default:
                throw new Error(`Unknown flag: ${a}`);
        }
    }

    // --params file wins for the keys it specifies; individual flags
    // fill in whatever the file did not set.
    if (paramsFile) {
        const fileParams = JSON.parse(readFileSync(paramsFile, 'utf8')) as ScoutParams;
        out.params = { ...out.params, ...fileParams };
    }

    return out;
}

function csv(value: string | undefined): string[] {
    if (!value) return [];
    return value
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}

function parseTraitLocks(value: string | undefined): { apiName: string; minUnits: number }[] {
    return csv(value).map((entry) => {
        const [apiName, minUnits] = entry.split(':');
        if (!apiName || !minUnits) {
            throw new Error(`--locked-trait expects "apiName:minUnits", got "${entry}"`);
        }
        return { apiName, minUnits: Number(minUnits) };
    });
}

function parseEmblems(value: string | undefined): { apiName: string; count: number }[] {
    return csv(value).map((entry) => {
        const [apiName, count] = entry.split(':');
        if (!apiName || !count) {
            throw new Error(`--emblem expects "apiName:count", got "${entry}"`);
        }
        return { apiName, count: Number(count) };
    });
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npm run types:check
```

Expected: PASS for the new file.

- [ ] **Step 3: Commit**

```bash
cd D:/Herd/tft-scout && git add scripts/scout-cli/params.ts && git commit -m "feat(scout-cli): add shared flag parser for ScoutParams"
```

---

## Task 7: Generate command

**Files:**
- Create: `scripts/scout-cli/format.ts`
- Create: `scripts/scout-cli/commands/generate.ts`
- Modify: `scripts/scout-cli.ts`

- [ ] **Step 1: Create the format module**

Create `scripts/scout-cli/format.ts`:

```ts
/**
 * Smart-summary formatters. Each takes a raw worker return value and
 * collapses it into a token-efficient shape for the assistant. Pass
 * `--full` at the command layer to skip these and print raw output.
 */

export function summariseGenerate(rawResults: any[], filtered: GenerateFilteredCounts): unknown {
    return {
        topN: rawResults.length,
        results: rawResults.map((r, i) => ({
            rank: i + 1,
            score: round1(r.score),
            champions: r.champions.map((c: any) => c.apiName),
            activeTraits: formatActiveTraits(r.activeTraits),
            roles: formatRoles(r.roles),
            slotsUsed: r.slotsUsed,
            metaMatch: r.metaMatch
                ? `${r.metaMatch.name}(${Math.round((r.metaMatch.overlap / r.metaMatch.total) * 100)}%)`
                : null,
            breakdown: roundBreakdown(r.breakdown),
        })),
        filtered,
    };
}

export type GenerateFilteredCounts = {
    rawTeams: number;
    enriched: number;
    afterValidComps: number;
    afterTopN: number;
};

export function summariseCandidates(candidates: any[]): unknown {
    const byCost: Record<number, number> = {};
    const byTrait: Record<string, number> = {};
    for (const c of candidates) {
        byCost[c.cost] = (byCost[c.cost] ?? 0) + 1;
        for (const t of c.traits ?? []) byTrait[t] = (byTrait[t] ?? 0) + 1;
    }
    return {
        count: candidates.length,
        byCost,
        byTrait,
        sample: candidates.slice(0, 8).map((c) => c.apiName),
    };
}

export function summariseGraph(graph: any): unknown {
    const nodes = Object.keys(graph?.nodes ?? {}).length;
    const edges: Array<[string, string]> = [];
    for (const [from, neighbours] of Object.entries(graph?.adjacency ?? {})) {
        for (const to of Object.keys(neighbours as object)) {
            if (from < to) edges.push([from, to]);
        }
    }
    return {
        nodes,
        edges: edges.length,
        avgDegree: nodes === 0 ? 0 : round1((edges.length * 2) / nodes),
        sampleEdges: edges.slice(0, 5),
    };
}

export function summariseFindTeams(teams: any[]): unknown {
    return teams.map((t) => ({
        champions: t.champions.map((c: any) => c.apiName),
        teamSize: t.champions.length,
        slotsUsed: t.champions.reduce((s: number, c: any) => s + (c.slotsUsed ?? 1), 0),
    }));
}

export function summariseScore(scored: { score: number; breakdown: Record<string, number> }): unknown {
    return {
        score: round1(scored.score),
        breakdown: roundBreakdown(scored.breakdown),
    };
}

export function summariseActiveTraits(traits: any[]): unknown {
    return traits.map((t) => ({
        apiName: t.apiName,
        count: t.count,
        style: t.activeStyle ?? null,
        breakpoint: t.activeBreakpoint ?? null,
    }));
}

export function summariseRoleBalance(roles: any): unknown {
    return {
        frontline: roles.frontline,
        dps: roles.dps,
        fighter: roles.fighter,
        effectiveFrontline: roles.effectiveFrontline,
        effectiveDps: roles.effectiveDps,
    };
}

export function formatActiveTraits(traits: any[]): string {
    return traits
        .map((t) => `${t.apiName ?? t.name}:${t.count}(${t.style ?? t.activeStyle ?? '-'})`)
        .join(' ');
}

export function formatRoles(roles: any): string {
    if (!roles) return '';
    const parts = [`fl:${roles.frontline}`, `dps:${roles.dps}`];
    if (roles.fighter > 0) parts.push(`fighter:${roles.fighter}`);
    return parts.join(' ');
}

function round1(n: number): number {
    return Math.round(n * 10) / 10;
}

function roundBreakdown(b: Record<string, number> | null | undefined): Record<string, number> {
    if (!b) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(b)) out[k] = round1(v);
    return out;
}
```

- [ ] **Step 2: Create the generate command**

Create `scripts/scout-cli/commands/generate.ts`:

```ts
import { readFileSync } from 'node:fs';

// @ts-expect-error — engine.ts uses `// @ts-nocheck`, no public types
import { generate } from '../../../resources/js/workers/scout/engine';
import { loadContext } from '../context';
import { summariseGenerate, type GenerateFilteredCounts } from '../format';
import { parseCommonArgs } from '../params';

export async function runGenerate(argv: string[]): Promise<void> {
    const args = parseCommonArgs(argv);
    const ctx = await loadContext({ live: args.live, snapshotPath: args.snapshotPath });

    if (args.rawInputPath) {
        const raw = JSON.parse(readFileSync(args.rawInputPath, 'utf8'));
        const out = generate(raw);
        printResults(out, args.full);
        return;
    }

    const {
        level = 8,
        topN = 10,
        max5Cost = null,
        roleBalance = null,
        minFrontline = 0,
        minDps = 0,
        lockedChampions = [],
        excludedChampions = [],
        lockedTraits = [],
        excludedTraits = [],
        emblems = [],
        seed = 0,
    } = args.params;

    const out = generate({
        champions: ctx.champions,
        traits: ctx.traits,
        scoringCtx: ctx.scoringCtx,
        constraints: {
            lockedChampions,
            excludedChampions,
            lockedTraits,
            excludedTraits,
            emblems,
            max5Cost,
            roleBalance,
            minFrontline,
            minDps,
        },
        exclusionGroups: ctx.exclusionGroups,
        level,
        topN,
        seed,
        stale: ctx.stale,
    });

    printResults(out, args.full);
}

function printResults(results: any[], full: boolean): void {
    if (full) {
        process.stdout.write(JSON.stringify(results, null, 2) + '\n');
        return;
    }
    // We do not have the intermediate raw / enriched / valid counts
    // because `generate` does not expose them. Report the final length
    // for both `afterValidComps` and `afterTopN` and surface raw / enriched
    // as unknown via -1 so the assistant can tell they were not measured.
    const filtered: GenerateFilteredCounts = {
        rawTeams: -1,
        enriched: -1,
        afterValidComps: results.length,
        afterTopN: results.length,
    };
    process.stdout.write(JSON.stringify(summariseGenerate(results, filtered), null, 2) + '\n');
}
```

- [ ] **Step 3: Wire generate into the dispatcher**

Update `scripts/scout-cli.ts`. Inside `main`, AFTER the `context` block and BEFORE the `Unknown command` line, insert:

```ts
    if (command === 'generate') {
        const { runGenerate } = await import('./scout-cli/commands/generate');
        await runGenerate(rest);
        return;
    }
```

- [ ] **Step 4: Verify TypeScript**

```bash
npm run types:check
```

Expected: PASS for new files. The `@ts-expect-error` on the engine import is intentional because `engine.ts` carries `// @ts-nocheck`.

- [ ] **Step 5: Smoke-test generate**

```bash
npm run scout -- generate
```

Expected: a JSON object with `topN`, `results` (non-empty array), `filtered`. Each result has `rank`, `score`, `champions`, `activeTraits`, `roles`, `slotsUsed`, `metaMatch`, `breakdown`.

```bash
npm run scout -- generate --min-frontline 4
```

Expected: every result's `roles` string shows `fl:` ≥ 4 (counting fighters at 0.5 — verify by hand on at least one result).

```bash
npm run scout -- generate --full | head -20
```

Expected: raw `engine.generate` output (no smart summary), full champion records visible.

- [ ] **Step 6: Commit**

```bash
cd D:/Herd/tft-scout && git add scripts/scout-cli/format.ts scripts/scout-cli/commands/generate.ts scripts/scout-cli.ts && git commit -m "feat(scout-cli): add generate command with smart summary"
```

---

## Task 8: Phase command

**Files:**
- Create: `scripts/scout-cli/commands/phase.ts`
- Modify: `scripts/scout-cli.ts`

- [ ] **Step 1: Create the phase dispatcher**

Create `scripts/scout-cli/commands/phase.ts`:

```ts
import { readFileSync } from 'node:fs';

// @ts-expect-error — worker modules use // @ts-nocheck
import {
    buildExclusionLookup,
    filterCandidates,
    getLockedChampions,
} from '../../../resources/js/workers/scout/candidates';
// @ts-expect-error
import { buildGraph, findTeams } from '../../../resources/js/workers/scout/synergy-graph';
// @ts-expect-error
import { buildActiveTraits } from '../../../resources/js/workers/scout/active-traits';
// @ts-expect-error
import { teamRoleBalance, teamScore, teamScoreBreakdown } from '../../../resources/js/workers/scout/scorer';
// @ts-expect-error
import { buildTeamInsights } from '../../../resources/js/workers/scout/team-insights';
// @ts-expect-error
import { buildHeroExclusionGroup } from '../../../resources/js/workers/scout/hero-exclusion';

import { loadContext } from '../context';
import {
    summariseActiveTraits,
    summariseCandidates,
    summariseFindTeams,
    summariseGraph,
    summariseRoleBalance,
    summariseScore,
} from '../format';
import { findChampions } from '../lookup';
import { parseCommonArgs, type CommonArgs } from '../params';
import type { ScoutContext } from '../../../resources/js/workers/scout/types';

const PHASES = [
    'candidates',
    'graph',
    'find-teams',
    'score',
    'active-traits',
    'role-balance',
    'insights',
] as const;

type PhaseName = (typeof PHASES)[number];

export async function runPhase(argv: string[]): Promise<void> {
    const phase = argv[0] as PhaseName;
    if (!phase || !PHASES.includes(phase)) {
        throw new Error(`Phase command expects one of: ${PHASES.join(', ')}. Got: ${phase}`);
    }
    const args = parseCommonArgs(argv.slice(1));
    const ctx = await loadContext({ live: args.live, snapshotPath: args.snapshotPath });

    if (args.rawInputPath) {
        const raw = JSON.parse(readFileSync(args.rawInputPath, 'utf8'));
        const result = runPhaseRawInput(phase, raw);
        print(result, args.full);
        return;
    }

    const result = await runPhaseAutoBuild(phase, ctx, args);
    print(result, args.full);
}

function runPhaseRawInput(phase: PhaseName, raw: any): any {
    switch (phase) {
        case 'candidates':
            return filterCandidates(raw.champions, raw.constraints, raw.exclusionGroups);
        case 'graph':
            return buildGraph(raw.champions, raw.traits, raw.scoringCtx, raw.exclusionLookup);
        case 'find-teams':
            return findTeams(raw.graph, raw.options);
        case 'score':
            return teamScore(raw, raw.ctx ?? raw.scoringCtx);
        case 'active-traits':
            return buildActiveTraits(raw.champions, raw.traits, raw.emblems ?? []);
        case 'role-balance':
            return teamRoleBalance(raw.champions ?? raw);
        case 'insights':
            return buildTeamInsights(raw.team, raw.ctx, raw.batchMedianScore ?? 0);
    }
}

async function runPhaseAutoBuild(phase: PhaseName, ctx: ScoutContext, args: CommonArgs): Promise<any> {
    const constraints = constraintsFromArgs(args);
    const exclusionGroups = mergeHeroExclusion(ctx);

    if (phase === 'candidates') {
        const candidates = filterCandidates(ctx.champions, constraints, exclusionGroups);
        return args.full ? candidates : summariseCandidates(candidates);
    }

    const candidates = filterCandidates(ctx.champions, constraints, exclusionGroups);
    const locked = getLockedChampions(ctx.champions, constraints.lockedChampions ?? []);
    const eligible = [...locked, ...candidates];
    const exclusionLookup = buildExclusionLookup(exclusionGroups);

    if (phase === 'graph') {
        const graph = buildGraph(eligible, ctx.traits, ctx.scoringCtx, exclusionLookup);
        return args.full ? graph : summariseGraph(graph);
    }

    const graph = buildGraph(eligible, ctx.traits, ctx.scoringCtx, exclusionLookup);

    const level = (args.params.level ?? 8) as number;
    const teamSize = level - extraSlotsFromLocked(locked);
    const findOpts = {
        teamSize,
        startChamps: locked.map((c: any) => c.apiName),
        maxResults: ((args.params.topN ?? 10) as number) * 5,
        level,
        emblems: args.params.emblems ?? [],
        excludedTraits: args.params.excludedTraits ?? [],
        excludedChampions: args.params.excludedChampions ?? [],
        max5Cost: args.params.max5Cost ?? null,
        seed: args.params.seed ?? 0,
    };

    if (phase === 'find-teams') {
        const teams = findTeams(graph, findOpts);
        return args.full ? teams : summariseFindTeams(teams);
    }

    // The remaining phases all need a specific --team CSV.
    if (!args.team) {
        throw new Error(`Phase ${phase} requires --team A,B,C,... (champion apiNames).`);
    }
    const teamChamps = findChampions(ctx, args.team);

    if (phase === 'role-balance') {
        const balance = teamRoleBalance(teamChamps);
        return args.full ? balance : summariseRoleBalance(balance);
    }

    const activeTraits = buildActiveTraits(teamChamps, ctx.traits, args.params.emblems ?? []);

    if (phase === 'active-traits') {
        return args.full ? activeTraits : summariseActiveTraits(activeTraits);
    }

    if (phase === 'score') {
        const team = { champions: teamChamps, activeTraits, level };
        const score = teamScore(team, ctx.scoringCtx);
        const breakdown = teamScoreBreakdown(team, ctx.scoringCtx);
        const result = { score, breakdown };
        return args.full ? result : summariseScore(result);
    }

    if (phase === 'insights') {
        const team = {
            champions: teamChamps,
            activeTraits,
            level,
            score: teamScore({ champions: teamChamps, activeTraits, level }, ctx.scoringCtx),
            breakdown: teamScoreBreakdown({ champions: teamChamps, activeTraits, level }, ctx.scoringCtx),
            roles: teamRoleBalance(teamChamps),
            slotsUsed: teamChamps.reduce((s: number, c: any) => s + (c.slotsUsed ?? 1), 0),
        };
        return buildTeamInsights(team, { ...ctx.scoringCtx, stale: ctx.stale }, 0);
    }
}

function mergeHeroExclusion(ctx: ScoutContext): string[][] {
    const heroGroup = buildHeroExclusionGroup(ctx.champions);
    return heroGroup.length >= 2 ? [...(ctx.exclusionGroups ?? []), heroGroup] : ctx.exclusionGroups ?? [];
}

function extraSlotsFromLocked(locked: any[]): number {
    let extra = 0;
    for (const c of locked) if ((c.slotsUsed ?? 1) > 1) extra += (c.slotsUsed ?? 1) - 1;
    return extra;
}

function constraintsFromArgs(args: CommonArgs): any {
    return {
        lockedChampions: args.params.lockedChampions ?? [],
        excludedChampions: args.params.excludedChampions ?? [],
        lockedTraits: args.params.lockedTraits ?? [],
        excludedTraits: args.params.excludedTraits ?? [],
        emblems: args.params.emblems ?? [],
        max5Cost: args.params.max5Cost ?? null,
        roleBalance: args.params.roleBalance ?? null,
        minFrontline: args.params.minFrontline ?? 0,
        minDps: args.params.minDps ?? 0,
    };
}

function print(result: unknown, _full: boolean): void {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
```

- [ ] **Step 2: Wire phase into the dispatcher**

Update `scripts/scout-cli.ts`. Inside `main`, AFTER the `generate` block and BEFORE the `Unknown command` line, insert:

```ts
    if (command === 'phase') {
        const { runPhase } = await import('./scout-cli/commands/phase');
        await runPhase(rest);
        return;
    }
```

- [ ] **Step 3: Verify TypeScript**

```bash
npm run types:check
```

Expected: PASS for new files. Pre-existing UI auth errors unchanged. The `@ts-expect-error` annotations on worker imports are required because those modules use `// @ts-nocheck`.

- [ ] **Step 4: Smoke-test phases**

Run each of these against the existing snapshot:

```bash
npm run scout -- phase candidates
```

Expected: object with `count`, `byCost`, `byTrait`, `sample`. `count > 0`.

```bash
npm run scout -- phase graph
```

Expected: object with `nodes`, `edges`, `avgDegree`, `sampleEdges`. `nodes > 0`.

```bash
npm run scout -- phase find-teams --top-n 3
```

Expected: array of 3 (or fewer) objects each containing `champions`, `teamSize`, `slotsUsed`.

```bash
npm run scout -- phase find-teams --top-n 1 --full
```

Capture one team's champion apiNames from the output, then:

```bash
npm run scout -- phase score --team <those-8-apinames-csv>
```

Expected: `{ score: <number>, breakdown: {...} }`.

```bash
npm run scout -- phase active-traits --team <same-csv>
```

Expected: array of trait objects each with `apiName`, `count`, `style`, `breakpoint`.

```bash
npm run scout -- phase role-balance --team <same-csv>
```

Expected: object with `frontline`, `dps`, `fighter`, `effectiveFrontline`, `effectiveDps`.

```bash
npm run scout -- phase insights --team <same-csv>
```

Expected: a `TeamInsights` object (strengths / concerns arrays).

```bash
npm run scout -- phase score --team Foo,Bar
```

Expected: error `Unknown champion apiName: "Foo"...` to stderr, exit 1.

```bash
npm run scout -- phase score
```

Expected: error `Phase score requires --team A,B,C,...` to stderr, exit 1.

- [ ] **Step 5: Commit**

```bash
cd D:/Herd/tft-scout && git add scripts/scout-cli/commands/phase.ts scripts/scout-cli.ts && git commit -m "feat(scout-cli): add phase command for all 7 algorithm phases"
```

---

## Task 9: Final manual verification

**Files:** none (verification only)

This is the spec's testing section, run end-to-end. No code changes.

- [ ] **Step 1: Confirm Herd is running**

`http://localhost/api/scout/context` should return JSON. If Herd is not running, start it before continuing.

- [ ] **Step 2: Snapshot round-trip**

```bash
rm -f tmp/scout-context.json
npm run scout -- snapshot
npm run scout -- context
```

Expected: the second output's meta matches the `wrote` block from the first.

- [ ] **Step 3: Champion / trait lookup**

```bash
npm run scout -- context --champion Aatrox
npm run scout -- context --trait Vanguard
```

Expected: full records for each.

```bash
npm run scout -- context --champion Aatrxo
```

Expected: error with at least `Aatrox` in the suggestions.

- [ ] **Step 4: Generate parity**

```bash
npm run scout -- generate
```

Expected: non-empty `results`. Pick the top result and confirm its `champions`, `roles`, `score`, `activeTraits` look plausible.

```bash
npm run scout -- generate --min-frontline 4
```

For every result row, manually compute `roles.frontline + 0.5 * roles.fighter` and confirm it is `>= 4`. (The CLI only prints the integer counts, so the half-fighter math is on you.)

```bash
npm run scout -- generate --min-frontline 6 --min-dps 6
```

Expected: `results` is empty (or near-empty). No crash. `topN: 0`.

- [ ] **Step 5: Phase parity against generate**

```bash
npm run scout -- generate --top-n 1 --seed 0 --full > tmp/gen-top1.json
```

Read out the top result's champion apiNames from `tmp/gen-top1.json`. Then:

```bash
npm run scout -- phase score --team <those-apinames>
```

Expected: the `score` value matches the score field inside `tmp/gen-top1.json` (within rounding — generate rounds to 2 decimals via `index.ts` mapResult, the CLI rounds to 1). Document the comparison in the report.

- [ ] **Step 6: Live mode**

```bash
npm run scout -- generate --live --top-n 3
```

Expected: same shape as the snapshot version. Scores may differ if MetaTFT data refreshed between snapshot and now.

- [ ] **Step 7: Stop**

No commit. Just report results.

---

## Out of scope (do not implement)

- Watch mode / REPL.
- Modifying any worker module under `resources/js/workers/scout/`.
- Auth, multi-user, remote execution.
- A second fixture format alongside the snapshot file.
- Caching the snapshot for `--live` mode (`--live` always fetches fresh).
- Pretty terminal output (colours, tables). All output is JSON.
