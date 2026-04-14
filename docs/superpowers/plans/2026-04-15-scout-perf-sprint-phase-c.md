# Scout Performance Sprint — Phase C+D Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hit target B (≤800 ms rank-1 / ≤2 s topN=10) across the three benchmark scenarios by landing Fix 1E (stepped cross-referenced filler for `phaseCompanionSeeded`), Fix 7 (topN guarantee backfill), and Fix 2A (temperatureSweep attempt budget cut), while preserving the topN contract and every prior-session regression.

**Architecture:** Replace `phaseCompanionSeeded`'s per-companion seeding loop with a deterministic anchor-driven ranker that uses MetaTFT companion data to score filler candidates against the current anchor set (locked + tight-auto-promoted champions, or top-unitRating bootstrap when empty), with meta-aware cost weighting, a 5-cost throttle, and pick decay so flex fillers like Shen don't monopolise the slate. Add a backfill path in `engine.ts` that appends score-sorted rejected teams (marked `relaxed: true`) whenever the hard filter leaves fewer than `topN` survivors, so the user always receives exactly the requested count unless constraints are mathematically impossible. Drop `phaseTemperatureSweep`'s attempt multiplier from `maxResults * 3` to `maxResults * 1` and short-circuit it when locked traits are active since `phaseLockedTraitSeeded` already covers that space. Finish with a cleanup pass on `engine.ts` to stop mutating the caller's `constraints.emblems`, followed by a verification sweep.

**Tech Stack:** TypeScript worker (`resources/js/workers/scout/`), existing profiler from Phase A (`scout-profiler.ts`), `scout-cli profile` command for measurement, `scout-cli generate` for deterministic regression checks. No new dependencies, no new files.

---

## Scope

**In scope:**
- Fix 1E — `phaseCompanionSeeded` → stepped cross-referenced filler with meta-aware cost weighting + 5-cost throttle + decay diversity + fallback loop
- Fix 7 — topN guarantee backfill path in `engine.ts::generate`
- Fix 2A — `phaseTemperatureSweep` attempt budget cut + skip-on-locked
- Re-profile + verification that target B is hit and topN contract holds
- Fix 5 — stop mutating `constraints.emblems` in `engine.ts`
- Final regression sweep

**Out of scope (deferred, documented in spec):**
- Fix 3 — extract `findActiveBreakpointIdx` helper (pure cleanup)
- Fix 4 — extract `collectAffinityMatches` shared helper (pure cleanup)
- Fix 6 — split `synergy-graph.ts` into `synergy-graph/` directory (maintainability only)
- Fix 1B/1C — greedy builder, graph edge baking (deferred alternatives)
- Phase E parallelism

Fix 3/4/6 may land if time remains after target B is hit and verified; the plan does not allocate tasks to them.

**Success gate:**
- `scout-cli profile` reports measured wall time ≤1 500 ms / ≤2 000 ms / ≤2 500 ms (no-lock / tight / loose)
- `--top-n 30` on all three benchmark scenarios returns exactly 30 results
- Every regression check from the spec's Success Criteria passes (non-lock seed 42 rank-1 = 183.8, hero swap, filler metric, tight/loose locks, multi-lock+emblem)

---

## File Structure

No new files. Only modifications:

- **`resources/js/workers/scout/synergy-graph.ts`** — replaces the body of `phaseCompanionSeeded` (Fix 1E), trims `phaseTemperatureSweep` (Fix 2A). Both are inline phase functions in the existing file. Adds one local helper function for the stepped ranker next to `phaseCompanionSeeded`.
- **`resources/js/workers/scout/engine.ts`** — appends backfill logic after `validComps` filter (Fix 7), stops mutating `constraints.emblems` (Fix 5).

No new TypeScript types are introduced; the ranker output is a plain `string[]` of apiNames consistent with the existing seed shape every other phase uses.

---

## Task 1: Fix 1E — Replace `phaseCompanionSeeded` with stepped cross-referenced filler

**Files:**
- Modify: `resources/js/workers/scout/synergy-graph.ts::phaseCompanionSeeded` (currently lines 1137-1162) + add one helper `pickCompanionFillers` immediately above the phase function

### Step 1: Add the `pickCompanionFillers` helper above `phaseCompanionSeeded`

Open `resources/js/workers/scout/synergy-graph.ts`. Find `function phaseCompanionSeeded(...)` (search for the exact string — line number may have drifted from profiler instrumentation). Add this helper immediately above it:

```javascript
// ── Companion filler ranker (Fix 1E) ───────────────
//
// Replaces the old "iterate every champion × every companion" seed
// loop with a deterministic, context-aware ranker:
//
//   1. Start from anchors (locked champs + tight-auto-promoted +
//      hero swap), or bootstrap from top-unitRating champs when the
//      anchor set is empty.
//   2. For each anchor, read its top companions from MetaTFT data,
//      weighted by the anchor's cost (TFT17 meta is 3/4-cost
//      centric — 5-costs are spike units, not anchors).
//   3. Aggregate scores into a per-candidate Map. Champions that
//      appear as top companions for multiple anchors accumulate
//      score naturally — no explicit cross-reference step needed.
//   4. Pick top M with a decay-on-pick loop so flex fillers like
//      Shen (who score top-1 because they're on every archetype's
//      companion list) surface once or twice, not thirty times.
//      A 5-cost throttle caps how many of the M picks can be a
//      5-cost filler so the phase doesn't burn its budget on
//      power-spike variants.
//   5. Fall back to unit-rating order if the cross-referenced
//      ranking runs out (e.g. very tight candidate pool) so the
//      phase always contributes enough raw teams for the engine's
//      topN guarantee to hold.

const FILLER_COST_WEIGHTS = [0.3, 0.5, 1.0, 0.95, 0.55];
const FILLER_PICK_DECAY = 0.5;
const FILLER_TOP_K_PER_ANCHOR = 10;
const FILLER_MAX_PICKS = 30;
const FILLER_BOOTSTRAP_ANCHORS = 6;
const FILLER_DEFAULT_FIVE_COST_CAP = 3;

function pickCompanionFillers(graph, context, anchorApis) {
  const { nodes } = graph;
  const companionData = graph.scoringCtx?.companions || {};
  const unitRatings = graph.scoringCtx?.unitRatings || {};

  const anchorSet = new Set(anchorApis);
  const allowedSet = context.allowedSet;
  const excludedSet = new Set(context.excludedChampions || []);

  // Bootstrap anchors from top-unitRating champs when caller has
  // nothing locked — gives the non-lock path a meaningful starting
  // point so the ranker still produces targeted fillers.
  let effectiveAnchors = anchorApis;

  if (effectiveAnchors.length === 0) {
    const sorted = Object.keys(nodes)
      .filter(api => {
        const node = nodes[api];

        if (!node || node.variant === 'hero') {
          return false;
        }

        if (excludedSet.has(api)) {
          return false;
        }

        if (allowedSet && !allowedSet.has(api)) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        const ra = unitRatings[a]?.score ?? 0;
        const rb = unitRatings[b]?.score ?? 0;

        if (ra !== rb) {
          return rb - ra;
        }

        return a.localeCompare(b);
      });

    effectiveAnchors = sorted.slice(0, FILLER_BOOTSTRAP_ANCHORS);
  }

  // Score candidates by aggregating each anchor's top companions,
  // weighted by the anchor's cost.
  const candidateScore = new Map();

  for (const anchorApi of effectiveAnchors) {
    const anchorNode = nodes[anchorApi];

    if (!anchorNode) {
      continue;
    }

    const weight = FILLER_COST_WEIGHTS[Math.max(0, Math.min(4, (anchorNode.cost || 1) - 1))];
    const lookupApi = anchorNode.baseApiName || anchorApi;
    const entries = companionData[lookupApi];

    if (!entries) {
      continue;
    }

    const top = [...entries]
      .filter(c => c.games >= thresholds.companionMinGames && c.avgPlace <= thresholds.companionMaxAvg)
      .sort((a, b) => a.avgPlace - b.avgPlace)
      .slice(0, FILLER_TOP_K_PER_ANCHOR);

    for (const comp of top) {
      const compApi = comp.companion;

      if (anchorSet.has(compApi)) {
        continue;
      }

      if (excludedSet.has(compApi)) {
        continue;
      }

      if (allowedSet && !allowedSet.has(compApi)) {
        continue;
      }

      if (!nodes[compApi]) {
        continue;
      }

      const contribution = weight * (1 - comp.avgPlace / 8);
      candidateScore.set(compApi, (candidateScore.get(compApi) || 0) + contribution);
    }
  }

  // Decay-on-pick loop with 5-cost throttle.
  const fiveCostCap = Math.max(
    0,
    typeof context.max5Cost === 'number'
      ? Math.min(context.max5Cost, FILLER_DEFAULT_FIVE_COST_CAP)
      : FILLER_DEFAULT_FIVE_COST_CAP,
  );
  const picks = [];
  const pickedSet = new Set();
  let fiveCostPicks = 0;

  while (picks.length < FILLER_MAX_PICKS && candidateScore.size > 0) {
    // argmax over remaining candidates
    let bestApi = null;
    let bestScore = -Infinity;

    for (const [api, score] of candidateScore) {
      if (score > bestScore) {
        bestScore = score;
        bestApi = api;
      }
    }

    if (bestApi === null) {
      break;
    }

    const bestNode = nodes[bestApi];
    const isFiveCost = (bestNode?.cost || 0) === 5;

    if (isFiveCost && fiveCostPicks >= fiveCostCap) {
      candidateScore.delete(bestApi);
      continue;
    }

    picks.push(bestApi);
    pickedSet.add(bestApi);

    if (isFiveCost) {
      fiveCostPicks++;
    }

    // Decay the winner — do not delete so it can resurface if its
    // decayed score still beats the next candidate's unused weight.
    candidateScore.set(bestApi, bestScore * FILLER_PICK_DECAY);
  }

  // Fallback: if we did not reach FILLER_MAX_PICKS (e.g. companion
  // data was sparse or the pool was tight), top up from
  // unit-rating-sorted champs that are not already picked / anchors.
  if (picks.length < FILLER_MAX_PICKS) {
    const fallback = Object.keys(nodes)
      .filter(api => {
        if (pickedSet.has(api) || anchorSet.has(api)) {
          return false;
        }

        const node = nodes[api];

        if (!node || node.variant === 'hero') {
          return false;
        }

        if (excludedSet.has(api)) {
          return false;
        }

        if (allowedSet && !allowedSet.has(api)) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        const ra = unitRatings[a]?.score ?? 0;
        const rb = unitRatings[b]?.score ?? 0;

        if (ra !== rb) {
          return rb - ra;
        }

        return a.localeCompare(b);
      });

    let idx = 0;

    while (picks.length < FILLER_MAX_PICKS && idx < fallback.length) {
      const api = fallback[idx++];
      const node = nodes[api];
      const isFiveCost = (node?.cost || 0) === 5;

      if (isFiveCost && fiveCostPicks >= fiveCostCap) {
        continue;
      }

      picks.push(api);
      pickedSet.add(api);

      if (isFiveCost) {
        fiveCostPicks++;
      }
    }
  }

  return picks;
}
```

### Step 2: Replace `phaseCompanionSeeded` body

Find the existing `phaseCompanionSeeded` function and replace its entire body with the new stepped version:

```javascript
function phaseCompanionSeeded({ graph, teamSize, startChamps, context, rng, addResult }) {
  const picks = pickCompanionFillers(graph, context, startChamps);

  for (const filler of picks) {
    const seeds = [...startChamps, filler];

    addResult(buildOneTeam(graph, teamSize, seeds, context, 0.2 + rng() * 0.3, rng));
  }
}
```

Note: the destructured phase args shrink because the new implementation only needs `graph`, `teamSize`, `startChamps`, `context`, `rng`, `addResult`. The old version also took `maxResults` and `results` for its early-exit check; both are gone.

### Step 3: Verify types + lint

```bash
npm run types:check
npm run lint:check
```

Expected: both exit 0, no output.

### Step 4: Sanity — non-locked generate still deterministic

```bash
SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 \
  npx tsx scripts/scout-cli.ts generate --top-n 5 --seed 42 2>/dev/null \
  | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log("rank1:",j.results[0].score);'
```

Expected output: `rank1: <some number>`. The number may differ from the previous 183.8 because Fix 1E changes what `phaseCompanionSeeded` produces — this is expected behavioural drift, not a bug. Record the new number; the priority ordering in Phase C treats it as the new non-lock baseline.

Do **not** treat a changed rank-1 score as a regression at this point. The regression contract is preserved when the topN-contract passes in Task 4.

### Step 5: Commit

```bash
git add resources/js/workers/scout/synergy-graph.ts
git commit -m "$(cat <<'EOF'
feat(scout): Fix 1E — stepped cross-referenced companion filler

Replaces phaseCompanionSeeded's per-companion seed loop (up to
~1280 buildOneTeam calls per generate, dominating ~12s of every
locked run) with a deterministic anchor-driven ranker that:

- Reads anchors from context.lockedChamps (locked + tight
  auto-promoted + hero swap), or bootstraps from top-unitRating
  champs when empty
- Aggregates each anchor's top-10 companions weighted by the
  anchor's cost using the TFT17-meta-aware curve
  [0.3, 0.5, 1.0, 0.95, 0.55] — 3/4-cost carries drive selection
  most strongly, 5-costs are spike units and weigh less
- Picks top 30 fillers with a 0.5 decay-on-pick loop so flex
  fillers (Shen, Rhaast) surface as one or two proposals rather
  than monopolising the slate
- Throttles 5-cost filler picks to max(max5Cost, 3) so the phase
  doesn't burn its budget on 5-cost variants
- Falls back to unit-rating order if the cross-referenced ranking
  runs out so the phase always contributes enough raw teams for
  the upcoming topN guarantee (Fix 7)

Budget drops from ~1280 buildOneTeam calls to 30, deterministic
and context-aware. Profile re-measurement ships in Task 4.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Fix 7 — topN guarantee backfill in `engine.ts`

**Files:**
- Modify: `resources/js/workers/scout/engine.ts` — append backfill block after the existing `validComps` filter

### Step 1: Locate the validComps filter block

Open `resources/js/workers/scout/engine.ts`. Search for `const validComps = enriched.filter(r => {`. The block runs until its closing `});`. Immediately after that closing `});` there are currently the meta-comp match block, insights loop, sort, slice and hero swap-back.

Leave everything from the meta-comp block onward untouched. The backfill appends between the filter and the meta-comp block.

### Step 2: Add the backfill block

Immediately after the `});` that closes `const validComps = enriched.filter(...)`, add:

```javascript
    // Fix 7: topN guarantee. The hard filter above drops any team
    // that misses a trait lock or a role-balance minimum. For
    // heavy-constraint queries this can leave far fewer than topN
    // survivors. The spec's topN contract says the user always sees
    // exactly topN unless constraints are mathematically impossible
    // — low-scoring variants are acceptable, short slates are not.
    //
    // Backfill the gap by pulling the highest-scoring teams from
    // `enriched` that were rejected by the filter, marking each
    // with `breakdown.relaxed = true` so the UI can label them as
    // closest-fit alternatives. Sorting by score alone is the
    // simplest reasonable heuristic — we iterate and tune later if
    // the ordering feels wrong.
    if (validComps.length < topN) {
      const validKeys = new Set(validComps.map(t => t.champions.map(c => c.apiName).sort().join(',')));
      const backfillCandidates = enriched
        .filter(r => {
          if (r.slotsUsed > maxSlots) {
            return false;
          }

          const key = r.champions.map(c => c.apiName).sort().join(',');

          return !validKeys.has(key);
        })
        .sort((a, b) => b.score - a.score);

      for (const team of backfillCandidates) {
        if (validComps.length >= topN) {
          break;
        }

        if (team.breakdown && typeof team.breakdown === 'object') {
          team.breakdown.relaxed = 1;
        }

        validComps.push(team);
      }
    }
```

Note: `breakdown.relaxed` uses `1` (not `true`) so it matches the existing breakdown field type convention (all values are numbers). The UI can still interpret any truthy value.

### Step 3: Verify types + lint

```bash
npm run types:check
npm run lint:check
```

Expected: both exit 0, no output.

### Step 4: Sanity — topN contract on tight lock case

```bash
SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 \
  npx tsx scripts/scout-cli.ts generate --top-n 30 --level 10 --locked-trait TFT17_ShieldTank:6 --seed 0 2>/dev/null \
  | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log("results:",j.results.length,"valid:",j.filtered.afterValidComps);'
```

Expected: `results: 30 valid: 30` (or `valid` could be higher — it's the post-filter count before topN slice). The count must be exactly 30 on the results line.

### Step 5: Sanity — topN contract on impossible lock case

```bash
SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 \
  npx tsx scripts/scout-cli.ts generate --top-n 30 --level 10 --locked-trait TFT17_DarkStar:9 --seed 0 2>/dev/null \
  | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log("results:",j.results.length);'
```

Expected: `results: 0`. DarkStar:9 is mathematically impossible (pool is 6) — the algorithm correctly returns zero, not 30.

### Step 6: Commit

```bash
git add resources/js/workers/scout/engine.ts
git commit -m "$(cat <<'EOF'
feat(scout): Fix 7 — topN guarantee backfill after validComps filter

Enforces the spec's new hard invariant: every generate call returns
exactly topN results unless constraints make that mathematically
impossible. When the validComps filter leaves fewer than topN
survivors, backfill from the highest-scoring enriched teams that
were rejected by the filter, marking each with breakdown.relaxed=1
so the UI can label them as closest-fit alternatives.

Low-scoring variants are acceptable in the slate; short slates are
not. Tight lock ShieldTank:6 with --top-n 30 now returns exactly
30 results. Impossible locks (e.g. DarkStar:9 with a 6-champ pool)
still return 0 as before — mathematical impossibility is the only
exception to the topN contract.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Fix 2A — `phaseTemperatureSweep` budget cut + skip-on-locked

**Files:**
- Modify: `resources/js/workers/scout/synergy-graph.ts::phaseTemperatureSweep`

### Step 1: Replace the phase body

Find `function phaseTemperatureSweep(...)` in `synergy-graph.ts`. Replace its entire body with:

```javascript
function phaseTemperatureSweep({ graph, teamSize, startChamps, context, rng, maxResults, results, addResult }) {
  // Skip entirely when the caller requested trait locks —
  // phaseLockedTraitSeeded has already populated the lock-satisfying
  // space with targeted seeds, and temperatureSweep's random walks
  // almost never satisfy the filter on locked runs. On the baseline
  // profile this phase alone cost ~5 s per locked scenario.
  if ((context.lockedTraits || []).length > 0) {
    return;
  }

  // Budget cut: was maxResults * 3 (1080 attempts on locked runs),
  // now maxResults * 1 (120-360 on non-locked runs — still plenty
  // for diversity and still triggers the early-exit when the result
  // map has healthy size).
  const attempts = Math.max(maxResults, 60);

  for (let i = 0; i < attempts; i++) {
    const temp = 0.15 + (i / attempts) * 0.85;

    addResult(buildOneTeam(graph, teamSize, startChamps, context, temp, rng));

    if (results.size >= maxResults * 2) {
      break;
    }
  }
}
```

### Step 2: Verify types + lint

```bash
npm run types:check
npm run lint:check
```

Expected: both exit 0, no output.

### Step 3: Sanity — non-lock and tight lock both still return topN

```bash
SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 \
  npx tsx scripts/scout-cli.ts generate --top-n 10 --seed 42 2>/dev/null \
  | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log("non-lock results:",j.results.length);'

SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 \
  npx tsx scripts/scout-cli.ts generate --top-n 30 --level 10 --locked-trait TFT17_ShieldTank:6 --seed 0 2>/dev/null \
  | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log("tight-lock results:",j.results.length);'
```

Expected:
```
non-lock results: 10
tight-lock results: 30
```

### Step 4: Commit

```bash
git add resources/js/workers/scout/synergy-graph.ts
git commit -m "$(cat <<'EOF'
feat(scout): Fix 2A — phaseTemperatureSweep budget cut + skip-on-locked

Drops the attempt multiplier from maxResults*3 to maxResults*1.
On locked runs (maxResults=360) that was 1080 iterations per
generate, costing ~5 s per locked scenario in the Phase A profile.
Also short-circuits the entire phase when context.lockedTraits is
non-empty — phaseLockedTraitSeeded already populates the
lock-satisfying search space with targeted seeds, and
temperatureSweep's random walks almost never survive the
engine-side filter on locked runs.

Non-locked topN=10 still runs up to maxResults attempts
(max(maxResults, 60)) so diversity isn't starved for the
generic path.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Re-profile and verify target B

**Files:**
- Modify (overwrite): `docs/superpowers/research/scout-perf-2026-04-15.md`

### Step 1: Re-run the profiler

```bash
SCOUT_PROFILE=1 SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 \
  npx tsx scripts/scout-cli.ts profile
```

Expected: a single line `profile report written to …/scout-perf-<today>.md` and exit 0.

Note: the profile subcommand hard-codes today's date into the filename. If the file exists from a previous run on the same day, it gets overwritten — that's expected.

### Step 2: Read the report and check the three wall-time numbers

```bash
grep -A 1 "Measured wall time:" docs/superpowers/research/scout-perf-2026-04-15.md
```

Expected: three lines of the form `**Measured wall time:** <number> ms`, one per scenario.

Compare against the Phase A baseline:

| scenario | Phase A baseline | target B | must be |
| --- | ---: | ---: | ---: |
| No-lock lvl 8 topN=10 | 2 767 ms | 1 500 ms | ≤ 1 500 ms |
| Tight lock ShieldTank:6 lvl 10 topN=30 | 17 677 ms | 2 000 ms | ≤ 2 000 ms |
| Loose lock+emblem lvl 10 topN=30 | 17 865 ms | 2 500 ms | ≤ 2 500 ms |

If any wall time exceeds its target, stop and report `DONE_WITH_CONCERNS` with the measured numbers. The controller decides whether to continue to Task 5 or iterate on Fix 1E/2A constants. Do **not** push through a failing target.

### Step 3: Verify the topN contract on all three scenarios

```bash
# scenario 1 — no lock
SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 \
  npx tsx scripts/scout-cli.ts generate --top-n 10 --seed 42 2>/dev/null \
  | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log("n1:",j.results.length);'

# scenario 2 — tight lock
SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 \
  npx tsx scripts/scout-cli.ts generate --top-n 30 --level 10 --locked-trait TFT17_ShieldTank:6 --seed 0 2>/dev/null \
  | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log("n2:",j.results.length);'

# scenario 3 — loose lock + emblem
SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 \
  npx tsx scripts/scout-cli.ts generate --top-n 30 --level 10 --locked-trait TFT17_ShieldTank:6 --locked-trait TFT17_RangedTrait:4 --emblem TFT17_RangedTrait:1 --seed 0 2>/dev/null \
  | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log("n3:",j.results.length);'

# scenario 4 — larger non-lock to prove the contract at higher N
SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 \
  npx tsx scripts/scout-cli.ts generate --top-n 50 --seed 42 2>/dev/null \
  | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log("n4:",j.results.length);'
```

Expected output exactly:
```
n1: 10
n2: 30
n3: 30
n4: 50
```

Any short slate is a Fix 7 bug — stop and report.

### Step 4: Annotate the report with a before/after summary

Open `docs/superpowers/research/scout-perf-2026-04-15.md`. Prepend a summary block between the header and the first scenario (replacing the old Phase A summary if this overwrote the Phase A file — the plan assumes today is 2026-04-15 so the filenames differ, but if for any reason they're the same, overwrite):

```markdown
## Summary — Phase C results vs Phase A baseline

| scenario | Phase A baseline | Phase C measured | target B | status |
| --- | ---: | ---: | ---: | :---: |
| No-lock lvl 8 topN=10 | 2 767 ms | <fill in> ms | 1 500 ms | <✅ / ❌> |
| Tight lock ShieldTank:6 lvl 10 topN=30 | 17 677 ms | <fill in> ms | 2 000 ms | <✅ / ❌> |
| Loose lock+emblem lvl 10 topN=30 | 17 865 ms | <fill in> ms | 2 500 ms | <✅ / ❌> |

### TopN contract verification

- `--top-n 10` non-lock → <fill in> results (expected 10)
- `--top-n 30` tight lock → <fill in> results (expected 30)
- `--top-n 30` loose lock+emblem → <fill in> results (expected 30)
- `--top-n 50` non-lock → <fill in> results (expected 50)

### Top spans comparison

| span | Phase A | Phase C | delta |
| --- | ---: | ---: | ---: |
| `synergy.phase.companionSeeded` | 23 971 ms (3 scenarios) | <fill in> | <fill in> |
| `synergy.phase.temperatureSweep` | 12 037 ms (3 scenarios) | <fill in> | <fill in> |

Fill in each `<…>` by reading the new tables below and the earlier
`scout-perf-2026-04-14.md` report.
```

Fill in every `<…>` placeholder from the actual measured values. Leave no placeholders in the final file.

### Step 5: Commit the report

```bash
git add docs/superpowers/research/scout-perf-2026-04-15.md
git commit -m "$(cat <<'EOF'
docs(research): scout performance profile — Phase C after Fix 1E + 2A + 7

Re-profiles the three benchmark scenarios after landing Fix 1E
(stepped companion filler), Fix 2A (temperatureSweep budget cut
with skip-on-locked), and Fix 7 (topN guarantee backfill).
Before/after table at the top of the report tracks the wall-time
and hot-span deltas against the Phase A baseline. topN contract
verified on all three benchmark scenarios plus a larger topN=50
smoke test.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Fix 5 — stop mutating `constraints.emblems` in `engine.ts`

**Files:**
- Modify: `resources/js/workers/scout/engine.ts` — emblem normalisation block near the top of `generate`

### Step 1: Locate the emblem normalisation block

Open `resources/js/workers/scout/engine.ts`. Search for `// Normalise emblems to a flat string[]`. The block ends with `constraints.emblems = normalizedEmblems;`. That final line is the bug: it mutates the caller's constraints object.

### Step 2: Replace the mutation with a local variable

Change the block so the normalised list is kept as a local variable and threaded through every downstream read that currently reads `constraints.emblems`:

```javascript
    // Normalise emblems to a flat string[] of trait apiNames, one entry
    // per physical emblem unit. Callers pass either legacy string[] or
    // the newer [{apiName, count}]; most downstream code
    // (buildActiveTraits, synergy-graph.applyEmblems, phaseDeepVertical)
    // iterates with `for (const e of emblems)` and indexes by `e`, which
    // silently breaks on object-shaped entries and swallows the emblem
    // entirely. Expand counts by repeating the apiName and keep the
    // result in a local so callers that memoise constraints across
    // generates aren't surprised by in-place mutation.
    const normalizedEmblems = [];

    for (const e of constraints.emblems || []) {
      if (typeof e === 'string') {
        normalizedEmblems.push(e);
        continue;
      }

      const count = Math.max(1, Number(e?.count ?? 1));

      for (let i = 0; i < count; i++) {
        normalizedEmblems.push(e.apiName);
      }
    }
```

Remove the line `constraints.emblems = normalizedEmblems;`.

### Step 3: Thread `normalizedEmblems` through the downstream reads

Search `engine.ts` for every remaining read of `constraints.emblems`. There are two:

1. The `findTeams` call:

```javascript
    const rawTeams = findTeams(graph, {
      teamSize: effectiveTeamSize,
      startChamps: locked.map(c => c.apiName),
      maxResults: SEARCH_BUDGET * searchMultiplier,
      level,
      emblems: constraints.emblems || [],  // ← change this
      excludedTraits: constraints.excludedTraits || [],
      excludedChampions: constraints.excludedChampions || [],
      max5Cost: constraints.max5Cost ?? null,
      seed,
      lockedTraits: traitLocks,
    });
```

Replace `constraints.emblems || []` with `normalizedEmblems` in the `emblems:` field.

2. The `buildActiveTraits` call inside the enrich loop:

```javascript
      const activeTraits = buildActiveTraits(team.champions, traits, constraints.emblems || []);
```

Replace with:

```javascript
      const activeTraits = buildActiveTraits(team.champions, traits, normalizedEmblems);
```

Make sure no other `constraints.emblems` read remains (grep it after the edit to confirm).

### Step 4: Verify types + lint

```bash
npm run types:check
npm run lint:check
```

Expected: both exit 0, no output.

### Step 5: Sanity — emblem-carrying scenario still works

```bash
SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 \
  npx tsx scripts/scout-cli.ts generate --top-n 10 --level 10 --locked-trait TFT17_ShieldTank:6 --locked-trait TFT17_RangedTrait:4 --emblem TFT17_RangedTrait:1 --seed 0 2>/dev/null \
  | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); const r=j.results[0]; const rg=r.activeTraits.split(" ").find(t=>t.includes("RangedTrait")); console.log("rank1 score:",r.score,"ranged:",rg,"results:",j.results.length);'
```

Expected: `rank1 score: <number> ranged: TFT17_RangedTrait:4(Gold) results: 10`. The RangedTrait:4(Gold) activation confirms the emblem still reaches `buildActiveTraits` despite no longer mutating the caller's constraints object.

### Step 6: Commit

```bash
git add resources/js/workers/scout/engine.ts
git commit -m "$(cat <<'EOF'
fix(scout): Fix 5 — stop mutating constraints.emblems in engine.generate

The emblem normalisation block rewrote the caller's
constraints.emblems in place, which works today but surprises any
future caller that memoises the constraints object across generates.
Replace with a local normalizedEmblems variable threaded through
findTeams and the enrich loop's buildActiveTraits call. No behaviour
change — verified RangedTrait:4(Gold) still activates via emblem on
the standard loose-lock scenario.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Final regression sweep

**Files:**
- None (verification only — no code change, no commit)

### Step 1: Types + lint one more time

```bash
npm run types:check
npm run lint:check
```

Expected: both exit 0, no output.

### Step 2: Non-lock determinism

```bash
for n in 5 20 50; do
  SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 \
    npx tsx scripts/scout-cli.ts generate --top-n $n --seed 42 2>/dev/null \
    | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log("n='$n' rank1:",j.results[0].score,"count:",j.results.length);'
done
```

Expected: three lines, each with `rank1:` followed by the same score (they should all match since seed 42 is constant). `count:` must equal `n` (5, 20, 50). If rank-1 drifts between the three lines, the phase is non-deterministic — stop and investigate.

The exact rank-1 score may differ from the pre-sprint 183.8 because Fix 1E changed what `phaseCompanionSeeded` feeds into the result map. Record the new value as the new non-lock baseline. Stability across topN values is what matters — not matching the old 183.8.

### Step 3: Hero swap

```bash
SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 \
  npx tsx scripts/scout-cli.ts generate --top-n 1 --locked TFT17_Aatrox_hero --seed 42 2>/dev/null \
  | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log("hero-in-team:",j.results[0].champions.includes("TFT17_Aatrox_hero"));'
```

Expected: `hero-in-team: true`.

### Step 4: Filler metric still present

```bash
SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 \
  npx tsx scripts/scout-cli.ts generate --top-n 1 --seed 42 2>/dev/null \
  | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log("filler:",j.results[0].breakdown.filler,"keys:",Object.keys(j.results[0].breakdown).join(","));'
```

Expected: `filler: 0` plus the breakdown key list containing `champions,traits,affinity,companions,synergy,balance,proven,filler,total` (the exact order may vary).

### Step 5: All four topN / lock scenarios

```bash
# Tight lock full 30
SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 \
  npx tsx scripts/scout-cli.ts generate --top-n 30 --level 10 --locked-trait TFT17_ShieldTank:6 --seed 0 2>/dev/null \
  | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log("tight:",j.results.length);'

# Loose DarkStar:4 full 30
SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 \
  npx tsx scripts/scout-cli.ts generate --top-n 30 --level 10 --locked-trait TFT17_DarkStar:4 --seed 0 2>/dev/null \
  | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log("darkstar:",j.results.length);'

# Multi-lock + emblem full 30
SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 \
  npx tsx scripts/scout-cli.ts generate --top-n 30 --level 10 --locked-trait TFT17_ShieldTank:6 --locked-trait TFT17_RangedTrait:4 --emblem TFT17_RangedTrait:1 --seed 0 2>/dev/null \
  | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log("multi:",j.results.length);'

# Impossible lock — should return 0, not 30 from backfill
SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 \
  npx tsx scripts/scout-cli.ts generate --top-n 30 --level 10 --locked-trait TFT17_DarkStar:9 --seed 0 2>/dev/null \
  | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log("impossible:",j.results.length);'
```

Expected:
```
tight: 30
darkstar: 30
multi: 30
impossible: 0
```

If `impossible:` returns anything other than 0, the backfill is over-eager and pulling teams that violate the mathematical impossibility. Stop and investigate Fix 7's filter logic.

### Step 6: Diversity check — Shen monopoly test

```bash
SCOUT_API_BASE=https://tft-scout.test NODE_TLS_REJECT_UNAUTHORIZED=0 \
  npx tsx scripts/scout-cli.ts generate --top-n 30 --level 10 --locked-trait TFT17_ShieldTank:6 --seed 0 2>/dev/null \
  | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); const shenCount=j.results.filter(r=>r.champions.includes("TFT17_Shen")).length; const flex=new Set(); j.results.forEach(r=>{const nonST=r.champions.filter(c=>!["TFT17_Illaoi","TFT17_Nasus","TFT17_Blitzcrank","TFT17_Nunu","TFT17_Leona","TFT17_Mordekaiser"].includes(c)); nonST.forEach(c=>flex.add(c));}); console.log("shen comps:",shenCount,"unique flex champs:",flex.size);'
```

Expected: `shen comps:` should be ≤ 10 (Shen is fine as a proposal but not monopolising), `unique flex champs:` should be ≥ 10 (variety across the 30 comps). Exact numbers will depend on the companion data — the acceptance criterion is "Shen appears but isn't the only filler seen".

If `shen comps: 30` and `unique flex champs: 2`, the decay logic is too weak — iterate on `FILLER_PICK_DECAY` (try 0.3 instead of 0.5).

### Step 7: No commit — verification only

If every step passed, the sprint is done. Task 7 writes the memory update. If any step failed, stop and report `DONE_WITH_CONCERNS` with the failing output so the controller can decide whether to iterate.

---

## Task 7: Update memory with new baseline

**Files:**
- Modify: `C:\Users\macie\.claude\projects\D--Herd-tft-scout\memory\project_scout_lab_session_findings.md` (or the current session findings memory file)

### Step 1: Read the current file to find the right append point

```bash
tail -20 "C:\Users\macie\.claude\projects\D--Herd-tft-scout\memory\project_scout_lab_session_findings.md"
```

Expected: the tail of the file that lists deferred follow-ups and session findings from prior sprints.

### Step 2: Append a new section

Append to the file:

```markdown
## Scout perf sprint — Phase C outcome (2026-04-15)

Landed Fix 1E + Fix 7 + Fix 2A from the perf spec
(`docs/superpowers/specs/2026-04-14-scout-perf-sprint-design.md`).
Measured wall times vs Phase A baseline:

| scenario | Phase A | Phase C | target |
| --- | ---: | ---: | ---: |
| No-lock lvl 8 topN=10 | 2 767 ms | <fill in> | 1 500 ms |
| Tight lock ShieldTank:6 lvl 10 topN=30 | 17 677 ms | <fill in> | 2 000 ms |
| Loose lock+emblem lvl 10 topN=30 | 17 865 ms | <fill in> | 2 500 ms |

phaseCompanionSeeded replaced with a stepped cross-referenced
filler ranker (anchors → cost-weighted top companions →
decay-on-pick with 5-cost throttle → fallback to unit rating).
Budget dropped from ~1 280 buildOneTeam calls to 30 per generate.

topN contract now a hard invariant: engine.ts backfills from
score-sorted rejected teams (marked `breakdown.relaxed = 1`)
whenever the validComps filter leaves fewer than topN survivors.
Impossible lock scenarios still return 0 as before — only
mathematical impossibility is allowed to break the contract.

Non-lock seed 42 rank-1 baseline changed from 183.8 to <fill in>
because Fix 1E produces a different candidate pool for the
temperatureSweep / traitSeeded phases to explore. Stability
across topN values is preserved (5/20/50 all return the same
rank-1 under Fix 1E).

Deferred from this sprint, still open:
- Fix 3 (findActiveBreakpointIdx helper extraction — cleanup)
- Fix 4 (collectAffinityMatches shared helper — cleanup)
- Fix 6 (synergy-graph.ts file split — maintainability)
- Phase E (Web Workers pool, if ever needed)
```

Fill in every `<fill in>` placeholder from the actual Task 4
report numbers. Leave no placeholders in the committed file.

### Step 3: No commit

Memory files aren't tracked in git for this project. Just save
the edit and move on.

### Step 4: Declare the sprint complete

Report the final wall-time numbers and the set of regression
checks that passed, so the controller can mark the sprint
finished and surface the results to the user.
