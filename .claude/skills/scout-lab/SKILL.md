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

Without `SCOUT_LAB_ENABLED=1` EVERY `lab ...`, `experiment`, and `--record` command exits 1 with a hint. Read commands are gated the same as write commands — by design, to prevent accidentally analysing a DB you didn't mean to.

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
3. Check `lab doctor` first — it prints `shaDrift: WARNING ...` when the most recent recorded run was against a different git SHA than HEAD. If drift is present, prune or reset before aggregating.

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

All commands require `SCOUT_LAB_ENABLED=1` prefixed or exported.

## Presets

Shipping with two:

| name | matrix | combos |
|---|---|---|
| `role-filter-sweep` | level=8 × minFrontline 0..6 × minDps 0..6 × seed 1..3 | 147 |
| `level-sweep` | level 6..10 × seed 1..5 | 25 |

Add new presets to `scripts/scout-cli/lab/presets.ts` as needed.

## Named stats

| name | answers |
|---|---|
| `summary` | Totals: runs, results, time span, unique experiments, tags, git SHAs |
| `top-champions` | Top 20 champions by rank-1 appearance count within scope |
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
| `experiment --preset role-filter-sweep` | ctx_execute — 147 progress lines on stderr, ~70s runtime |
| `experiment --preset level-sweep` | ctx_execute — 25 progress lines, ~12s runtime |

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
1. Run `experiment --preset role-filter-sweep` (147 runs covering 0..6 × 0..6 × 3 seeds)
2. `lab stats filter-breaking-points --experiment <id>` to see the cliff
3. Cross-reference with UI expectations

## Workflow sequence for a bias investigation

1. `lab reset --yes` (clean slate) OR note the current `experimentId` from an ongoing session
2. `experiment --preset role-filter-sweep` (or custom matrix)
3. Capture the returned `experimentId` from stdout
4. `lab stats top-champions --experiment <id>` → who dominates
5. `lab stats dead-champions --experiment <id>` → who never appears
6. `lab stats filter-breaking-points --experiment <id>` → filter cliffs
7. `lab stats breakdown-distribution --experiment <id>` → scoring component balance
8. Ad-hoc `lab query` for anything else not covered by named stats
9. When done: keep the DB for later comparison, or `lab prune --experiment <id>` / `lab reset --yes`

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
| Running `experiment` without `SCOUT_API_BASE` set | Experiment needs fresh context → fetch fails without Herd base URL env |
| Running the long `role-filter-sweep` preset through `Bash` | Use `ctx_execute` with timeout 300000 — 147 progress lines on stderr otherwise burn context |
