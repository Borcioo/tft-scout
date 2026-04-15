// @ts-nocheck -- legacy port C5: 903-line JS file, typed at module boundary only
/**
 * Synergy Graph — trait-based champion graph for team discovery.
 *
 * PURE — no DB, no fetch. Accepts data as arguments.
 *
 * Structure:
 *   - Nodes: champions (domain objects)
 *   - Edges: shared traits (weighted by count)
 *   - Trait clusters: groups of champions sharing a trait
 */

import { SCORING_CONFIG, MIN_LEVEL_BY_COST } from './config';
import { startSpan } from './scout-profiler';
import { applyEmblems } from './synergy-graph/shared/emblems';
import {
  FILLER_COST_WEIGHTS,
  FILLER_PICK_DECAY,
  FILLER_TOP_K_PER_ANCHOR,
  FILLER_MAX_PICKS,
  FILLER_BOOTSTRAP_ANCHORS,
  FILLER_DEFAULT_FIVE_COST_CAP,
} from './synergy-graph/shared/const';

export { buildGraph } from './synergy-graph/graph';
// import-then-export (not bare `export { X } from`) below because this
// file also CALLS these names in its phase bodies — bare re-export
// would not create a local binding, so the inline callers would fail
// to resolve. Once all phases move out (Task 14), this block simplifies
// to bare re-exports.
import { quickScore } from './synergy-graph/quick-score';
export { quickScore };
import { buildOneTeam, costPenalty } from './synergy-graph/shared/team-builder';
export { buildOneTeam, costPenalty };
import { phasePairSynergy } from './synergy-graph/phases/pair-synergy';
export { phasePairSynergy };
import { phaseHillClimb } from './synergy-graph/phases/hill-climb';
export { phaseHillClimb };
import { phaseLockedTraitSeeded } from './synergy-graph/phases/locked-trait-seeded';
export { phaseLockedTraitSeeded };
import { phaseDeepVertical } from './synergy-graph/phases/deep-vertical';
export { phaseDeepVertical };
import { phaseMetaCompSeeded } from './synergy-graph/phases/meta-comp-seeded';
export { phaseMetaCompSeeded };
import { phaseCrossover } from './synergy-graph/phases/crossover';
export { phaseCrossover };
import { phaseTraitSeeded } from './synergy-graph/phases/trait-seeded';
export { phaseTraitSeeded };
import { phaseTemperatureSweep } from './synergy-graph/phases/temperature-sweep';
export { phaseTemperatureSweep };
import { phaseFiveCostHeavy } from './synergy-graph/phases/five-cost-heavy';
export { phaseFiveCostHeavy };
import { phaseCompanionSeeded } from './synergy-graph/phases/companion-seeded';
export { phaseCompanionSeeded };

const { weights, breakpointMultiplier, nearBreakpointBonus, minGamesForReliable, thresholds } = SCORING_CONFIG;

// ── RNG ─────────────────────────────────────────

function createRng(seed) {
  let s = seed | 0;

  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Locked-trait seeded phase ──────────────────────
//
// Activates only when the user requested trait locks. Produces seed
// combinations that actually satisfy every lock and feeds them to
// buildOneTeam so the lock constraint drives generation instead of
// being left to the post-filter. Runs first in the pipeline (see
// findTeams below) so lock-satisfying teams populate the result map
// before other phases consume their shared early-exit budget.

/**
 * Collect candidate champions for every locked trait. Returns a map
 * keyed by trait apiName or null when any lock is impossible given
 * the current pool (caller should bail without running any attempts).
 *
 * Hero variants and user-excluded champions are filtered out; the
 * allowed-set gate (level-based shop odds) is respected too.
 */
export function buildLockedTraitPool(lockedTraits, graph, excludedSet, allowedSet) {
  const pool = new Map();

  for (const lock of lockedTraits) {
    const candidates = [];

    for (const [api, node] of Object.entries(graph.nodes)) {
      if (!node || node.variant === 'hero') {
        continue;
      }

      if (excludedSet.has(api)) {
        continue;
      }

      if (allowedSet && !allowedSet.has(api)) {
        continue;
      }

      if (!node.traits || !node.traits.includes(lock.apiName)) {
        continue;
      }

      candidates.push(api);
    }

    if (candidates.length < lock.minUnits) {
      return null;
    }

    pool.set(lock.apiName, candidates);
  }

  return pool;
}

/**
 * Deterministic seed strategy #1 — sort each trait's pool by the
 * MetaTFT unitRating score (higher is better) with an apiName
 * tie-breaker, then slice `minUnits` champs. The attemptIndex
 * rotates the slice window so attempt 0 takes the top minUnits,
 * attempt 1 shifts by 1, etc. With 20 attempts on a typical
 * pool of 6–10 champs this rotates through every realistic
 * top-K combination without explicit enumeration.
 */
export function pickSeedsTopUnitRating(pool, lockedTraits, graph, unitRatings, attemptIndex) {
  const seeds = new Set();

  for (const lock of lockedTraits) {
    const candidates = pool.get(lock.apiName) ?? [];

    if (candidates.length === 0) {
      continue;
    }

    const sorted = [...candidates].sort((a, b) => {
      const ra = unitRatings?.[a]?.score ?? 0;
      const rb = unitRatings?.[b]?.score ?? 0;

      if (ra !== rb) {
        return rb - ra;
      }

      return a.localeCompare(b);
    });

    const windowStart = attemptIndex % Math.max(1, sorted.length - lock.minUnits + 1);

    for (let i = 0; i < lock.minUnits; i++) {
      const pick = sorted[(windowStart + i) % sorted.length];

      seeds.add(pick);
    }
  }

  return [...seeds];
}

/**
 * Enumerate companion-proven pairs from the locked-trait pool, sorted
 * by avgPlace ascending. A pair (A, B) qualifies when:
 *   - A is in some locked trait's pool,
 *   - B is in a (possibly different) locked trait's pool,
 *   - ctx.companions[baseOf(A)] contains an entry for baseOf(B),
 *   - that entry's avgPlace < 4.0 (top-half of placements).
 *
 * Returned once per findTeams call — computed lazily and cached by
 * the caller.
 */
export function enumerateLockedTraitCompanionPairs(pool, lockedTraits, companions, graph) {
  if (!companions) {
    return [];
  }

  const unionPool = new Set();

  for (const lock of lockedTraits) {
    for (const api of pool.get(lock.apiName) ?? []) {
      unionPool.add(api);
    }
  }

  const baseOf = (api) => graph.nodes[api]?.baseApiName || api;
  const pairs = [];
  const seen = new Set();

  for (const a of unionPool) {
    const entries = companions[baseOf(a)];

    if (!entries) {
      continue;
    }

    for (const entry of entries) {
      const b = entry.companion;

      if (!unionPool.has(b) || a === b) {
        continue;
      }

      const key = [a, b].sort((x, y) => x.localeCompare(y)).join('+');

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);

      if (typeof entry.avgPlace === 'number' && entry.avgPlace < 4.0) {
        pairs.push({ a, b, avgPlace: entry.avgPlace });
      }
    }
  }

  pairs.sort((x, y) => x.avgPlace - y.avgPlace);

  return pairs;
}

/**
 * Deterministic seed strategy #2 — pick the N-th companion-proven pair
 * from the pre-sorted list, then fill each trait's minUnits requirement
 * by drawing from the unit-rating-sorted pool. Falls back to the
 * top-unit-rating strategy when no pairs exist (no MetaTFT companion
 * data for the pool or all avgPlaces ≥ 4.0).
 */
export function pickSeedsCompanionPair(pool, lockedTraits, graph, unitRatings, pairs, attemptIndex) {
  if (pairs.length === 0) {
    return pickSeedsTopUnitRating(pool, lockedTraits, graph, unitRatings, attemptIndex);
  }

  const pair = pairs[attemptIndex % pairs.length];
  const seeds = new Set([pair.a, pair.b]);

  for (const lock of lockedTraits) {
    const members = (pool.get(lock.apiName) ?? []).filter(api => seeds.has(api));

    if (members.length >= lock.minUnits) {
      continue;
    }

    const sorted = [...(pool.get(lock.apiName) ?? [])]
      .filter(api => !seeds.has(api))
      .sort((a, b) => {
        const ra = unitRatings?.[a]?.score ?? 0;
        const rb = unitRatings?.[b]?.score ?? 0;

        if (ra !== rb) {
          return rb - ra;
        }

        return a.localeCompare(b);
      });

    const needed = lock.minUnits - members.length;

    for (let i = 0; i < needed && i < sorted.length; i++) {
      seeds.add(sorted[i]);
    }
  }

  return [...seeds];
}

/**
 * Deterministic seed strategy #3 — for each locked trait, pick
 * minUnits champions with a deliberate cost spread instead of clustering
 * on the cheapest ones. For pools with enough variety we take the
 * cheapest, the most expensive, and fill the middle from the
 * unit-rating-sorted remainder. For small minUnits (<3) we just take
 * cheapest + most expensive so the strategy degrades gracefully.
 *
 * Uses the shared RNG so the cost buckets are shuffled deterministically
 * per attempt — without it every attempt would pick the same stratified
 * seed and we'd lose the diversity we're paying for.
 */
export function pickSeedsCostStratified(pool, lockedTraits, graph, unitRatings, rng) {
  const seeds = new Set();

  for (const lock of lockedTraits) {
    const candidates = pool.get(lock.apiName) ?? [];

    if (candidates.length === 0) {
      continue;
    }

    const byCost = [...candidates].sort((a, b) => {
      const ca = graph.nodes[a]?.cost ?? 0;
      const cb = graph.nodes[b]?.cost ?? 0;

      if (ca !== cb) {
        return ca - cb;
      }

      return a.localeCompare(b);
    });

    const picks = new Set();
    const minUnits = lock.minUnits;

    picks.add(byCost[0]);

    if (minUnits >= 2) {
      picks.add(byCost[byCost.length - 1]);
    }

    if (minUnits >= 3) {
      const mid = Math.floor(byCost.length / 2);
      picks.add(byCost[mid]);
    }

    // Fill remaining slots from a shuffled copy so later attempts
    // explore different fillers around the anchored endpoints.
    const remaining = byCost.filter(api => !picks.has(api));

    for (let i = remaining.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = remaining[i];

      remaining[i] = remaining[j];
      remaining[j] = tmp;
    }

    let idx = 0;

    while (picks.size < minUnits && idx < remaining.length) {
      picks.add(remaining[idx]);
      idx++;
    }

    for (const api of picks) {
      seeds.add(api);
    }
  }

  return [...seeds];
}

// ── Exploration phases ─────────────────────────────
// Each phase receives phaseCtx and adds results via addResult.
// Contract: { graph, teamSize, startChamps, context, rng, maxResults,
//             results, addResult, excludedSet, emblems, excludedTraits }






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

export function pickCompanionFillers(graph, context, anchorApis) {
  const { nodes } = graph;
  const companionData = graph.scoringCtx?.companions || {};
  const unitRatings = graph.scoringCtx?.unitRatings || {};

  const anchorSet = new Set(anchorApis);
  const allowedSet = context.allowedSet;
  const excludedSet = new Set(context.excludedChampions || []);

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

    candidateScore.set(bestApi, bestScore * FILLER_PICK_DECAY);
  }

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




// ── Diversification ────────────────────────────────

function diversifyResults(results, maxResults, traitBreakpoints, emblems = []) {
  const sorted = [...results.values()].sort((a, b) => b.score - a.score);

  // Group by dominant trait pair + breakpoint level
  const grouped = new Map();

  for (const team of sorted) {
    const traitCounts = {};

    for (const c of team.champions) {
      for (const t of c.traits) {
traitCounts[t] = (traitCounts[t] || 0) + 1;
}
    }

    const champTraitSets = team.champions.map(c => new Set(c.traits || []));
    applyEmblems(traitCounts, emblems, champTraitSets);
    const groupKey = Object.entries(traitCounts)
      .filter(([t]) => (traitBreakpoints[t]?.[0] || 0) > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([t, count]) => {
        const bps = traitBreakpoints[t] || [];
        let lvl = 0;

        for (let i = bps.length - 1; i >= 0; i--) {
 if (count >= bps[i]) {
 lvl = i; break; 
} 
}

        return `${t}@${lvl}`;
      })
      .sort()
      .join('+') || 'flex';

    if (!grouped.has(groupKey)) {
grouped.set(groupKey, team);
}
  }

  // Best per group first, then fill with remaining
  const diverse = [...grouped.values()].sort((a, b) => b.score - a.score);
  const seenKeys = new Set(diverse.map(t => t.champions.map(c => c.apiName).sort().join(',')));

  for (const t of sorted) {
    const key = t.champions.map(c => c.apiName).sort().join(',');

    if (!seenKeys.has(key)) {
      diverse.push(t);
      seenKeys.add(key);
    }

    if (diverse.length >= maxResults) {
break;
}
  }

  return diverse.slice(0, maxResults);
}

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
  if (!level) {
return new Set(Object.keys(graph.nodes));
}

  const allowed = new Set(lockedChamps || []);

  for (const [api, node] of Object.entries(graph.nodes)) {
    const cost = node.cost || 1;
    const minLvl = MIN_LEVEL_BY_COST[cost];

    if (minLvl != null && level >= minLvl) {
allowed.add(api);
}
  }

  return allowed;
}

// ── Public API ───────────────────────────────────

/**
 * Find optimal teams using graph traversal.
 *
 * @param {object} graph - from buildGraph()
 * @param {object} options
 * @returns {Array<{champions: object[], score: number}>}
 */
export function findTeams(graph, options = {}) {
  const _end = startSpan('synergy.findTeams');

  try {
  const {
    teamSize = 8, startChamps = [], maxResults = 20,
    level = null, emblems = [], excludedTraits = [], excludedChampions = [],
    max5Cost = null, lockedTraits = [],
  } = options;

  const { nodes, traitBreakpoints, traitMap, exclusionLookup = {} } = graph;
  const allowedSet = buildAllowedSet(graph, level, startChamps);
  const lockedSet = new Set(startChamps);

  // Default max 5-cost scales with level. User-provided max5Cost overrides.
  // lvl 9: comp is 4-cost centric, 5-costs are lucky spike (max 2).
  // lvl 10: 5-costs are peak board but algorithm should propose variety (max 3).
  // lvl <9: 5-costs hard-filtered by MIN_LEVEL_BY_COST so cap is moot.
  let effectiveMax5Cost = max5Cost;

  if (effectiveMax5Cost == null && level != null) {
    if (level === 9) {
effectiveMax5Cost = 2;
} else if (level >= 10) {
effectiveMax5Cost = 3;
}
  }

  const context = {
    emblems, excludedTraits, excludedChampions, level,
    max5Cost: effectiveMax5Cost,
    lockedChamps: startChamps,
    allowedSet,
    lockedSet,
    lockedTraits,
  };

  // RNG seed — deterministic from inputs, or randomized via options.seed
  let seed = (options.seed || 0) + teamSize * 1000 + startChamps.length * 100 + (level || 0);

  for (const s of startChamps) {
    for (let i = 0; i < s.length; i++) {
seed = (seed * 31 + s.charCodeAt(i)) | 0;
}
  }

  const rng = createRng(seed);

  const results = new Map();

  function addResult(team) {
    if (team.length !== teamSize) {
return;
}

    if (effectiveMax5Cost != null) {
      const fiveCount = team.filter(api => (nodes[api]?.cost || 0) === 5).length;

      if (fiveCount > effectiveMax5Cost) {
return;
}
    }

    // Validate exclusion groups — reject teams with conflicting members
    const teamSet = new Set(team);

    for (const api of team) {
      const conflicts = exclusionLookup[api];

      if (conflicts) {
        for (const c of conflicts) {
          if (teamSet.has(c)) {
return;
} // conflicting pair found — reject
        }
      }
    }

    const key = [...team].sort().join(',');

    if (results.has(key)) {
return;
}

    const score = quickScore(team, graph, emblems) - costPenalty(team, graph, level, lockedSet, effectiveMax5Cost);
    const champions = team.map(api => nodes[api]).filter(Boolean);

    if (champions.length !== team.length) {
return;
}

    results.set(key, { champions, score });
  }

  // ── Run phases ──────────────────────────────────
  const excludedSet = new Set(excludedChampions);
  const phaseCtx = {
    graph, teamSize, startChamps, context, rng, maxResults,
    results, addResult, excludedSet, emblems, excludedTraits,
  };

  // Snapshot result keys that came out of the locked-trait phase.
  // These are teams we spent budget on specifically to satisfy the
  // user's trait locks — diversifyResults below caps the return at
  // `maxResults` and sorts by quickScore, which can push our
  // lock-satisfying teams out of the cut when other phases flood
  // the result map with generic high-quickScore comps. We snapshot
  // them here and splice them back in after diversify so the engine
  // post-filter still has something to keep.
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

    const _endDiversify = startSpan('synergy.diversify');
    const diverse = diversifyResults(results, maxResults, traitBreakpoints, emblems);
    _endDiversify();

  // Ensure every team the locked-trait phase generated survives the
  // diversifyResults cut. Without this splice the cut drops most of
  // them whenever the result map grows past `maxResults` — generic
  // phases (temperatureSweep, traitSeeded) can easily add 1000+
  // entries with higher quickScore numbers, pushing the
  // lock-satisfying teams out.
  if (lockedTraitSeedKeys.size > 0) {
    const diverseKeys = new Set(
      diverse.map(t => t.champions.map(c => c.apiName).sort().join(',')),
    );

    for (const key of lockedTraitSeedKeys) {
      const team = results.get(key);

      if (!team) {
        continue;
      }

      const teamKey = team.champions.map(c => c.apiName).sort().join(',');

      if (diverseKeys.has(teamKey)) {
        continue;
      }

      diverse.push(team);
      diverseKeys.add(teamKey);
    }
  }

    return diverse;
  } finally {
    _end();
  }
}
