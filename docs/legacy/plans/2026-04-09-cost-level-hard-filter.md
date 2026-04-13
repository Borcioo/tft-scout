# Cost→minLevel Hard Filter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace soft `costPenalty` with hard prefilter that excludes too-high-cost champions from the generation pool based on player level, while keeping locked champions sacred.

**Architecture:** Compute `allowedSet` once at entry to `findTeams`, propagate via `context`, filter at every seed-selection point in 7 exploration phases + main build loop. Locked champions bypass the filter entirely and are exempt from `costPenalty`. Meta comps are hard-cut entirely if any member is disallowed.

**Tech Stack:** JavaScript (ES modules), React+Vite client, no test framework — verification via `npm run lint`, `npm run build`, and manual browser testing.

**Source spec:** `docs/superpowers/specs/2026-04-09-cost-level-hard-filter-design.md`

**Commit strategy:** 3 logical commits (infrastructure → core filters → phase filters), not per-task. Per user preference: batch small changes.

---

## File Structure

**Modified files:**
- `client/src/algorithm/config.js` — add `MIN_LEVEL_BY_COST` export
- `client/src/algorithm/synergy-graph.js` — all filter logic and phase updates

**No new files.** All changes are localized to these two.

**No test files.** Project has no test infrastructure for `client/`; verification is via lint, build, and manual runs.

---

## Task 1: Add `MIN_LEVEL_BY_COST` constant to config

**Files:**
- Modify: `client/src/algorithm/config.js` (append new export after `SCORING_CONFIG`)

- [ ] **Step 1: Open `config.js` and add the new export**

At the end of `client/src/algorithm/config.js` (after line 46, the closing `};` of `SCORING_CONFIG`), append:

```js

/**
 * Minimalny poziom gracza dla każdego kosztu championa.
 * Progi oparte na SHOP_ODDS — champion jest dozwolony gdy realna
 * szansa na zaciągnięcie w sklepie wynosi ≥10%.
 *
 * 1-cost: zawsze (baseline)
 * 2-cost: lvl 3+ (25% odds)
 * 3-cost: lvl 4+ (15% odds)
 * 4-cost: lvl 7+ (10% odds)
 * 5-cost: lvl 9+ (15% odds)
 */
export const MIN_LEVEL_BY_COST = {
  1: 1,
  2: 3,
  3: 4,
  4: 7,
  5: 9,
};
```

- [ ] **Step 2: Verify lint passes**

Run from `D:/Projekty/tft-generator/client`:
```bash
npm run lint
```

Expected: No errors (warnings OK if pre-existing). If a new error appears on your edit, fix it before proceeding.

---

## Task 2: Add `buildAllowedSet` helper in `synergy-graph.js`

**Files:**
- Modify: `client/src/algorithm/synergy-graph.js` (add import + helper function, wire into `findTeams` context)

- [ ] **Step 1: Add import at top of file**

Find the existing imports in `client/src/algorithm/synergy-graph.js` (top of file). Locate the config import (looks like `import { SCORING_CONFIG } from './config.js';` or similar). If `MIN_LEVEL_BY_COST` is not already in the import list, add it:

```js
import { SCORING_CONFIG, MIN_LEVEL_BY_COST } from './config.js';
```

If the existing import uses a different name/path, preserve that and just add `MIN_LEVEL_BY_COST` to the destructured list.

- [ ] **Step 2: Add `buildAllowedSet` helper function**

Add this function **immediately before** the `findTeams` export function (around line 720, right before `// ── Public API ────`):

```js
/**
 * Build the set of champion apiNames allowed in the generated team
 * based on player level. Locked champions always bypass the filter.
 *
 * @param {object} graph - from buildGraph()
 * @param {number|null} level - player level, or null for no filter
 * @param {string[]} lockedChamps - champion apiNames that must always be allowed
 * @returns {Set<string>} allowed apiNames
 */
function buildAllowedSet(graph, level, lockedChamps) {
  // Brak level → wszystko dozwolone (kompatybilność wsteczna).
  if (!level) return new Set(Object.keys(graph.nodes));

  const allowed = new Set(lockedChamps || []);
  for (const [api, node] of Object.entries(graph.nodes)) {
    const cost = node.cost || 1;
    const minLvl = MIN_LEVEL_BY_COST[cost];
    if (minLvl != null && level >= minLvl) allowed.add(api);
  }
  return allowed;
}
```

- [ ] **Step 3: Wire `allowedSet` and `lockedSet` into `findTeams` context**

Locate `findTeams` in `synergy-graph.js` (around line 729). Find the context object construction (line 737):

```js
const context = { emblems, excludedTraits, excludedChampions, level, max5Cost, lockedChamps: startChamps };
```

Replace with:

```js
const allowedSet = buildAllowedSet(graph, level, startChamps);
const lockedSet = new Set(startChamps);
const context = {
  emblems, excludedTraits, excludedChampions, level, max5Cost,
  lockedChamps: startChamps,
  allowedSet,
  lockedSet,
};
```

- [ ] **Step 4: Verify lint + build passes**

From `D:/Projekty/tft-generator/client`:
```bash
npm run lint && npm run build
```

Expected: Both succeed. Build should produce `dist/` output without errors.

- [ ] **Step 5: Commit (infrastructure)**

```bash
cd D:/Projekty/tft-generator
git add client/src/algorithm/config.js client/src/algorithm/synergy-graph.js
git commit -m "$(cat <<'EOF'
feat(algorithm): add MIN_LEVEL_BY_COST + buildAllowedSet infrastructure

Introduces cost-level threshold table and a helper that computes the
allowed champion pool for a given player level, with locked champions
always bypassing the filter. Wired into findTeams context for use by
subsequent filter tasks.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds. Check `git log -1` to confirm.

---

## Task 3: Filter candidates in `buildOneTeam`

**Files:**
- Modify: `client/src/algorithm/synergy-graph.js:324-413` (two loops inside `buildOneTeam`)

- [ ] **Step 1: Add `allowedSet` destructure from context**

In `buildOneTeam` at line 326, find:
```js
const { emblems = [], excludedChampions = [], max5Cost = null, lockedChamps = [] } = context;
```

Replace with:
```js
const { emblems = [], excludedChampions = [], max5Cost = null, lockedChamps = [], allowedSet = null } = context;
```

- [ ] **Step 2: Filter neighbors loop**

In `buildOneTeam`, locate the neighbors loop around line 362-371:

```js
for (const member of team) {
  for (const edge of (adjacency[member] || [])) {
    if (used.has(edge.champ) || seen.has(edge.champ) || excludedSet.has(edge.champ)) continue;
    if (atFiveCostLimit && (nodes[edge.champ]?.cost || 0) === 5) continue;
    seen.add(edge.champ);
    const testTeam = [...team, edge.champ];
    const score = quickScore(testTeam, graph, emblems) - costPenalty(testTeam, graph, context.level);
    candidates.push({ champ: edge.champ, score });
  }
}
```

Add the `allowedSet` check right after the `excludedSet` check:

```js
for (const member of team) {
  for (const edge of (adjacency[member] || [])) {
    if (used.has(edge.champ) || seen.has(edge.champ) || excludedSet.has(edge.champ)) continue;
    if (allowedSet && !allowedSet.has(edge.champ)) continue;
    if (atFiveCostLimit && (nodes[edge.champ]?.cost || 0) === 5) continue;
    seen.add(edge.champ);
    const testTeam = [...team, edge.champ];
    const score = quickScore(testTeam, graph, emblems) - costPenalty(testTeam, graph, context.level, context.lockedSet);
    candidates.push({ champ: edge.champ, score });
  }
}
```

Note: `costPenalty` call also gets `context.lockedSet` as 4th arg (will be used in Task 4).

- [ ] **Step 3: Filter fill loop**

In `buildOneTeam`, locate the fill loop around line 374-383:

```js
if (candidates.length < 15) {
  for (const api of Object.keys(nodes)) {
    if (used.has(api) || seen.has(api) || excludedSet.has(api)) continue;
    if (atFiveCostLimit && (nodes[api]?.cost || 0) === 5) continue;
    seen.add(api);
    const testTeam = [...team, api];
    const score = quickScore(testTeam, graph, emblems) - costPenalty(testTeam, graph, context.level);
    candidates.push({ champ: api, score });
  }
}
```

Add the `allowedSet` check and update `costPenalty` call:

```js
if (candidates.length < 15) {
  for (const api of Object.keys(nodes)) {
    if (used.has(api) || seen.has(api) || excludedSet.has(api)) continue;
    if (allowedSet && !allowedSet.has(api)) continue;
    if (atFiveCostLimit && (nodes[api]?.cost || 0) === 5) continue;
    seen.add(api);
    const testTeam = [...team, api];
    const score = quickScore(testTeam, graph, emblems) - costPenalty(testTeam, graph, context.level, context.lockedSet);
    candidates.push({ champ: api, score });
  }
}
```

---

## Task 4: Update `costPenalty` to exempt locked champions

**Files:**
- Modify: `client/src/algorithm/synergy-graph.js:274-295`

- [ ] **Step 1: Update function signature and body**

Locate `costPenalty` around line 274:

```js
function costPenalty(champApis, graph, level) {
  if (!level) return 0;
  const odds = SHOP_ODDS[level] || SHOP_ODDS[8];
  const teamSize = champApis.length;
  const limits = odds.map(o => {
    if (o === 0) return 0;
    if (o <= 0.05) return 1;
    if (o <= 0.15) return 2;
    return Math.ceil(o * teamSize) + 1;
  });
  const costCounts = [0, 0, 0, 0, 0];
  for (const api of champApis) {
    const cost = graph.nodes[api]?.cost || 3;
    if (cost >= 1 && cost <= 5) costCounts[cost - 1]++;
  }
  let penalty = 0;
  for (let i = 0; i < 5; i++) {
    const excess = costCounts[i] - limits[i];
    if (excess > 0) penalty += excess * 12;
  }
  return penalty;
}
```

Replace with:

```js
function costPenalty(champApis, graph, level, lockedSet = null) {
  if (!level) return 0;
  const odds = SHOP_ODDS[level] || SHOP_ODDS[8];
  // Locked champions are exempt — sacred, algorithm optimizes around them.
  const nonLocked = lockedSet ? champApis.filter(api => !lockedSet.has(api)) : champApis;
  const teamSize = nonLocked.length;
  if (teamSize === 0) return 0;
  const limits = odds.map(o => {
    if (o === 0) return 0;
    if (o <= 0.05) return 1;
    if (o <= 0.15) return 2;
    return Math.ceil(o * teamSize) + 1;
  });
  const costCounts = [0, 0, 0, 0, 0];
  for (const api of nonLocked) {
    const cost = graph.nodes[api]?.cost || 3;
    if (cost >= 1 && cost <= 5) costCounts[cost - 1]++;
  }
  let penalty = 0;
  for (let i = 0; i < 5; i++) {
    const excess = costCounts[i] - limits[i];
    if (excess > 0) penalty += excess * 12;
  }
  return penalty;
}
```

Key changes:
1. Added `lockedSet = null` parameter (backwards compatible when omitted).
2. `nonLocked` filters out locked champions before counting.
3. `teamSize` computed from `nonLocked`, with early return if all slots are locked.
4. `costCounts` loop iterates over `nonLocked`.

---

## Task 5: Update remaining `costPenalty` call sites

**Files:**
- Modify: `client/src/algorithm/synergy-graph.js:629` (inside `phaseHillClimb`)
- Modify: `client/src/algorithm/synergy-graph.js:766` (inside `addResult` in `findTeams`)

- [ ] **Step 1: Update `phaseHillClimb` call**

Locate line 629 inside `phaseHillClimb`:

```js
const score = quickScore(candidate, graph, emblems) - costPenalty(candidate, graph, context.level);
```

Replace with:

```js
const score = quickScore(candidate, graph, emblems) - costPenalty(candidate, graph, context.level, context.lockedSet);
```

- [ ] **Step 2: Update `addResult` call in `findTeams`**

Locate line 766 inside `addResult`:

```js
const score = quickScore(team, graph, emblems) - costPenalty(team, graph, level);
```

Replace with:

```js
const score = quickScore(team, graph, emblems) - costPenalty(team, graph, level, lockedSet);
```

Note: `lockedSet` is already in scope from Task 2 Step 3.

- [ ] **Step 3: Verify lint + build passes**

From `D:/Projekty/tft-generator/client`:
```bash
npm run lint && npm run build
```

Expected: Both succeed.

- [ ] **Step 4: Commit (core filters)**

```bash
cd D:/Projekty/tft-generator
git add client/src/algorithm/synergy-graph.js
git commit -m "$(cat <<'EOF'
feat(algorithm): hard-filter buildOneTeam candidates + locked-exempt costPenalty

buildOneTeam now filters both neighbor and fill loops against allowedSet
so candidates of too-high cost are never considered (unless locked).
costPenalty exempts locked champions from counting towards cost limits,
so the algorithm optimizes around them instead of punishing their presence.
All three costPenalty call sites updated to pass lockedSet.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Filter `phaseTraitSeeded`

**Files:**
- Modify: `client/src/algorithm/synergy-graph.js:429-446`

- [ ] **Step 1: Update `available` filter**

Locate line 436 inside `phaseTraitSeeded`:

```js
const available = members.filter(m => !excludedSet.has(m) && !startChamps.includes(m));
```

Replace with:

```js
const available = members.filter(m =>
  !excludedSet.has(m) &&
  !startChamps.includes(m) &&
  (!context.allowedSet || context.allowedSet.has(m))
);
```

The `if (available.length < 2) continue;` check on the next line already handles the skip case when filter leaves too few members.

---

## Task 7: Filter `phaseDeepVertical`

**Files:**
- Modify: `client/src/algorithm/synergy-graph.js:448-492`

- [ ] **Step 1: Update `available` filter**

Locate line 458 inside `phaseDeepVertical`:

```js
const available = members.filter(m => !excludedSet.has(m) && !startSet.has(m));
```

Replace with:

```js
const available = members.filter(m =>
  !excludedSet.has(m) &&
  !startSet.has(m) &&
  (!context.allowedSet || context.allowedSet.has(m))
);
```

The existing `if (needed <= 0 || available.length < needed) continue;` check at line 473 already handles skip when filter leaves too few members.

---

## Task 8: Filter `phasePairSynergy`

**Files:**
- Modify: `client/src/algorithm/synergy-graph.js:494-524`

- [ ] **Step 1: Update `m1` and `m2` filters**

Locate lines 513-514 inside `phasePairSynergy`:

```js
const m1 = (traitMap[t1.api] || []).filter(m => !excludedSet.has(m));
const m2 = (traitMap[t2.api] || []).filter(m => !excludedSet.has(m));
```

Replace with:

```js
const m1 = (traitMap[t1.api] || []).filter(m =>
  !excludedSet.has(m) && (!context.allowedSet || context.allowedSet.has(m))
);
const m2 = (traitMap[t2.api] || []).filter(m =>
  !excludedSet.has(m) && (!context.allowedSet || context.allowedSet.has(m))
);
```

Existing `if (m1.length < 2 || m2.length < 2) continue;` at line 515 handles the skip case.

---

## Task 9: Filter `phaseCompanionSeeded`

**Files:**
- Modify: `client/src/algorithm/synergy-graph.js:526-542`

- [ ] **Step 1: Skip companions that are not in allowedSet**

Locate the inner loop around lines 536-539:

```js
for (const comp of topCompanions) {
  const seeds = [...startChamps, comp.companionApiName];
  addResult(buildOneTeam(graph, teamSize, seeds, context, 0.2 + rng() * 0.3, rng));
}
```

Replace with:

```js
for (const comp of topCompanions) {
  if (context.allowedSet && !context.allowedSet.has(comp.companionApiName)) continue;
  const seeds = [...startChamps, comp.companionApiName];
  addResult(buildOneTeam(graph, teamSize, seeds, context, 0.2 + rng() * 0.3, rng));
}
```

This skips companion seeds that are themselves disallowed (the companion champion is too high cost for current level).

---

## Task 10: Filter `phaseCrossover`

**Files:**
- Modify: `client/src/algorithm/synergy-graph.js:549-576`

- [ ] **Step 1: Filter genes from parent teams**

Locate lines 564-565 inside `phaseCrossover`:

```js
const genesA = parentA.filter(a => !lockedSet.has(a));
const genesB = parentB.filter(a => !lockedSet.has(a));
```

Replace with:

```js
const genesA = parentA.filter(a =>
  !lockedSet.has(a) && (!context.allowedSet || context.allowedSet.has(a))
);
const genesB = parentB.filter(a =>
  !lockedSet.has(a) && (!context.allowedSet || context.allowedSet.has(a))
);
```

Note: In theory parent teams came from earlier phases that already filter, so this is defensive — but needed because locked champs in parents could include high-cost champs we want to keep in children too. Since locked champs are re-added via `startChamps` in the seed concatenation on line 571, they'll still be present in children regardless of this filter.

---

## Task 11: Hard-cut `phaseMetaCompSeeded` when meta comp has disallowed units

**Files:**
- Modify: `client/src/algorithm/synergy-graph.js:653-672`

- [ ] **Step 1: Add disallowed-check before processing comp**

Locate the loop inside `phaseMetaCompSeeded` around lines 660-671:

```js
for (const comp of metaComps) {
  // Skip comps that conflict with locked champions
  const compUnits = comp.units.filter(u => nodes[u] && !excludedSet.has(u));

  // Check overlap: at least 1 locked champ must be in the meta comp (or no locks)
  const overlap = startChamps.length === 0 || startChamps.some(s => compUnits.includes(s));
  if (!overlap) continue;

  // Seed: locked champs + meta comp members (dedup)
  const seeds = [...new Set([...startChamps, ...compUnits])];
  addResult(buildOneTeam(graph, teamSize, seeds, context, 0.1 + rng() * 0.2, rng));
}
```

Replace with:

```js
for (const comp of metaComps) {
  // Skip comps that conflict with locked champions
  const compUnits = comp.units.filter(u => nodes[u] && !excludedSet.has(u));

  // Hard cut: if any meta comp unit is disallowed by level, skip entire comp.
  // Meta comps are cohesive archetypes — partial seeds would break their intent.
  if (context.allowedSet) {
    const hasDisallowed = compUnits.some(u => !context.allowedSet.has(u));
    if (hasDisallowed) continue;
  }

  // Check overlap: at least 1 locked champ must be in the meta comp (or no locks)
  const overlap = startChamps.length === 0 || startChamps.some(s => compUnits.includes(s));
  if (!overlap) continue;

  // Seed: locked champs + meta comp members (dedup)
  const seeds = [...new Set([...startChamps, ...compUnits])];
  addResult(buildOneTeam(graph, teamSize, seeds, context, 0.1 + rng() * 0.2, rng));
}
```

- [ ] **Step 2: Verify lint + build passes**

From `D:/Projekty/tft-generator/client`:
```bash
npm run lint && npm run build
```

Expected: Both succeed.

- [ ] **Step 3: Commit (phase filters)**

```bash
cd D:/Projekty/tft-generator
git add client/src/algorithm/synergy-graph.js
git commit -m "$(cat <<'EOF'
feat(algorithm): filter all exploration phases against allowedSet

Six exploration phases (traitSeeded, deepVertical, pairSynergy,
companionSeeded, crossover, metaCompSeeded) now filter their seed
selection against allowedSet so no iterations are wasted generating
teams doomed by cost-level constraints. Meta comps are hard-cut
entirely if any member is disallowed — meta archetypes are cohesive
and partial seeds would break their intent.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Manual verification

**Files:** None (runtime verification only)

**Prerequisites:** Dev server running. From `D:/Projekty/tft-generator/client`:
```bash
npm run dev
```
Open the app in browser (usually `http://localhost:5173`).

- [ ] **Step 1: Lvl 5 without locks — no 4/5-costs**

In Scout panel, set level to 5, no locks, generate teams.

Expected: All 20 generated teams contain only 1-cost, 2-cost, and 3-cost champions. Zero 4-costs, zero 5-costs. Verify visually in the team cards (cost is usually color-coded in CompCard).

If any 4/5-cost appears: FAIL — filter is leaking somewhere.

- [ ] **Step 2: Lvl 5 with locked 4-cost — lock stays, rest is 1-3 costs**

Same as Step 1 but lock one 4-cost champion (e.g. Jinx). Regenerate.

Expected: Every team contains the locked 4-cost. All other slots in every team are 1-3 costs (no other 4-costs, no 5-costs).

- [ ] **Step 3: Lvl 5 with locked 5-cost — lock stays, rest is 1-3 costs**

Lock one 5-cost instead. Regenerate.

Expected: Every team contains the locked 5-cost. All other slots are 1-3 costs.

- [ ] **Step 4: Lvl 6 vs lvl 7 — 4-costs appear at lvl 7 only**

Set level to 6, no locks, generate. Note: no 4-costs.
Set level to 7, no locks, generate.

Expected: Lvl 6 teams have zero 4/5-costs. Lvl 7 teams may contain 4-costs (not guaranteed every team, but at least some). Still zero 5-costs.

- [ ] **Step 5: Lvl 9 — 5-costs appear**

Set level to 9, no locks, generate.

Expected: At least one team contains a 5-cost (5-costs are now allowed). 4-costs common.

- [ ] **Step 6: Legacy call without level — unchanged behavior**

(This is harder to verify from UI since UI always sends level. Skip if UI doesn't expose it. Otherwise: if there's a debug path or test harness, pass `level: null` and confirm teams generate as before.)

If not testable from UI: visually confirm that the code path `if (!level) return new Set(Object.keys(graph.nodes));` in `buildAllowedSet` is unchanged — this preserves backwards compatibility.

- [ ] **Step 7: Performance sanity check**

Generate teams multiple times at lvl 5. Observe that generation feels equal or faster than before (should be faster because phases skip earlier). No hard metric — subjective but noticeable if regression.

- [ ] **Step 8: Report findings**

If all steps pass: report "All manual verification steps passed" and stop.

If any step fails: document which step, what was observed vs expected, and stop. Do NOT attempt to patch — root-cause investigation is a separate task.

---

## Out of scope (explicit)

- Updating `expectedStarPower` in `config.js` — separate architectural debt, see memory note `project_fallback_scoring_debt.md`.
- Adding test infrastructure for `client/` — not the goal of this plan.
- Deriving `MIN_LEVEL_BY_COST` automatically from `SHOP_ODDS` — minor optimization, low priority.
- Changes to `scorer.js`, `engine.js`, `useScout.js`, or worker files — not needed.

---

## Summary of commits this plan produces

1. **`feat(algorithm): add MIN_LEVEL_BY_COST + buildAllowedSet infrastructure`** — Tasks 1-2
2. **`feat(algorithm): hard-filter buildOneTeam candidates + locked-exempt costPenalty`** — Tasks 3-5
3. **`feat(algorithm): filter all exploration phases against allowedSet`** — Tasks 6-11

Task 12 is verification only, no commit.
