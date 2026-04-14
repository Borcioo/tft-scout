# Scout Lab Sidecar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local SQLite sidecar that captures scout algorithm inputs and outputs, plus scout-cli subcommands for ad-hoc recording, bulk experiment runs, and aggregate analysis — so the assistant can diagnose algorithm bias and drift across many runs without touching the main app.

**Architecture:** One new directory `scripts/scout-cli/lab/` holds schema, db connection, ingest, experiment runner, and query helpers. Command handlers live as one-file-per-subcommand under `scripts/scout-cli/commands/lab/`, routed by a thin `scripts/scout-cli/commands/lab.ts` dispatcher. The existing `scripts/scout-cli.ts` gains two new top-level branches (`experiment`, `lab`), and the existing `generate` / `phase` commands gain a shared `--record <tag>` flag. Every write path is gated by `SCOUT_LAB_ENABLED=1` — unset means no-op for ingest and fail-fast for analysis commands.

**Tech Stack:** Node 18+ via `tsx`, new devDep `better-sqlite3` (synchronous, bundled binaries, WAL mode), native `node:fs` / `node:crypto`. Git SHA is read directly from `.git/HEAD` and friends via `node:fs` — no subprocess spawns, no dependency on a git binary. No test runner — verification is manual per the spec.

**Reference spec:** `docs/superpowers/specs/2026-04-14-scout-lab-sidecar-design.md`

---

## File map

| File | Responsibility | Action |
|---|---|---|
| `package.json` | npm deps | Modify — add `better-sqlite3` devDep |
| `scripts/scout-cli/lab/schema.sql` | DDL for all 6 tables + version row | Create |
| `scripts/scout-cli/lab/db.ts` | open connection, apply WAL pragmas, init schema, version check | Create |
| `scripts/scout-cli/lab/git.ts` | cached git SHA read via `.git/HEAD` + refs | Create |
| `scripts/scout-cli/lab/hash.ts` | normalised params → sha256 hex | Create |
| `scripts/scout-cli/lab/ingest.ts` | `recordRun(input, output, meta)` — single transactional write point | Create |
| `scripts/scout-cli/lab/experiment.ts` | matrix × repeat expansion, experiment loop | Create |
| `scripts/scout-cli/lab/presets.ts` | named experiment presets as a TS const map | Create |
| `scripts/scout-cli/lab/queries.ts` | named stats SQL + scope helper + markdown formatter | Create |
| `scripts/scout-cli/commands/experiment.ts` | `experiment` command handler + arg parser | Create |
| `scripts/scout-cli/commands/lab.ts` | `lab` umbrella dispatcher (init/query/stats/doctor/prune/reset) | Create |
| `scripts/scout-cli/commands/lab/init.ts` | `lab init` handler | Create |
| `scripts/scout-cli/commands/lab/doctor.ts` | `lab doctor` handler + SHA-drift warning | Create |
| `scripts/scout-cli/commands/lab/stats.ts` | `lab stats [name]` handler + scope flags | Create |
| `scripts/scout-cli/commands/lab/query.ts` | `lab query '<sql>'` handler (read-only + limit) | Create |
| `scripts/scout-cli/commands/lab/prune.ts` | `lab prune` handler (all filter variants) | Create |
| `scripts/scout-cli/commands/lab/reset.ts` | `lab reset` helper (wipe + init) | Create |
| `scripts/scout-cli/params.ts` | add `--record <tag>` flag to `CommonArgs` | Modify |
| `scripts/scout-cli/commands/generate.ts` | call `recordRun` after `generate` when args.tag set | Modify |
| `scripts/scout-cli/commands/phase.ts` | same, for phase commands | Modify |
| `scripts/scout-cli.ts` | HELP text + two new dispatch branches (`experiment`, `lab`) | Modify |
| `.claude/skills/scout-lab/SKILL.md` | assistant skill mirroring `scout-cli-debug` | Create |

---

## Task 1: Scaffold — better-sqlite3 dep, schema, db module

**Files:**
- Modify: `package.json`
- Create: `scripts/scout-cli/lab/schema.sql`
- Create: `scripts/scout-cli/lab/db.ts`

- [ ] **Step 1: Add better-sqlite3 devDep**

From `D:/Herd/tft-scout`, run:

```bash
npm install --save-dev better-sqlite3
```

Expected: `better-sqlite3` appears in `devDependencies` in `package.json`. Prebuilt binary downloads automatically, no node-gyp compile step required on Windows.

- [ ] **Step 2: Create `scripts/scout-cli/lab/schema.sql`**

Write this exact content:

```sql
CREATE TABLE IF NOT EXISTS runs (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  ts                 TEXT NOT NULL,
  source             TEXT NOT NULL,
  command            TEXT NOT NULL,
  tag                TEXT,
  experiment_id      TEXT,
  git_sha            TEXT,
  duration_ms        INTEGER,
  level              INTEGER,
  top_n              INTEGER,
  seed               INTEGER,
  min_frontline      INTEGER,
  min_dps            INTEGER,
  max_5cost          INTEGER,
  locked_json        TEXT,
  excluded_json      TEXT,
  locked_traits_json TEXT,
  emblems_json       TEXT,
  params_hash        TEXT NOT NULL,
  result_count       INTEGER NOT NULL,
  filtered_json      TEXT,
  notes              TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_ts ON runs(ts);
CREATE INDEX IF NOT EXISTS idx_runs_tag ON runs(tag);
CREATE INDEX IF NOT EXISTS idx_runs_exp ON runs(experiment_id);
CREATE INDEX IF NOT EXISTS idx_runs_hash ON runs(params_hash);

CREATE TABLE IF NOT EXISTS results (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id             INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  rank               INTEGER NOT NULL,
  score              REAL NOT NULL,
  slots_used         INTEGER,
  champions_json     TEXT NOT NULL,
  active_traits_json TEXT NOT NULL,
  roles_json         TEXT,
  breakdown_json     TEXT,
  meta_match_json    TEXT
);
CREATE INDEX IF NOT EXISTS idx_results_run ON results(run_id);
CREATE INDEX IF NOT EXISTS idx_results_score ON results(score);

CREATE TABLE IF NOT EXISTS champion_appearances (
  run_id    INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  result_id INTEGER NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  rank      INTEGER NOT NULL,
  api_name  TEXT NOT NULL,
  cost      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_champ_app_api ON champion_appearances(api_name);
CREATE INDEX IF NOT EXISTS idx_champ_app_run ON champion_appearances(run_id);

CREATE TABLE IF NOT EXISTS trait_appearances (
  run_id    INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  result_id INTEGER NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  rank      INTEGER NOT NULL,
  api_name  TEXT NOT NULL,
  count     INTEGER NOT NULL,
  style     TEXT
);
CREATE INDEX IF NOT EXISTS idx_trait_app_api ON trait_appearances(api_name);
CREATE INDEX IF NOT EXISTS idx_trait_app_run ON trait_appearances(run_id);

CREATE TABLE IF NOT EXISTS breakdown_components (
  run_id    INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  result_id INTEGER NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  rank      INTEGER NOT NULL,
  component TEXT NOT NULL,
  value     REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bd_comp ON breakdown_components(component);
CREATE INDEX IF NOT EXISTS idx_bd_run ON breakdown_components(run_id);

CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);
```

Note `IF NOT EXISTS` on every statement — this makes `db.ts` idempotent.

- [ ] **Step 3: Create `scripts/scout-cli/lab/db.ts`**

```ts
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_DB_PATH = 'tmp/scout-lab/runs.db';
export const CURRENT_SCHEMA_VERSION = 1;

const SCHEMA_PATH = resolve(
    dirname(fileURLToPath(import.meta.url)),
    'schema.sql',
);

export type Db = Database.Database;

export function assertLabEnabled(): void {
    if (process.env.SCOUT_LAB_ENABLED !== '1') {
        throw new Error(
            'Scout lab disabled. Set SCOUT_LAB_ENABLED=1 to use lab/experiment/record commands.',
        );
    }
}

/** Opens (and creates if missing) the DB file. Applies WAL pragmas. */
export function openDb(path: string = DEFAULT_DB_PATH, readonly = false): Db {
    mkdirSync(dirname(path), { recursive: true });
    const db = new Database(path, { readonly });
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    return db;
}

/** Applies schema.sql. Idempotent — safe on existing DBs. */
export function initSchema(db: Db): void {
    const sql = readFileSync(SCHEMA_PATH, 'utf8');
    db.exec(sql);
    const row = db
        .prepare('SELECT version FROM schema_version LIMIT 1')
        .get() as { version: number } | undefined;
    if (!row) {
        db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(
            CURRENT_SCHEMA_VERSION,
        );
    } else if (row.version !== CURRENT_SCHEMA_VERSION) {
        throw new Error(
            `Schema version mismatch: DB is v${row.version}, code expects v${CURRENT_SCHEMA_VERSION}. Migration not yet implemented — run \`npm run scout -- lab reset --yes\` to start fresh.`,
        );
    }
}

/** Assert the DB exists at the given path. Throws with init hint if not. */
export function assertDbExists(path: string = DEFAULT_DB_PATH): void {
    if (!existsSync(path)) {
        throw new Error(
            `DB not initialised at ${path}. Run: npm run scout -- lab init`,
        );
    }
}
```

- [ ] **Step 4: Verify TypeScript**

From `D:/Herd/tft-scout`:

```bash
npm run types:check
```

Expected: PASS for the new files. Pre-existing UI auth errors unchanged.

- [ ] **Step 5: Commit**

```bash
cd D:/Herd/tft-scout && git add package.json package-lock.json scripts/scout-cli/lab/schema.sql scripts/scout-cli/lab/db.ts && git commit -m "feat(scout-lab): add better-sqlite3 + schema + db connection module"
```

---

## Task 2: Utilities — git SHA (fs-based) + params hash

**Files:**
- Create: `scripts/scout-cli/lab/git.ts`
- Create: `scripts/scout-cli/lab/hash.ts`

The git SHA helper reads `.git/HEAD` directly from the filesystem. No subprocess is spawned; no dependency on a git binary being installed. Handles the three standard layouts: detached HEAD (raw SHA in the file), symbolic ref to a loose ref file under `.git/refs/...`, and packed refs via `.git/packed-refs`.

- [ ] **Step 1: Create `scripts/scout-cli/lab/git.ts`**

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let cached: string | null = null;

/**
 * Returns the current HEAD SHA by reading `.git/HEAD` directly.
 *
 * Handles:
 *   - detached HEAD                 → HEAD file contains a raw SHA
 *   - symbolic ref → loose ref file → `.git/refs/heads/<branch>`
 *   - symbolic ref → packed ref     → line inside `.git/packed-refs`
 *
 * Returns the literal string `'unknown'` if the checkout is not a git
 * repository or any read fails. Cached per process after the first call.
 */
export function currentGitSha(): string {
    if (cached !== null) return cached;
    try {
        const gitDir = resolve(process.cwd(), '.git');
        const head = readFileSync(resolve(gitDir, 'HEAD'), 'utf8').trim();

        if (!head.startsWith('ref: ')) {
            // Detached HEAD: the file IS the SHA.
            cached = head;
            return cached;
        }

        const refPath = head.slice(5).trim();
        try {
            cached = readFileSync(resolve(gitDir, refPath), 'utf8').trim();
        } catch {
            // Loose ref absent → check packed-refs.
            const packed = readFileSync(resolve(gitDir, 'packed-refs'), 'utf8');
            const line = packed
                .split('\n')
                .find((l) => l.endsWith(' ' + refPath));
            cached = line ? line.split(' ')[0] : 'unknown';
        }
    } catch {
        cached = 'unknown';
    }
    return cached;
}
```

- [ ] **Step 2: Create `scripts/scout-cli/lab/hash.ts`**

```ts
import { createHash } from 'node:crypto';

/**
 * Stable sha256 over a params object. Keys are sorted and null/undefined
 * values are dropped so semantically equal inputs always hash the same.
 */
export function paramsHash(params: Record<string, unknown>): string {
    return createHash('sha256').update(normalise(params)).digest('hex');
}

function normalise(value: unknown): string {
    if (value === null || value === undefined) return 'null';
    if (Array.isArray(value)) {
        return '[' + value.map(normalise).join(',') + ']';
    }
    if (typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, v]) => v !== null && v !== undefined)
            .sort(([a], [b]) => a.localeCompare(b));
        return '{' + entries.map(([k, v]) => `${k}:${normalise(v)}`).join(',') + '}';
    }
    return JSON.stringify(value);
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
npm run types:check
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd D:/Herd/tft-scout && git add scripts/scout-cli/lab/git.ts scripts/scout-cli/lab/hash.ts && git commit -m "feat(scout-lab): add fs-based git sha helper + params hash"
```

---

## Task 3: Ingest — recordRun transactional writer

**Files:**
- Create: `scripts/scout-cli/lab/ingest.ts`

- [ ] **Step 1: Create `scripts/scout-cli/lab/ingest.ts`**

One function: `recordRun(db, input, meta)`. Writes a row to `runs`, then for every result writes rows to `results` + `champion_appearances` + `trait_appearances` + `breakdown_components`, all inside a single `db.transaction(...)`.

```ts
import type { Db } from './db';
import { paramsHash } from './hash';

export type RecordRunInput = {
    params: {
        level?: number;
        topN?: number;
        seed?: number;
        minFrontline?: number;
        minDps?: number;
        max5Cost?: number | null;
        lockedChampions?: string[];
        excludedChampions?: string[];
        lockedTraits?: { apiName: string; minUnits: number }[];
        emblems?: { apiName: string; count: number }[];
    };
    results: any[];
    filtered?: Record<string, number> | null;
};

export type RecordRunMeta = {
    source: 'cli' | 'experiment' | 'phase';
    command: string;
    tag?: string | null;
    experimentId?: string | null;
    gitSha: string;
    durationMs: number;
    notes?: string | null;
};

/**
 * Record one scout run into the lab DB. Writes to all five tables
 * inside a single transaction. Returns the inserted run_id.
 */
export function recordRun(
    db: Db,
    input: RecordRunInput,
    meta: RecordRunMeta,
): number {
    const p = input.params;

    const insertRun = db.prepare(`
        INSERT INTO runs (
            ts, source, command, tag, experiment_id, git_sha, duration_ms,
            level, top_n, seed, min_frontline, min_dps, max_5cost,
            locked_json, excluded_json, locked_traits_json, emblems_json,
            params_hash, result_count, filtered_json, notes
        ) VALUES (
            @ts, @source, @command, @tag, @experiment_id, @git_sha, @duration_ms,
            @level, @top_n, @seed, @min_frontline, @min_dps, @max_5cost,
            @locked_json, @excluded_json, @locked_traits_json, @emblems_json,
            @params_hash, @result_count, @filtered_json, @notes
        )
    `);

    const insertResult = db.prepare(`
        INSERT INTO results (
            run_id, rank, score, slots_used,
            champions_json, active_traits_json, roles_json,
            breakdown_json, meta_match_json
        ) VALUES (
            @run_id, @rank, @score, @slots_used,
            @champions_json, @active_traits_json, @roles_json,
            @breakdown_json, @meta_match_json
        )
    `);

    const insertChamp = db.prepare(`
        INSERT INTO champion_appearances (run_id, result_id, rank, api_name, cost)
        VALUES (@run_id, @result_id, @rank, @api_name, @cost)
    `);

    const insertTrait = db.prepare(`
        INSERT INTO trait_appearances (run_id, result_id, rank, api_name, count, style)
        VALUES (@run_id, @result_id, @rank, @api_name, @count, @style)
    `);

    const insertBreakdown = db.prepare(`
        INSERT INTO breakdown_components (run_id, result_id, rank, component, value)
        VALUES (@run_id, @result_id, @rank, @component, @value)
    `);

    const tx = db.transaction(() => {
        const runRow = {
            ts: new Date().toISOString(),
            source: meta.source,
            command: meta.command,
            tag: meta.tag ?? null,
            experiment_id: meta.experimentId ?? null,
            git_sha: meta.gitSha,
            duration_ms: meta.durationMs,
            level: p.level ?? null,
            top_n: p.topN ?? null,
            seed: p.seed ?? null,
            min_frontline: p.minFrontline ?? 0,
            min_dps: p.minDps ?? 0,
            max_5cost: p.max5Cost ?? null,
            locked_json: JSON.stringify(p.lockedChampions ?? []),
            excluded_json: JSON.stringify(p.excludedChampions ?? []),
            locked_traits_json: JSON.stringify(p.lockedTraits ?? []),
            emblems_json: JSON.stringify(p.emblems ?? []),
            params_hash: paramsHash(p as Record<string, unknown>),
            result_count: input.results.length,
            filtered_json: input.filtered ? JSON.stringify(input.filtered) : null,
            notes: meta.notes ?? null,
        };
        const runInfo = insertRun.run(runRow);
        const runId = Number(runInfo.lastInsertRowid);

        input.results.forEach((r, idx) => {
            const rank = idx + 1;
            const resultInfo = insertResult.run({
                run_id: runId,
                rank,
                score: Number(r.score) || 0,
                slots_used: r.slotsUsed ?? null,
                champions_json: JSON.stringify(
                    (r.champions ?? []).map((c: any) => ({ apiName: c.apiName, cost: c.cost })),
                ),
                active_traits_json: JSON.stringify(r.activeTraits ?? []),
                roles_json: r.roles ? JSON.stringify(r.roles) : null,
                breakdown_json: r.breakdown ? JSON.stringify(r.breakdown) : null,
                meta_match_json: r.metaMatch ? JSON.stringify(r.metaMatch) : null,
            });
            const resultId = Number(resultInfo.lastInsertRowid);

            for (const c of r.champions ?? []) {
                insertChamp.run({
                    run_id: runId,
                    result_id: resultId,
                    rank,
                    api_name: c.apiName,
                    cost: c.cost ?? 0,
                });
            }

            for (const t of r.activeTraits ?? []) {
                insertTrait.run({
                    run_id: runId,
                    result_id: resultId,
                    rank,
                    api_name: t.apiName ?? t.name ?? 'unknown',
                    count: t.count ?? 0,
                    style: t.activeStyle ?? t.style ?? null,
                });
            }

            if (r.breakdown && typeof r.breakdown === 'object') {
                for (const [k, v] of Object.entries(r.breakdown)) {
                    if (typeof v === 'number') {
                        insertBreakdown.run({
                            run_id: runId,
                            result_id: resultId,
                            rank,
                            component: k,
                            value: v,
                        });
                    }
                }
            }
        });

        return runId;
    });

    return tx();
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npm run types:check
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd D:/Herd/tft-scout && git add scripts/scout-cli/lab/ingest.ts && git commit -m "feat(scout-lab): add recordRun transactional ingester"
```

---

## Task 4: lab init + lab doctor + dispatcher wire

**Files:**
- Create: `scripts/scout-cli/commands/lab.ts`
- Create: `scripts/scout-cli/commands/lab/init.ts`
- Create: `scripts/scout-cli/commands/lab/doctor.ts`
- Modify: `scripts/scout-cli.ts`

- [ ] **Step 1: Create `scripts/scout-cli/commands/lab/init.ts`**

```ts
import { assertLabEnabled, DEFAULT_DB_PATH, initSchema, openDb } from '../../lab/db';

export async function runLabInit(argv: string[]): Promise<void> {
    assertLabEnabled();
    let dbPath = DEFAULT_DB_PATH;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--db') dbPath = argv[++i];
        else throw new Error(`Unknown flag for lab init: ${a}`);
    }
    const db = openDb(dbPath);
    initSchema(db);
    process.stdout.write(
        JSON.stringify({ initialised: dbPath, schemaVersion: 1 }, null, 2) + '\n',
    );
    db.close();
}
```

- [ ] **Step 2: Create `scripts/scout-cli/commands/lab/doctor.ts`**

```ts
import { statSync } from 'node:fs';

import { currentGitSha } from '../../lab/git';
import { assertDbExists, DEFAULT_DB_PATH, openDb } from '../../lab/db';

export async function runLabDoctor(argv: string[]): Promise<void> {
    let dbPath = DEFAULT_DB_PATH;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--db') dbPath = argv[++i];
        else throw new Error(`Unknown flag for lab doctor: ${a}`);
    }
    assertDbExists(dbPath);
    const db = openDb(dbPath, true);

    const version = (
        db.prepare('SELECT version FROM schema_version LIMIT 1').get() as
            | { version: number }
            | undefined
    )?.version ?? null;

    const counts: Record<string, number> = {};
    for (const table of [
        'runs',
        'results',
        'champion_appearances',
        'trait_appearances',
        'breakdown_components',
    ]) {
        counts[table] = (
            db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }
        ).c;
    }

    const tsRow = db
        .prepare('SELECT MIN(ts) AS oldest, MAX(ts) AS newest FROM runs')
        .get() as { oldest: string | null; newest: string | null };

    const latestShaRow = db
        .prepare('SELECT git_sha FROM runs ORDER BY id DESC LIMIT 1')
        .get() as { git_sha: string | null } | undefined;
    const latestSha = latestShaRow?.git_sha ?? null;
    const workingSha = currentGitSha();

    const envEnabled = process.env.SCOUT_LAB_ENABLED === '1';
    const size = statSync(dbPath).size;

    const out: Record<string, unknown> = {
        dbPath,
        sizeBytes: size,
        schemaVersion: version,
        envEnabled,
        tableCounts: counts,
        oldestRun: tsRow.oldest,
        newestRun: tsRow.newest,
        latestRunSha: latestSha,
        workingTreeSha: workingSha,
        shaDrift:
            latestSha && workingSha !== 'unknown' && latestSha !== workingSha
                ? `WARNING: most recent recorded run was against ${latestSha}, current HEAD is ${workingSha}. Consider lab reset or lab prune --sha ${latestSha} before aggregating.`
                : null,
    };

    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    db.close();
}
```

- [ ] **Step 3: Create `scripts/scout-cli/commands/lab.ts`** (dispatcher stub — later tasks extend it)

```ts
export async function runLab(argv: string[]): Promise<void> {
    const sub = argv[0];
    const rest = argv.slice(1);
    if (!sub) throw new Error('lab requires a subcommand: init|doctor|stats|query|prune|reset');

    switch (sub) {
        case 'init': {
            const { runLabInit } = await import('./lab/init');
            return runLabInit(rest);
        }
        case 'doctor': {
            const { runLabDoctor } = await import('./lab/doctor');
            return runLabDoctor(rest);
        }
        default:
            throw new Error(`Unknown lab subcommand: ${sub}`);
    }
}
```

- [ ] **Step 4: Wire `lab` into `scripts/scout-cli.ts`**

Open `scripts/scout-cli.ts`. Inside `main`, AFTER the existing `phase` block and BEFORE the `Unknown command` line, insert:

```ts
    if (command === 'lab') {
        const { runLab } = await import('./scout-cli/commands/lab');
        await runLab(rest);
        return;
    }
```

- [ ] **Step 5: Verify TypeScript**

```bash
npm run types:check
```

Expected: PASS.

- [ ] **Step 6: Smoke-test lab init + doctor**

```bash
SCOUT_LAB_ENABLED=1 npm run scout -- lab init
```

Expected: JSON output `{"initialised": "tmp/scout-lab/runs.db", "schemaVersion": 1}`. File exists.

```bash
SCOUT_LAB_ENABLED=1 npm run scout -- lab doctor
```

Expected: JSON with `dbPath`, `sizeBytes`, `schemaVersion: 1`, `envEnabled: true`, `tableCounts` (all zeros), `oldestRun: null`, `newestRun: null`.

```bash
npm run scout -- lab init
```

Expected: error to stderr: `Scout lab disabled. Set SCOUT_LAB_ENABLED=1 ...`. Exit 1.

- [ ] **Step 7: Commit**

```bash
cd D:/Herd/tft-scout && git add scripts/scout-cli/commands/lab.ts scripts/scout-cli/commands/lab/init.ts scripts/scout-cli/commands/lab/doctor.ts scripts/scout-cli.ts && git commit -m "feat(scout-lab): add lab init + lab doctor commands"
```

---

## Task 5: --record flag on generate and phase

**Files:**
- Modify: `scripts/scout-cli/params.ts`
- Modify: `scripts/scout-cli/commands/generate.ts`
- Modify: `scripts/scout-cli/commands/phase.ts`

- [ ] **Step 1: Add `--record` to the common flag parser**

Open `scripts/scout-cli/params.ts`. Extend the `CommonArgs` type by adding `tag: string | null;` alongside `rawInputPath`:

```ts
export type CommonArgs = {
    params: ScoutParams;
    team: string[] | null;
    full: boolean;
    live: boolean;
    snapshotPath: string;
    rawInputPath: string | null;
    tag: string | null;
};
```

In `parseCommonArgs`, add `tag: null,` to the `out` literal alongside `rawInputPath: null,`. Then add a new `case` inside the switch, placed alphabetically near `--raw-input`:

```ts
            case '--record':
                out.tag = argv[++i];
                break;
```

- [ ] **Step 2: Record on `generate` when tag set**

Open `scripts/scout-cli/commands/generate.ts`. Add new imports at the top, alongside the existing ones:

```ts
import { assertLabEnabled, openDb } from '../lab/db';
import { currentGitSha } from '../lab/git';
import { recordRun } from '../lab/ingest';
```

Replace the body of `runGenerate` so that when `args.tag` is set, it wraps the `generate` call with a duration measurement and a `recordRun` post-step. The full new function body:

```ts
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

    const start = Date.now();
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
    const durationMs = Date.now() - start;

    if (args.tag) {
        assertLabEnabled();
        const db = openDb();
        try {
            const gitSha = currentGitSha();
            recordRun(
                db,
                {
                    params: {
                        level,
                        topN,
                        seed,
                        minFrontline,
                        minDps,
                        max5Cost,
                        lockedChampions,
                        excludedChampions,
                        lockedTraits,
                        emblems,
                    },
                    results: out,
                    filtered: null,
                },
                {
                    source: 'cli',
                    command: 'generate',
                    tag: args.tag,
                    gitSha,
                    durationMs,
                },
            );
        } finally {
            db.close();
        }
    }

    printResults(out, args.full);
}
```

- [ ] **Step 3: Record on `phase` when tag set**

Open `scripts/scout-cli/commands/phase.ts`. Add imports:

```ts
import { assertLabEnabled, openDb } from '../lab/db';
import { currentGitSha } from '../lab/git';
import { recordRun } from '../lab/ingest';
```

In `runPhase`, the current line `const result = await runPhaseAutoBuild(phase, ctx, args);` must be replaced with a measured + recorded block. Find that line and replace it with:

```ts
    const start = Date.now();
    const result = await runPhaseAutoBuild(phase, ctx, args);
    const durationMs = Date.now() - start;

    if (args.tag) {
        assertLabEnabled();
        const db = openDb();
        try {
            const gitSha = currentGitSha();
            recordRun(
                db,
                {
                    params: {
                        level: (args.params.level ?? 8) as number,
                        topN: (args.params.topN ?? 10) as number,
                        seed: (args.params.seed ?? 0) as number,
                        minFrontline: args.params.minFrontline ?? 0,
                        minDps: args.params.minDps ?? 0,
                        max5Cost: args.params.max5Cost ?? null,
                        lockedChampions: args.params.lockedChampions ?? [],
                        excludedChampions: args.params.excludedChampions ?? [],
                        lockedTraits: args.params.lockedTraits ?? [],
                        emblems: args.params.emblems ?? [],
                    },
                    results: Array.isArray(result) ? result : [result],
                    filtered: null,
                },
                {
                    source: 'phase',
                    command: `phase:${phase}`,
                    tag: args.tag,
                    gitSha,
                    durationMs,
                },
            );
        } finally {
            db.close();
        }
    }
```

The existing `print(result, args.full);` line stays right after this block.

- [ ] **Step 4: Verify TypeScript**

```bash
npm run types:check
```

Expected: PASS.

- [ ] **Step 5: Smoke-test --record**

```bash
SCOUT_LAB_ENABLED=1 SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 npm run scout -- generate --top-n 3 --record "t5-smoke"
```

Expected: normal generate output. Then:

```bash
SCOUT_LAB_ENABLED=1 npm run scout -- lab doctor
```

Expected: `tableCounts.runs >= 1`, `results > 0`, `champion_appearances > 0`, `trait_appearances > 0`, `breakdown_components > 0`. `newestRun` set.

```bash
npm run scout -- generate --top-n 1 --record "should-fail"
```

Expected: error about `SCOUT_LAB_ENABLED`, exit 1.

- [ ] **Step 6: Commit**

```bash
cd D:/Herd/tft-scout && git add scripts/scout-cli/params.ts scripts/scout-cli/commands/generate.ts scripts/scout-cli/commands/phase.ts && git commit -m "feat(scout-lab): add --record flag to generate and phase"
```

---

## Task 6: Experiment runner

**Files:**
- Create: `scripts/scout-cli/lab/presets.ts`
- Create: `scripts/scout-cli/lab/experiment.ts`
- Create: `scripts/scout-cli/commands/experiment.ts`
- Modify: `scripts/scout-cli.ts`

- [ ] **Step 1: Create `scripts/scout-cli/lab/presets.ts`**

```ts
export type Preset = {
    description: string;
    matrix: Record<string, (string | number | null)[]>;
};

export const PRESETS: Record<string, Preset> = {
    'role-filter-sweep': {
        description:
            'Grid all minFrontline x minDps combos 0..6 at level 8, three seeds.',
        matrix: {
            level: [8],
            minFrontline: [0, 1, 2, 3, 4, 5, 6],
            minDps: [0, 1, 2, 3, 4, 5, 6],
            seed: [1, 2, 3],
        },
    },
    'level-sweep': {
        description:
            'How top-N composition changes across levels 6..10, five seeds.',
        matrix: {
            level: [6, 7, 8, 9, 10],
            seed: [1, 2, 3, 4, 5],
        },
    },
};
```

- [ ] **Step 2: Create `scripts/scout-cli/lab/experiment.ts`**

```ts
import { randomUUID } from 'node:crypto';

// @ts-expect-error engine.ts uses // @ts-nocheck
import { generate } from '../../../resources/js/workers/scout/engine';
import type { ScoutContext } from '../../../resources/js/workers/scout/types';

import type { Db } from './db';
import { currentGitSha } from './git';
import { recordRun } from './ingest';
import { PRESETS, type Preset } from './presets';

export type ExperimentArgs = {
    preset: string | null;
    matrixJson: string | null;
    repeat: number | null;
    seedRange: [number, number] | null;
    tag: string | null;
    dedupe: boolean;
    baseLevel: number;
    baseTopN: number;
};

export type ExperimentResult = {
    experimentId: string;
    runs: number;
    totalMs: number;
    dedupSkipped: number;
};

/** Cartesian product over a matrix object. */
export function expandMatrix(
    matrix: Record<string, (string | number | null)[]>,
): Record<string, string | number | null>[] {
    const keys = Object.keys(matrix);
    if (keys.length === 0) return [{}];
    const combos: Record<string, string | number | null>[] = [{}];
    for (const k of keys) {
        const values = matrix[k];
        const next: Record<string, string | number | null>[] = [];
        for (const partial of combos) {
            for (const v of values) {
                next.push({ ...partial, [k]: v });
            }
        }
        combos.length = 0;
        combos.push(...next);
    }
    return combos;
}

export async function runExperiment(
    db: Db,
    ctx: ScoutContext,
    args: ExperimentArgs,
    onProgress: (done: number, total: number, combo: Record<string, unknown>) => void,
): Promise<ExperimentResult> {
    const experimentId = randomUUID();
    const gitSha = currentGitSha();

    let combos: Record<string, string | number | null>[] = [];

    if (args.preset) {
        const preset: Preset | undefined = PRESETS[args.preset];
        if (!preset)
            throw new Error(
                `Unknown preset: ${args.preset}. Available: ${Object.keys(PRESETS).join(', ')}`,
            );
        combos = expandMatrix(preset.matrix);
    } else if (args.matrixJson) {
        const parsed = JSON.parse(args.matrixJson) as Record<
            string,
            (string | number | null)[]
        >;
        combos = expandMatrix(parsed);
    } else if (args.repeat && args.seedRange) {
        const [lo, hi] = args.seedRange;
        combos = [];
        for (let s = lo; s <= hi; s++) combos.push({ seed: s });
    } else {
        throw new Error(
            'experiment requires one of: --preset, --matrix, or --repeat + --seed-range',
        );
    }

    const start = Date.now();
    let dedupSkipped = 0;
    const seenHashes = new Set<string>();

    for (let i = 0; i < combos.length; i++) {
        const combo = combos[i];
        onProgress(i + 1, combos.length, combo);

        const level = typeof combo.level === 'number' ? combo.level : args.baseLevel;
        const topN = typeof combo.topN === 'number' ? combo.topN : args.baseTopN;
        const seed = typeof combo.seed === 'number' ? combo.seed : 0;
        const minFrontline =
            typeof combo.minFrontline === 'number' ? combo.minFrontline : 0;
        const minDps = typeof combo.minDps === 'number' ? combo.minDps : 0;
        const max5Cost =
            typeof combo.max5Cost === 'number' ? combo.max5Cost : null;

        if (args.dedupe) {
            const key = JSON.stringify({
                level,
                topN,
                seed,
                minFrontline,
                minDps,
                max5Cost,
            });
            if (seenHashes.has(key)) {
                dedupSkipped++;
                continue;
            }
            seenHashes.add(key);
        }

        const runStart = Date.now();
        const out = generate({
            champions: ctx.champions,
            traits: ctx.traits,
            scoringCtx: ctx.scoringCtx,
            constraints: {
                lockedChampions: [],
                excludedChampions: [],
                lockedTraits: [],
                excludedTraits: [],
                emblems: [],
                max5Cost,
                roleBalance: null,
                minFrontline,
                minDps,
            },
            exclusionGroups: ctx.exclusionGroups,
            level,
            topN,
            seed,
            stale: ctx.stale,
        });
        const durationMs = Date.now() - runStart;

        try {
            recordRun(
                db,
                {
                    params: {
                        level,
                        topN,
                        seed,
                        minFrontline,
                        minDps,
                        max5Cost,
                        lockedChampions: [],
                        excludedChampions: [],
                        lockedTraits: [],
                        emblems: [],
                    },
                    results: out,
                    filtered: null,
                },
                {
                    source: 'experiment',
                    command: 'generate',
                    tag: args.tag,
                    experimentId,
                    gitSha,
                    durationMs,
                },
            );
        } catch (err) {
            process.stderr.write(
                `[experiment] run ${i + 1}/${combos.length} failed: ${(err as Error).message}\n`,
            );
        }
    }

    return {
        experimentId,
        runs: combos.length - dedupSkipped,
        totalMs: Date.now() - start,
        dedupSkipped,
    };
}
```

- [ ] **Step 3: Create `scripts/scout-cli/commands/experiment.ts`**

```ts
import { loadContext } from '../context';
import { assertLabEnabled, DEFAULT_DB_PATH, initSchema, openDb } from '../lab/db';
import { runExperiment, type ExperimentArgs } from '../lab/experiment';

type ExperimentCliArgs = ExperimentArgs & { live: boolean; snapshotPath: string };

function parseArgs(argv: string[]): ExperimentCliArgs {
    const out: ExperimentCliArgs = {
        preset: null,
        matrixJson: null,
        repeat: null,
        seedRange: null,
        tag: null,
        dedupe: false,
        baseLevel: 8,
        baseTopN: 10,
        live: false,
        snapshotPath: 'tmp/scout-context.json',
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        switch (a) {
            case '--preset':
                out.preset = argv[++i];
                break;
            case '--matrix':
                out.matrixJson = argv[++i];
                break;
            case '--repeat':
                out.repeat = Number(argv[++i]);
                break;
            case '--seed-range': {
                const [lo, hi] = argv[++i].split('-').map(Number);
                out.seedRange = [lo, hi];
                break;
            }
            case '--tag':
                out.tag = argv[++i];
                break;
            case '--dedupe':
                out.dedupe = true;
                break;
            case '--level':
                out.baseLevel = Number(argv[++i]);
                break;
            case '--top-n':
                out.baseTopN = Number(argv[++i]);
                break;
            case '--live':
                out.live = true;
                break;
            case '--snapshot':
                out.snapshotPath = argv[++i];
                break;
            default:
                throw new Error(`Unknown flag for experiment: ${a}`);
        }
    }
    return out;
}

export async function runExperimentCommand(argv: string[]): Promise<void> {
    assertLabEnabled();
    const args = parseArgs(argv);
    const ctx = await loadContext({ live: args.live, snapshotPath: args.snapshotPath });
    const db = openDb(DEFAULT_DB_PATH);
    initSchema(db);
    try {
        const result = await runExperiment(db, ctx, args, (done, total, combo) => {
            process.stderr.write(`[${done}/${total}] ${JSON.stringify(combo)}\n`);
        });
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } finally {
        db.close();
    }
}
```

- [ ] **Step 4: Wire `experiment` into dispatcher**

Open `scripts/scout-cli.ts`. Inside `main`, AFTER the existing `lab` block and BEFORE the `Unknown command` line, insert:

```ts
    if (command === 'experiment') {
        const { runExperimentCommand } = await import('./scout-cli/commands/experiment');
        await runExperimentCommand(rest);
        return;
    }
```

- [ ] **Step 5: Verify TypeScript**

```bash
npm run types:check
```

Expected: PASS.

- [ ] **Step 6: Smoke-test experiment (tiny matrix)**

```bash
SCOUT_LAB_ENABLED=1 SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 npm run scout -- experiment --matrix '{"level":[8],"minFrontline":[0,2],"seed":[1,2]}'
```

Expected: 4 progress lines on stderr, final JSON `{experimentId: "<uuid>", runs: 4, totalMs: N, dedupSkipped: 0}` on stdout.

```bash
SCOUT_LAB_ENABLED=1 npm run scout -- lab doctor
```

Expected: `runs` count bumped by 4.

- [ ] **Step 7: Commit**

```bash
cd D:/Herd/tft-scout && git add scripts/scout-cli/lab/presets.ts scripts/scout-cli/lab/experiment.ts scripts/scout-cli/commands/experiment.ts scripts/scout-cli.ts && git commit -m "feat(scout-lab): add experiment runner with matrix/preset/repeat modes"
```

---

## Task 7: Named stats queries

**Files:**
- Create: `scripts/scout-cli/lab/queries.ts`

- [ ] **Step 1: Create `scripts/scout-cli/lab/queries.ts`**

```ts
export type Scope = {
    experimentId: string | null;
    tag: string | null;
    lastN: number | null;
    since: string | null;
    all: boolean;
};

/** Build the SQL subquery that scopes downstream queries to a subset of runs. */
export function scopeRunIdSubquery(scope: Scope): {
    sql: string;
    params: Record<string, unknown>;
} {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};
    if (scope.experimentId) {
        clauses.push('experiment_id = @experimentId');
        params.experimentId = scope.experimentId;
    }
    if (scope.tag) {
        clauses.push('tag = @tag');
        params.tag = scope.tag;
    }
    if (scope.since) {
        clauses.push('ts >= @since');
        params.since = scope.since;
    }
    const where = clauses.length > 0 ? 'WHERE ' + clauses.join(' AND ') : '';
    const limit =
        scope.all || scope.lastN === null
            ? ''
            : ' ORDER BY ts DESC LIMIT ' + Number(scope.lastN);
    return {
        sql: `SELECT id FROM runs ${where} ${limit}`,
        params,
    };
}

export type StatDef = {
    description: string;
    build: (scope: Scope) => { sql: string; params: Record<string, unknown> };
};

export const STATS: Record<string, StatDef> = {
    summary: {
        description:
            'Totals: runs, results, time span, unique experiments, tags, git SHAs',
        build: (scope) => {
            const sub = scopeRunIdSubquery(scope);
            return {
                sql: `
                    WITH scoped AS (${sub.sql})
                    SELECT
                        (SELECT COUNT(*) FROM scoped) AS runs,
                        (SELECT COUNT(*) FROM results WHERE run_id IN scoped) AS results,
                        (SELECT MIN(ts) FROM runs WHERE id IN scoped) AS oldest,
                        (SELECT MAX(ts) FROM runs WHERE id IN scoped) AS newest,
                        (SELECT COUNT(DISTINCT experiment_id) FROM runs WHERE id IN scoped AND experiment_id IS NOT NULL) AS experiments,
                        (SELECT COUNT(DISTINCT tag) FROM runs WHERE id IN scoped AND tag IS NOT NULL) AS tags,
                        (SELECT COUNT(DISTINCT git_sha) FROM runs WHERE id IN scoped) AS gitShas
                `,
                params: sub.params,
            };
        },
    },
    'top-champions': {
        description:
            'Top 20 champions by appearance count in rank-1 within scope',
        build: (scope) => {
            const sub = scopeRunIdSubquery(scope);
            return {
                sql: `
                    SELECT api_name, COUNT(*) AS appearances
                    FROM champion_appearances
                    WHERE run_id IN (${sub.sql}) AND rank = 1
                    GROUP BY api_name
                    ORDER BY appearances DESC
                    LIMIT 20
                `,
                params: sub.params,
            };
        },
    },
    'top-champions-by-rank': {
        description: 'Champion x rank count matrix (pivot externally)',
        build: (scope) => {
            const sub = scopeRunIdSubquery(scope);
            return {
                sql: `
                    SELECT api_name, rank, COUNT(*) AS appearances
                    FROM champion_appearances
                    WHERE run_id IN (${sub.sql})
                    GROUP BY api_name, rank
                    ORDER BY api_name, rank
                `,
                params: sub.params,
            };
        },
    },
    'dead-champions': {
        description:
            'Champions that appeared in zero top-N results within scope',
        build: (scope) => {
            const sub = scopeRunIdSubquery(scope);
            return {
                sql: `
                    SELECT DISTINCT api_name
                    FROM champion_appearances
                    WHERE api_name NOT IN (
                        SELECT DISTINCT api_name FROM champion_appearances
                        WHERE run_id IN (${sub.sql})
                    )
                    ORDER BY api_name
                `,
                params: sub.params,
            };
        },
    },
    'top-traits': {
        description: 'Top 20 traits by total appearance count',
        build: (scope) => {
            const sub = scopeRunIdSubquery(scope);
            return {
                sql: `
                    SELECT api_name, COUNT(*) AS appearances, AVG(count) AS avgCount
                    FROM trait_appearances
                    WHERE run_id IN (${sub.sql})
                    GROUP BY api_name
                    ORDER BY appearances DESC
                    LIMIT 20
                `,
                params: sub.params,
            };
        },
    },
    'trait-dominance': {
        description:
            'Per trait: avg count, fraction of scoped results where active',
        build: (scope) => {
            const sub = scopeRunIdSubquery(scope);
            return {
                sql: `
                    SELECT api_name,
                           COUNT(*) AS appearances,
                           AVG(count) AS avgCount,
                           ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM results WHERE run_id IN (${sub.sql})), 2) AS activePct
                    FROM trait_appearances
                    WHERE run_id IN (${sub.sql})
                    GROUP BY api_name
                    ORDER BY appearances DESC
                `,
                params: sub.params,
            };
        },
    },
    'breakdown-distribution': {
        description:
            'Per scoring component: min / max / avg across scoped results',
        build: (scope) => {
            const sub = scopeRunIdSubquery(scope);
            return {
                sql: `
                    SELECT component,
                           MIN(value)  AS min,
                           MAX(value)  AS max,
                           ROUND(AVG(value), 2) AS avg,
                           COUNT(*)    AS samples
                    FROM breakdown_components
                    WHERE run_id IN (${sub.sql})
                    GROUP BY component
                    ORDER BY component
                `,
                params: sub.params,
            };
        },
    },
    'score-by-filter': {
        description:
            'Avg score and result count grouped by (level, minFrontline, minDps)',
        build: (scope) => {
            const sub = scopeRunIdSubquery(scope);
            return {
                sql: `
                    SELECT r.level, r.min_frontline AS minFL, r.min_dps AS minDps,
                           COUNT(DISTINCT r.id) AS runs,
                           ROUND(AVG(res.score), 2) AS avgScore,
                           ROUND(AVG(r.result_count), 2) AS avgResults
                    FROM runs r
                    LEFT JOIN results res ON res.run_id = r.id
                    WHERE r.id IN (${sub.sql})
                    GROUP BY r.level, r.min_frontline, r.min_dps
                    ORDER BY r.level, r.min_frontline, r.min_dps
                `,
                params: sub.params,
            };
        },
    },
    'meta-match-rate': {
        description: 'Fraction of results with a meta match',
        build: (scope) => {
            const sub = scopeRunIdSubquery(scope);
            return {
                sql: `
                    SELECT
                        ROUND(100.0 * SUM(CASE WHEN meta_match_json IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 2) AS matchPct,
                        COUNT(*) AS total
                    FROM results
                    WHERE run_id IN (${sub.sql})
                `,
                params: sub.params,
            };
        },
    },
    'role-balance-distribution': {
        description: 'Frequency of fl/dps/fighter combos in rank-1 results',
        build: (scope) => {
            const sub = scopeRunIdSubquery(scope);
            return {
                sql: `
                    SELECT roles_json, COUNT(*) AS n
                    FROM results
                    WHERE run_id IN (${sub.sql}) AND rank = 1
                    GROUP BY roles_json
                    ORDER BY n DESC
                `,
                params: sub.params,
            };
        },
    },
    'filter-breaking-points': {
        description: 'Matrix: (minFrontline, minDps) -> avg result_count',
        build: (scope) => {
            const sub = scopeRunIdSubquery(scope);
            return {
                sql: `
                    SELECT min_frontline AS minFL, min_dps AS minDps,
                           COUNT(*) AS runs,
                           ROUND(AVG(result_count), 2) AS avgResults
                    FROM runs
                    WHERE id IN (${sub.sql})
                    GROUP BY min_frontline, min_dps
                    ORDER BY min_frontline, min_dps
                `,
                params: sub.params,
            };
        },
    },
};

/** Render rows as a markdown table. */
export function rowsToMarkdown(
    columns: string[],
    rows: Record<string, unknown>[],
): string {
    if (rows.length === 0) return '_(no rows)_\n';
    const header = '| ' + columns.join(' | ') + ' |';
    const sep = '| ' + columns.map(() => '---').join(' | ') + ' |';
    const body = rows
        .map(
            (r) =>
                '| ' + columns.map((c) => String(r[c] ?? '')).join(' | ') + ' |',
        )
        .join('\n');
    return [header, sep, body].join('\n') + '\n';
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npm run types:check
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd D:/Herd/tft-scout && git add scripts/scout-cli/lab/queries.ts && git commit -m "feat(scout-lab): add named stats queries + scope helper"
```

---

## Task 8: lab stats command

**Files:**
- Create: `scripts/scout-cli/commands/lab/stats.ts`
- Modify: `scripts/scout-cli/commands/lab.ts`

- [ ] **Step 1: Create `scripts/scout-cli/commands/lab/stats.ts`**

```ts
import { assertDbExists, DEFAULT_DB_PATH, openDb } from '../../lab/db';
import { rowsToMarkdown, STATS, type Scope } from '../../lab/queries';

export async function runLabStats(argv: string[]): Promise<void> {
    let name: string | null = null;
    const scope: Scope = {
        experimentId: null,
        tag: null,
        lastN: 500,
        since: null,
        all: false,
    };
    let asJson = false;
    let dbPath = DEFAULT_DB_PATH;

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith('--') && name === null) {
            name = a;
            continue;
        }
        switch (a) {
            case '--experiment':
                scope.experimentId = argv[++i];
                break;
            case '--tag':
                scope.tag = argv[++i];
                break;
            case '--last':
                scope.lastN = Number(argv[++i]);
                break;
            case '--since':
                scope.since = argv[++i];
                break;
            case '--all':
                scope.all = true;
                break;
            case '--json':
                asJson = true;
                break;
            case '--db':
                dbPath = argv[++i];
                break;
            default:
                throw new Error(`Unknown flag for lab stats: ${a}`);
        }
    }

    if (!name) {
        const lines = ['Available stats:', ''];
        for (const [key, def] of Object.entries(STATS)) {
            lines.push(`  ${key}  -  ${def.description}`);
        }
        lines.push('');
        lines.push(
            'Scope flags: --experiment <id> --tag <label> --last <N> (default 500) --since <iso> --all',
        );
        process.stdout.write(lines.join('\n') + '\n');
        return;
    }

    const def = STATS[name];
    if (!def) {
        throw new Error(`Unknown stat: ${name}. Run 'lab stats' for the list.`);
    }

    assertDbExists(dbPath);
    const db = openDb(dbPath, true);
    db.pragma('query_only = ON');
    try {
        const { sql, params } = def.build(scope);
        const stmt = db.prepare(sql);
        const rows = stmt.all(params) as Record<string, unknown>[];
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
        if (asJson) {
            process.stdout.write(
                JSON.stringify({ name, scope, columns, rows }, null, 2) + '\n',
            );
        } else {
            process.stdout.write(`# ${name}\n\n${def.description}\n\n`);
            process.stdout.write(rowsToMarkdown(columns, rows));
        }
    } finally {
        db.close();
    }
}
```

- [ ] **Step 2: Wire `stats` into the lab dispatcher**

Open `scripts/scout-cli/commands/lab.ts`. Add a new case after `doctor`:

```ts
        case 'stats': {
            const { runLabStats } = await import('./lab/stats');
            return runLabStats(rest);
        }
```

- [ ] **Step 3: Verify TypeScript**

```bash
npm run types:check
```

Expected: PASS.

- [ ] **Step 4: Smoke-test stats**

```bash
SCOUT_LAB_ENABLED=1 npm run scout -- lab stats
```

Expected: list of all available stat names with descriptions.

```bash
SCOUT_LAB_ENABLED=1 npm run scout -- lab stats summary
```

Expected: markdown table with `runs`, `results`, `oldest`, `newest`, `experiments`, `tags`, `gitShas`.

```bash
SCOUT_LAB_ENABLED=1 npm run scout -- lab stats top-champions
```

Expected: markdown table with `api_name | appearances`.

- [ ] **Step 5: Commit**

```bash
cd D:/Herd/tft-scout && git add scripts/scout-cli/commands/lab/stats.ts scripts/scout-cli/commands/lab.ts && git commit -m "feat(scout-lab): add lab stats command with default --last 500 scope"
```

---

## Task 9: lab query command

**Files:**
- Create: `scripts/scout-cli/commands/lab/query.ts`
- Modify: `scripts/scout-cli/commands/lab.ts`

- [ ] **Step 1: Create `scripts/scout-cli/commands/lab/query.ts`**

```ts
import { assertDbExists, DEFAULT_DB_PATH, openDb } from '../../lab/db';

export async function runLabQuery(argv: string[]): Promise<void> {
    let sql: string | null = null;
    let limit = 1000;
    let asCsv = false;
    let dbPath = DEFAULT_DB_PATH;

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith('--') && sql === null) {
            sql = a;
            continue;
        }
        switch (a) {
            case '--limit':
                limit = Number(argv[++i]);
                break;
            case '--csv':
                asCsv = true;
                break;
            case '--db':
                dbPath = argv[++i];
                break;
            default:
                throw new Error(`Unknown flag for lab query: ${a}`);
        }
    }

    if (!sql) {
        throw new Error(
            'lab query requires a SQL string as the first positional argument.',
        );
    }

    assertDbExists(dbPath);
    const db = openDb(dbPath, true);
    db.pragma('query_only = ON');

    try {
        const stmt = db.prepare(sql);
        const rows = stmt.all() as Record<string, unknown>[];
        const sliced = rows.slice(0, limit);
        const columns = sliced.length > 0 ? Object.keys(sliced[0]) : [];

        if (asCsv) {
            const lines = [columns.join(',')];
            for (const r of sliced) {
                lines.push(columns.map((c) => csvField(r[c])).join(','));
            }
            process.stdout.write(lines.join('\n') + '\n');
        } else {
            process.stdout.write(
                JSON.stringify(
                    {
                        columns,
                        rows: sliced,
                        truncated: rows.length > limit ? rows.length - limit : 0,
                    },
                    null,
                    2,
                ) + '\n',
            );
        }
    } finally {
        db.close();
    }
}

function csvField(value: unknown): string {
    if (value === null || value === undefined) return '';
    const s = String(value);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}
```

- [ ] **Step 2: Wire `query` into the lab dispatcher**

Open `scripts/scout-cli/commands/lab.ts`. Add after `stats`:

```ts
        case 'query': {
            const { runLabQuery } = await import('./lab/query');
            return runLabQuery(rest);
        }
```

- [ ] **Step 3: Verify TypeScript**

```bash
npm run types:check
```

Expected: PASS.

- [ ] **Step 4: Smoke-test query**

```bash
SCOUT_LAB_ENABLED=1 npm run scout -- lab query 'SELECT COUNT(*) AS n FROM runs'
```

Expected: `{"columns":["n"],"rows":[{"n":<number>}], "truncated": 0}`.

```bash
SCOUT_LAB_ENABLED=1 npm run scout -- lab query 'SELECT api_name, COUNT(*) c FROM champion_appearances GROUP BY api_name ORDER BY c DESC LIMIT 5'
```

Expected: top-5 rows.

```bash
SCOUT_LAB_ENABLED=1 npm run scout -- lab query 'DELETE FROM runs' 2>&1 | tail -3
```

Expected: error (read-only pragma blocks writes). Row count unchanged.

- [ ] **Step 5: Commit**

```bash
cd D:/Herd/tft-scout && git add scripts/scout-cli/commands/lab/query.ts scripts/scout-cli/commands/lab.ts && git commit -m "feat(scout-lab): add read-only lab query command"
```

---

## Task 10: lab prune command

**Files:**
- Create: `scripts/scout-cli/commands/lab/prune.ts`
- Modify: `scripts/scout-cli/commands/lab.ts`

- [ ] **Step 1: Create `scripts/scout-cli/commands/lab/prune.ts`**

```ts
import { assertDbExists, DEFAULT_DB_PATH, openDb } from '../../lab/db';

type PruneArgs = {
    olderThan: string | null;
    experimentId: string | null;
    tag: string | null;
    sha: string | null;
    all: boolean;
    yes: boolean;
    dbPath: string;
};

function parseDuration(s: string): number {
    const m = /^(\d+)([hdw])$/.exec(s);
    if (!m) throw new Error(`Bad duration "${s}". Use e.g. 6h, 7d, 2w.`);
    const n = Number(m[1]);
    const mult: Record<string, number> = { h: 3600, d: 86400, w: 604800 };
    return n * mult[m[2]] * 1000;
}

export async function runLabPrune(argv: string[]): Promise<void> {
    const args: PruneArgs = {
        olderThan: null,
        experimentId: null,
        tag: null,
        sha: null,
        all: false,
        yes: false,
        dbPath: DEFAULT_DB_PATH,
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        switch (a) {
            case '--older-than':
                args.olderThan = argv[++i];
                break;
            case '--experiment':
                args.experimentId = argv[++i];
                break;
            case '--tag':
                args.tag = argv[++i];
                break;
            case '--sha':
                args.sha = argv[++i];
                break;
            case '--all':
                args.all = true;
                break;
            case '--yes':
                args.yes = true;
                break;
            case '--db':
                args.dbPath = argv[++i];
                break;
            default:
                throw new Error(`Unknown flag for lab prune: ${a}`);
        }
    }

    if (args.all && !args.yes) {
        throw new Error('lab prune --all requires --yes to confirm');
    }

    assertDbExists(args.dbPath);
    const db = openDb(args.dbPath);

    try {
        let whereSql = '';
        const params: Record<string, unknown> = {};

        if (args.all) {
            whereSql = '';
        } else if (args.experimentId) {
            whereSql = 'WHERE experiment_id = @experimentId';
            params.experimentId = args.experimentId;
        } else if (args.tag) {
            whereSql = 'WHERE tag = @tag';
            params.tag = args.tag;
        } else if (args.sha) {
            whereSql = 'WHERE git_sha = @sha';
            params.sha = args.sha;
        } else if (args.olderThan) {
            const cutoff = new Date(
                Date.now() - parseDuration(args.olderThan),
            ).toISOString();
            whereSql = 'WHERE ts < @cutoff';
            params.cutoff = cutoff;
        } else {
            throw new Error(
                'lab prune requires one of: --older-than, --experiment, --tag, --sha, --all --yes',
            );
        }

        const del = db.prepare(`DELETE FROM runs ${whereSql}`);
        const tx = db.transaction(() => del.run(params));
        const info = tx();
        process.stdout.write(
            JSON.stringify({ deleted: Number(info.changes) }, null, 2) + '\n',
        );
    } finally {
        db.close();
    }
}
```

- [ ] **Step 2: Wire `prune` into the lab dispatcher**

Open `scripts/scout-cli/commands/lab.ts`. Add after `query`:

```ts
        case 'prune': {
            const { runLabPrune } = await import('./lab/prune');
            return runLabPrune(rest);
        }
```

- [ ] **Step 3: Verify TypeScript**

```bash
npm run types:check
```

Expected: PASS.

- [ ] **Step 4: Smoke-test prune**

```bash
SCOUT_LAB_ENABLED=1 npm run scout -- lab prune --tag "t5-smoke"
```

Expected: `{"deleted": 1}`. Cascade deletes wipe linked results and appearances via the ON DELETE CASCADE FK.

```bash
SCOUT_LAB_ENABLED=1 npm run scout -- lab prune --all
```

Expected: error about requiring `--yes`.

```bash
SCOUT_LAB_ENABLED=1 npm run scout -- lab prune --all --yes
```

Expected: all row counts drop to zero. `lab doctor` confirms.

- [ ] **Step 5: Commit**

```bash
cd D:/Herd/tft-scout && git add scripts/scout-cli/commands/lab/prune.ts scripts/scout-cli/commands/lab.ts && git commit -m "feat(scout-lab): add lab prune with tag/experiment/sha/age filters"
```

---

## Task 11: lab reset command

**Files:**
- Create: `scripts/scout-cli/commands/lab/reset.ts`
- Modify: `scripts/scout-cli/commands/lab.ts`

- [ ] **Step 1: Create `scripts/scout-cli/commands/lab/reset.ts`**

```ts
import { existsSync, unlinkSync } from 'node:fs';

import { assertLabEnabled, DEFAULT_DB_PATH, initSchema, openDb } from '../../lab/db';

export async function runLabReset(argv: string[]): Promise<void> {
    assertLabEnabled();
    let dbPath = DEFAULT_DB_PATH;
    let yes = false;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--db') dbPath = argv[++i];
        else if (a === '--yes') yes = true;
        else throw new Error(`Unknown flag for lab reset: ${a}`);
    }

    if (!yes) {
        throw new Error('lab reset wipes all recorded runs. Pass --yes to confirm.');
    }

    if (existsSync(dbPath)) {
        unlinkSync(dbPath);
    }
    const db = openDb(dbPath);
    initSchema(db);
    db.close();

    process.stdout.write(
        JSON.stringify({ reset: dbPath, schemaVersion: 1 }, null, 2) + '\n',
    );
}
```

- [ ] **Step 2: Wire `reset` into the lab dispatcher**

Open `scripts/scout-cli/commands/lab.ts`. Add after `prune`:

```ts
        case 'reset': {
            const { runLabReset } = await import('./lab/reset');
            return runLabReset(rest);
        }
```

- [ ] **Step 3: Verify TypeScript**

```bash
npm run types:check
```

Expected: PASS.

- [ ] **Step 4: Smoke-test reset**

```bash
SCOUT_LAB_ENABLED=1 npm run scout -- lab reset
```

Expected: error about `--yes`.

```bash
SCOUT_LAB_ENABLED=1 npm run scout -- lab reset --yes
```

Expected: `{"reset": "tmp/scout-lab/runs.db", "schemaVersion": 1}`. `lab doctor` shows empty tables.

- [ ] **Step 5: Commit**

```bash
cd D:/Herd/tft-scout && git add scripts/scout-cli/commands/lab/reset.ts scripts/scout-cli/commands/lab.ts && git commit -m "feat(scout-lab): add lab reset helper (wipe + init)"
```

---

## Task 12: Update scout-cli HELP text

**Files:**
- Modify: `scripts/scout-cli.ts`

- [ ] **Step 1: Extend the HELP constant**

Open `scripts/scout-cli.ts`. The `HELP` constant currently lists commands up to `phase`. Replace the entire Commands block (from `Commands:` through the blank line before `Common flags:`) with:

```
Commands:
  snapshot              Fetch /api/scout/context and write tmp/scout-context.json
  snapshot --inspect    Fetch but print meta to stdout instead of writing
  context               Print meta of the saved snapshot
  context --champion N  Print one champion record from the saved snapshot
  context --trait N     Print one trait record from the saved snapshot
  generate [flags]      Run engine.generate end-to-end
  phase <name> [flags]  Run a single phase (candidates|graph|find-teams|score|active-traits|role-balance|insights)
  experiment [flags]    Bulk runner — --preset <name> | --matrix '<json>' | --repeat N --seed-range A-B
  lab init              Create tmp/scout-lab/runs.db and apply schema
  lab doctor            Print DB health, row counts, and SHA-drift warning
  lab stats [name]      Run a named aggregate query (default scope: last 500 runs)
  lab query '<sql>'     Run a read-only SQL query against the lab DB
  lab prune [flags]     Delete runs by --tag, --experiment, --sha, --older-than, or --all --yes
  lab reset --yes       Wipe the DB and re-initialise the schema
```

Also append to the existing `Common flags:` block a new line right after `--raw-input ...`:

```
  --record <tag>        Capture this run into tmp/scout-lab/runs.db (requires SCOUT_LAB_ENABLED=1)
```

Also append at the very bottom of the HELP literal (before the closing backtick):

```
Env vars:
  SCOUT_LAB_ENABLED=1           Enables --record, experiment, and lab ... commands
  SCOUT_API_BASE=<url>          Override default http://localhost for --live / snapshot
  NODE_TLS_REJECT_UNAUTHORIZED  Set to 0 when hitting Herd's self-signed cert
```

- [ ] **Step 2: Verify HELP output**

```bash
npm run scout -- --help
```

Expected: new commands visible, `--record` listed, env var block at the bottom.

- [ ] **Step 3: Commit**

```bash
cd D:/Herd/tft-scout && git add scripts/scout-cli.ts && git commit -m "docs(scout-cli): extend HELP with lab/experiment commands + env vars"
```

---

## Task 13: Final manual verification

**Files:** none — pure verification.

Runs the nine checks from the spec's Testing section end-to-end.

- [ ] **Step 1: Fresh init**

```bash
rm -f tmp/scout-lab/runs.db
SCOUT_LAB_ENABLED=1 npm run scout -- lab init
```

Expected: DB created, schema v1.

- [ ] **Step 2: Doctor on empty DB**

```bash
SCOUT_LAB_ENABLED=1 npm run scout -- lab doctor
```

Expected: all counts 0, `oldestRun: null`, `newestRun: null`, `shaDrift: null`.

- [ ] **Step 3: Record via --record**

```bash
SCOUT_LAB_ENABLED=1 SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 npm run scout -- generate --top-n 5 --record smoke
```

Expected: normal JSON output. Then:

```bash
SCOUT_LAB_ENABLED=1 npm run scout -- lab doctor
```

Expected: `runs: 1`, `results: 5`, non-zero `champion_appearances`, `trait_appearances`, `breakdown_components`.

- [ ] **Step 4: Summary stat**

```bash
SCOUT_LAB_ENABLED=1 npm run scout -- lab stats summary
```

Expected: markdown table with matching totals.

- [ ] **Step 5: Experiment preset**

```bash
SCOUT_LAB_ENABLED=1 SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 npm run scout -- experiment --preset role-filter-sweep
```

Expected: 7 × 7 × 3 = 147 progress lines on stderr, final JSON with `runs: 147`, `experimentId: "<uuid>"`.

- [ ] **Step 6: Scoped stats**

Capture the `experimentId` from step 5. Then:

```bash
SCOUT_LAB_ENABLED=1 npm run scout -- lab stats top-champions --experiment <id>
```

Expected: non-empty markdown table.

```bash
SCOUT_LAB_ENABLED=1 npm run scout -- lab stats filter-breaking-points --experiment <id>
```

Expected: 49-row matrix.

- [ ] **Step 7: Raw query**

```bash
SCOUT_LAB_ENABLED=1 npm run scout -- lab query 'SELECT COUNT(*) AS n FROM runs'
```

Expected: single cell with the post-experiment count.

- [ ] **Step 8: Prune one experiment**

```bash
SCOUT_LAB_ENABLED=1 npm run scout -- lab prune --experiment <id>
```

Expected: `{"deleted": 147}`. `lab doctor` confirms drop.

- [ ] **Step 9: Reset**

```bash
SCOUT_LAB_ENABLED=1 npm run scout -- lab reset --yes
SCOUT_LAB_ENABLED=1 npm run scout -- lab doctor
```

Expected: all counts zero again.

- [ ] **Step 10: Env-disabled fail-fast**

```bash
npm run scout -- lab stats summary 2>&1 | tail -3
```

Expected: `Scout lab disabled. Set SCOUT_LAB_ENABLED=1...` on stderr, exit 1.

- [ ] **Step 11: No commit**

This task has no code changes. If everything passes, mark complete.

---

## Task 14: Assistant skill for scout-lab

**Files:**
- Create: `.claude/skills/scout-lab/SKILL.md`

- [ ] **Step 1: Create `.claude/skills/scout-lab/SKILL.md`**

```markdown
---
name: scout-lab
description: Use when analysing scout algorithm behaviour across many runs — questions like "which champions dominate rank 1", "which never appear", "is this trait over-represented", "how does score breakdown shift with level", "compare two experiment sessions", or any time a single debug run with scout-cli is not enough. Captures input/output pairs into a local SQLite sidecar and runs aggregate queries.
---

# Scout Lab

## What it is

Local SQLite sidecar at `tmp/scout-lab/runs.db` that records every `scout-cli generate --record <tag>` call and every `scout-cli experiment` run. Read via `scout-cli lab stats` (named aggregate queries) or `scout-cli lab query '<sql>'` (raw read-only SQL). Zero UI — the assistant answers questions by running queries and returning markdown tables.

Spec: `docs/superpowers/specs/2026-04-14-scout-lab-sidecar-design.md`.

## Required env

```bash
export SCOUT_LAB_ENABLED=1
export SCOUT_API_BASE=https://tft-scout.test
export NODE_TLS_REJECT_UNAUTHORIZED=0
```

Without `SCOUT_LAB_ENABLED=1` every lab/experiment/record command exits 1 with a hint — by design.

## First time in a session

```bash
SCOUT_LAB_ENABLED=1 npm run scout -- lab reset --yes     # wipe any stale DB
SCOUT_LAB_ENABLED=1 npm run scout -- lab doctor          # confirm empty + schema v1
```

Then either capture ad-hoc runs with `--record <tag>` or kick off a bulk experiment.

## Stale-data rule (read this before every analysis)

`lab stats` defaults to `--last 500`. `lab query` has no default. Always one of:

1. `lab reset --yes` for a clean session, OR
2. Scope every stat/query to `--experiment <id>` or `--tag <label>`, OR
3. Check `lab doctor` first — it prints a `shaDrift: WARNING ...` line when the most recent recorded run was against a different git SHA than HEAD. If drift is present, prune or reset before aggregating.

Do not run `lab stats --all` against mixed data without a reason.

## Command map

| Goal | Command |
|---|---|
| Init empty DB | `npm run scout -- lab init` |
| Health check + SHA drift warning | `npm run scout -- lab doctor` |
| Wipe and re-init | `npm run scout -- lab reset --yes` |
| Record one ad-hoc run | `npm run scout -- generate --top-n 5 --record "debug-X"` |
| Bulk experiment from preset | `npm run scout -- experiment --preset role-filter-sweep` |
| Bulk experiment from inline matrix | `npm run scout -- experiment --matrix '{"level":[7,8,9],"minFrontline":[0,2,4]}'` |
| Repeat same input N seeds | `npm run scout -- experiment --repeat 100 --seed-range 1-100` |
| List all named stats | `npm run scout -- lab stats` |
| Run a named stat | `npm run scout -- lab stats top-champions --experiment <id>` |
| Raw SQL | `npm run scout -- lab query 'SELECT ...'` |
| Prune one experiment | `npm run scout -- lab prune --experiment <id>` |
| Prune by git SHA | `npm run scout -- lab prune --sha <sha>` |
| Prune by age | `npm run scout -- lab prune --older-than 7d` |

## Named stats

| name | answers |
|---|---|
| `summary` | Totals: runs, results, time span, unique experiments, tags, git SHAs |
| `top-champions` | Top 20 champions by rank-1 appearance count |
| `top-champions-by-rank` | Champion × rank count matrix |
| `dead-champions` | Champions that never appeared in any scoped top-N |
| `top-traits` | Top 20 traits by total appearance count + avg count |
| `trait-dominance` | Per trait: avg count + % of results active |
| `breakdown-distribution` | Per scoring component: min/max/avg/samples |
| `score-by-filter` | Avg score × result count grouped by (level, minFL, minDps) |
| `meta-match-rate` | Fraction of results with a meta match |
| `role-balance-distribution` | Frequency of fl/dps/fighter combos in rank-1 |
| `filter-breaking-points` | (minFL, minDps) → avg result_count matrix |

Every stat accepts `--experiment <id>`, `--tag <label>`, `--last <N>` (default 500), `--since <iso>`, `--all`, `--json`.

## Token efficiency

`ctx_execute` for anything that might exceed 20 lines. Pass an `intent` like `"top champion appearance counts"`, `"breakdown components distribution"`, `"experiment diff two ids"`. Then `ctx_search` for specific sections.

| Command | Tool |
|---|---|
| `lab doctor`, `lab stats summary`, `lab stats meta-match-rate`, `lab init`, `lab reset`, `lab prune` | Bash |
| `lab stats top-champions`, `lab stats breakdown-distribution`, `lab stats filter-breaking-points` | ctx_execute with intent |
| `lab query` (unless you know it returns <5 rows) | ctx_execute with intent |
| `experiment --preset role-filter-sweep` | ctx_execute — 147 progress lines on stderr |

## Debug recipes

**"Which champions dominate rank 1 in the current session?"**
```bash
SCOUT_LAB_ENABLED=1 npm run scout -- lab stats top-champions --experiment <id>
```

**"Which champions NEVER appear in top-N?"**
```bash
SCOUT_LAB_ENABLED=1 npm run scout -- lab stats dead-champions --experiment <id>
```

**"Does trait X dominate regardless of filters?"**
```bash
SCOUT_LAB_ENABLED=1 npm run scout -- lab stats trait-dominance --experiment <id>
```

**"Compare two experiment sessions (before vs after an algorithm change)"**
```bash
SCOUT_LAB_ENABLED=1 npm run scout -- lab query "
  SELECT api_name,
         SUM(CASE WHEN r.experiment_id = '<id1>' THEN 1 ELSE 0 END) AS before_n,
         SUM(CASE WHEN r.experiment_id = '<id2>' THEN 1 ELSE 0 END) AS after_n
  FROM champion_appearances c JOIN runs r ON r.id = c.run_id
  WHERE r.experiment_id IN ('<id1>', '<id2>')
  GROUP BY api_name
  ORDER BY ABS(before_n - after_n) DESC
  LIMIT 30
"
```

**"Score drift across levels"**
```bash
SCOUT_LAB_ENABLED=1 npm run scout -- lab stats score-by-filter --experiment <id>
```

**"Is this filter cutting too much at level 8?"**
1. Run `experiment --preset role-filter-sweep`
2. `lab stats filter-breaking-points --experiment <id>` to see the cliff
3. Cross-reference with UI

## When NOT to use

- Single-team debug ("why does this comp score X") → use `scout-cli-debug` skill, no ingest needed
- Frontend/UI questions → browser
- Anything in `legacy/` — that's reference code, scout-lab only records the live worker

## Common mistakes

| Mistake | Fix |
|---|---|
| Forgot `SCOUT_LAB_ENABLED=1` | Every lab/experiment/record command fails fast — add the env var |
| Running `stats --all` without checking SHA drift | Always `lab doctor` first; use `lab reset --yes` or scope to an `--experiment` |
| Comparing stats across old + new algorithm runs | Prune with `lab prune --sha <old-sha>` or start clean with `lab reset --yes` |
| Missing `--experiment` on follow-up stats after `experiment` command | Capture the returned `experimentId` and pass it to every subsequent stat |
| Using `lab query` for a write (`DELETE`, `UPDATE`) | Read-only pragma blocks writes — use `lab prune` instead |
```

- [ ] **Step 2: Commit**

```bash
cd D:/Herd/tft-scout && git add .claude/skills/scout-lab/SKILL.md && git commit -m "docs(skill): add scout-lab skill for assistant"
```

---

## Out of scope (do not implement)

- Any web UI.
- Schema migrations (only the version row is stored; migrations are a future spec).
- Auto-capture in the worker, PHP backend, or browser.
- CSV export beyond the single `lab query --csv` flag.
- Remote SQLite or multi-user access.
- Automatic retention (only manual `lab prune` / `lab reset`).
- Unit tests (project has no test runner; verification is manual per Task 13).
