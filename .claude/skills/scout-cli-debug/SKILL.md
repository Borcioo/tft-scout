---
name: scout-cli-debug
description: Use when debugging the TFT scout algorithm in this repo — questions like "why does this comp score X", "is filter Y a bug or real constraint", "what does phase Z return for input W", or any time you'd otherwise read worker code or open the browser to verify behavior. Project-local CLI runs the real worker functions with controlled inputs and prints JSON.
---

# Scout CLI Debug

## What it is

`scripts/scout-cli.ts` is a Node CLI that imports the real TS worker modules from `resources/js/workers/scout/` via `tsx` and lets you run `engine.generate` end-to-end OR any individual phase against a controlled input. JSON to stdout, no browser needed. Spec: `docs/superpowers/specs/2026-04-14-scout-cli-debug-tool-design.md`.

## Required env (copy this verbatim)

```bash
export SCOUT_API_BASE=https://tft-scout.test
export NODE_TLS_REJECT_UNAUTHORIZED=0
```

Herd serves the project at `https://tft-scout.test` with a self-signed cert. Without these, `--live` and the first `snapshot` fail. `localhost` returns 404. Once the snapshot exists at `tmp/scout-context.json`, subsequent commands work without env (snapshot reads from disk).

## First time in a session

```bash
SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 npm run scout -- snapshot
```

Writes `tmp/scout-context.json`. Refresh only when MetaTFT data may have changed or schema drifted.

## apiName prefix (very common foot-gun)

Every champion and trait apiName is prefixed with **`TFT17_`**. `Aatrox` → `TFT17_Aatrox`. Hero variants: `TFT17_Aatrox_hero`. The lookup gives "Did you mean" hints, but you save a roundtrip by writing the prefix from the start.

Find the right apiName fast:
```bash
npm run scout -- context --champion TFT17_Aatrox    # full record dump
npm run scout -- context --champion Aatrox          # error message lists matches
```

## Command map

| Goal | Command |
|---|---|
| Full pipeline, top-N | `npm run scout -- generate --top-n 5` |
| Same with role filter | `npm run scout -- generate --min-frontline 4 --min-dps 4` |
| Lock champions | `npm run scout -- generate --locked TFT17_Aatrox,TFT17_Jinx` |
| Lock trait min count | `npm run scout -- generate --locked-trait TFT17_DRX:4` |
| Emblem | `npm run scout -- generate --emblem TFT17_Vanguard:1` |
| Reproducible run | `npm run scout -- generate --seed 42` |
| Full raw output (no smart summary) | add `--full` to any cmd |
| Live re-fetch | add `--live` to any cmd |
| What's in the snapshot | `npm run scout -- context` |
| Champion record | `npm run scout -- context --champion TFT17_Aatrox` |
| Trait record | `npm run scout -- context --trait TFT17_DRX` |

Phases (use when you suspect a single layer is wrong):

| Phase | Command | Returns |
|---|---|---|
| `candidates` | `phase candidates [flags]` | filtered champion pool + counts by cost/trait |
| `graph` | `phase graph [flags]` | `{nodes, edges, avgDegree, sampleEdges}` |
| `find-teams` | `phase find-teams --top-n N` | rawTeams BEFORE scoring/validComps filter |
| `score` | `phase score --team A,B,C,...` | `{score, breakdown}` for exactly that team |
| `active-traits` | `phase active-traits --team A,B,...` | activeTraits with style + breakpoint |
| `role-balance` | `phase role-balance --team A,B,...` | `{frontline, dps, fighter, effectiveFrontline, effectiveDps}` |
| `insights` | `phase insights --team A,B,...` | TeamInsights strengths/concerns |

`--team` always takes 8 (or `level`) full apiNames including `TFT17_` prefix.

## Debug recipes

**"Is this filter cutting too much, or is it a real constraint?"**
```bash
npm run scout -- generate --top-n 50 --min-frontline 6 --min-dps 6
# → topN: 0 means no team satisfies; topN > 0 means filter works.
# Reduce one filter at a time to find the breaking point.
```

**"Why does engine score this team X but I expected Y?"**
1. `ctx_execute` (intent: `"top team champion apiNames and breakdown"`) running `npm run scout -- generate --top-n 1 --full`
2. `ctx_search` for the champion list of rank 1
3. `npm run scout -- phase score --team <those-apinames>` (Bash — small output) for isolated scoring
4. Compare `breakdown` keys

If `ctx_execute` is not available, swap step 1 for `npm run scout -- generate --top-n 1 --full > tmp/gen.json` then read champions out of the file.

**"Why is this champion missing from results?"**
```bash
npm run scout -- phase candidates | grep -i "TFT17_X"   # is it in the candidate pool?
npm run scout -- context --champion TFT17_X             # cost / traits / role correct?
```

**"What traits does this 8-champ comp activate?"**
```bash
npm run scout -- phase active-traits --team TFT17_A,TFT17_B,...,TFT17_H
```

**"Compare two scoring runs deterministically"**
Always pass `--seed 42` (or any fixed integer). Without `--seed`, comp ordering can drift.

## Token efficiency — prefer ctx_execute for large outputs

If `mcp__context-mode__ctx_execute` is available in the session, **prefer it over `Bash` for any scout-cli call that may exceed ~20 lines**. Pass `intent` so the indexer captures the result and only returns section titles + previews instead of dumping the full output into context.

| Command shape | Tool to use |
|---|---|
| `snapshot --inspect`, `context` (meta only), `phase score`, `phase role-balance` | `Bash` — output is small (<2 KB) |
| `generate --top-n 1..10` smart summary | `Bash` |
| `generate --top-n 20+` smart summary | `ctx_execute` with `intent` |
| Anything with `--full` | **always** `ctx_execute` with `intent` |
| `phase graph --full`, `phase find-teams --full --top-n 10+` | **always** `ctx_execute` with `intent` |
| `context --champion <X>` (one record) | `Bash` |
| `phase candidates` (smart summary) | `Bash` (~1.5 KB) |
| `phase candidates --full` | `ctx_execute` with `intent` |

`ctx_execute` invocation pattern:

```
language: shell
code:    cd /d/Herd/tft-scout && SCOUT_API_BASE=https://tft-scout.test \
         NODE_TLS_REJECT_UNAUTHORIZED=0 \
         npm run scout -- generate --top-n 5 --full 2>&1
intent:  "top scoring teams with score breakdown and active traits"
timeout: 60000
```

Use `mcp__context-mode__ctx_search` afterwards to retrieve specific sections by champion name, score, trait apiName, etc. Two-call pattern: execute once → search many. A single `generate --top-n 5 --full` produces ~60 KB of JSON; through `ctx_execute` only ~1 KB of summary + searchable terms enters context.

**Writing a good `intent`:** name the *fields you care about* in plain English using technical terms that will appear in the output (e.g. `"breakdown scores by component"`, `"active traits with style and breakpoint"`, `"champion roles fl dps fighter"`). Bad intent = useless index.

## Output format

Default: smart summary (token-efficient JSON). Pass `--full` for raw worker return value.

`generate` summary fields:
- `topN`, `results[]`, `filtered{rawTeams, enriched, afterValidComps, afterTopN}`
- per result: `rank`, `score`, `champions[]`, `activeTraits` (one-line string), `roles` (`fl:N dps:N fighter:N`), `slotsUsed`, `metaMatch`, `breakdown`
- `filtered.rawTeams` and `filtered.enriched` are `-1` because `engine.generate` does not expose those counters — known limitation, not a bug

`breakdown` keys: `champions`, `traits`, `affinity`, `companions`, `synergy`, `balance`, `total`, `proven`, `orphan`. Higher = better. Negative `balance` = role-balance soft penalty kicked in.

## When NOT to use

- Frontend layout/styling questions → use the browser at `/scout`
- Questions about how data is fetched from CDragon/MetaTFT → backend, not the worker
- Anything in `legacy/` directory — that is reference code, scout-cli only loads the live worker

## Common mistakes

| Mistake | Fix |
|---|---|
| `Aatrox` not `TFT17_Aatrox` | Always include the `TFT17_` prefix; lookup error suggests the right one |
| Skipping env vars on first run | Snapshot/`--live` need both `SCOUT_API_BASE` and `NODE_TLS_REJECT_UNAUTHORIZED=0` |
| Stale snapshot suspected → ignored | Re-run `snapshot` (or pass `--live` for one-off) |
| Reading full output every time | Use smart summary; only add `--full` when you need a specific raw field |
| Running `--full` through `Bash` | If `mcp__context-mode__ctx_execute` exists, use it with an `intent` — see "Token efficiency" |
| Comparing two runs without `--seed` | Add `--seed 42` to both for deterministic comp ordering |
| Looking at `engine.ts` for the answer | Run the CLI first; reading code is slower and error-prone |

## Quick verify CLI is healthy

```bash
SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 npm run scout -- snapshot --inspect
```

Should print champion/trait/exclusionGroup counts within 1-2s. If it fails, Herd is not running or cert env vars are missing.
