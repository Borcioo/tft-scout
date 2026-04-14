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

const { weights, breakpointMultiplier, nearBreakpointBonus, minGamesForReliable, thresholds } = SCORING_CONFIG;

// ── Emblem helpers ─────────────────────────────

/**
 * Apply emblems to trait counts, respecting the constraint that each emblem
 * must go on a champion who doesn't already have that trait.
 * Mutates traitCounts in place.
 */
function applyEmblems(traitCounts, emblems, champTraitSets) {
  // champTraitSets: array of Sets, one per champion (their natural traits)
  // For each emblem trait, count how many champions DON'T have it → max usable
  const emblemsByTrait = {};

  for (const e of emblems) {
emblemsByTrait[e] = (emblemsByTrait[e] || 0) + 1;
}

  for (const [trait, count] of Object.entries(emblemsByTrait)) {
    const holders = champTraitSets.filter(ts => !ts.has(trait)).length;
    const usable = Math.min(count, holders);

    if (usable > 0) {
traitCounts[trait] = (traitCounts[trait] || 0) + usable;
}
  }
}

// ── Graph construction ──────────────────────────

/**
 * Build synergy graph from champion and trait data.
 * @param {object[]} champions - domain objects with .apiName, .traits, .cost, etc.
 * @param {object[]} traits - domain objects with .apiName, .breakpoints
 * @param {object} scoringCtx - { unitRatings, traitRatings, styleScores, affinity }
 */
export function buildGraph(champions, traits, scoringCtx = {}, exclusionLookup = {}) {
  const nodes = {};

  for (const c of champions) {
    nodes[c.apiName] = c;
  }

  // Trait → champion apiNames
  const traitMap = {};

  for (const c of champions) {
    for (const t of c.traits) {
      (traitMap[t] ??= []).push(c.apiName);
    }
  }

  // Adjacency: champA → [{ champ, sharedTraits, traits }]
  const adjacency = {};

  for (const api of Object.keys(nodes)) {
adjacency[api] = [];
}

  for (const [trait, members] of Object.entries(traitMap)) {
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = members[i], b = members[j];
        const existing = adjacency[a].find(e => e.champ === b);

        if (existing) {
          existing.sharedTraits++;
          existing.traits.push(trait);
        } else {
          adjacency[a].push({ champ: b, sharedTraits: 1, traits: [trait] });
          adjacency[b].push({ champ: a, sharedTraits: 1, traits: [trait] });
        }
      }
    }
  }

  // Trait breakpoint lookup: traitApiName → [minUnits...]
  const traitBreakpoints = {};

  for (const t of traits) {
    traitBreakpoints[t.apiName] = (t.breakpoints || [])
      .sort((a, b) => a.minUnits - b.minUnits)
      .map(bp => bp.minUnits);
  }

  // Trait style lookup: traitApiName → { position → styleName }
  const traitStyles = {};

  for (const t of traits) {
    const styleMap = {};

    for (const bp of (t.breakpoints || [])) {
      styleMap[bp.position] = bp.style;
    }

    traitStyles[t.apiName] = styleMap;
  }

  // Add companion edges — champions that perform well together in real games
  // These create "hidden" graph connections beyond shared traits
  const companionData = scoringCtx.companions || {};

  for (const [unitApi, companionList] of Object.entries(companionData)) {
    if (!nodes[unitApi] || !companionList) {
continue;
}

    for (const comp of companionList) {
      if (!nodes[comp.companion]) {
continue;
}

      if (comp.games < thresholds.companionMinGames) {
continue;
}

      // Only add edge if not already connected via traits
      const existing = adjacency[unitApi]?.find(e => e.champ === comp.companion);

      if (!existing) {
        adjacency[unitApi].push({
          champ: comp.companion,
          sharedTraits: 0,
          traits: [],
          companionScore: comp.avgPlace,
        });
        adjacency[comp.companion].push({
          champ: unitApi,
          sharedTraits: 0,
          traits: [],
          companionScore: comp.avgPlace,
        });
      }
    }
  }

  return { nodes, traitMap, adjacency, traitBreakpoints, traitStyles, scoringCtx, exclusionLookup };
}

// ── Quick synergy scoring (for graph traversal) ─

function quickScore(champApis, graph, emblems = []) {
  const { nodes, traitBreakpoints, scoringCtx } = graph;
  const { unitRatings = {}, traitRatings = {}, styleScores = {}, affinity = {}, companions = {} } = scoringCtx;

  const traitCounts = {};

  for (const api of champApis) {
    const node = nodes[api];

    if (!node) {
continue;
}

    for (const t of node.traits) {
      const isMechaEnhanced = node.variant === 'enhanced' && t === 'TFT17_Mecha';
      traitCounts[t] = (traitCounts[t] || 0) + (isMechaEnhanced ? 2 : 1);
    }
  }

  const champTraitSets = champApis.map(api => new Set(nodes[api]?.traits || []));
  applyEmblems(traitCounts, emblems, champTraitSets);

  let score = 0;

  // Champion scores
  for (const api of champApis) {
    const node = nodes[api];

    if (!node) {
continue;
}

    const lookupApi = node.baseApiName || api;
    const ur = unitRatings[lookupApi];

    if (ur && ur.games >= minGamesForReliable) {
      score += ur.score * weights.unitRating;
    } else {
      score += (node.cost + 1) * 0.5;
    }
  }

  // Trait scores
  for (const [trait, count] of Object.entries(traitCounts)) {
    const bps = traitBreakpoints[trait] || [];
    let activeIdx = -1;

    for (let i = bps.length - 1; i >= 0; i--) {
      if (count >= bps[i]) {
 activeIdx = i; break; 
}
    }

    if (activeIdx < 0) {
continue;
}

    if (bps[0] === 1 && bps.length === 1) {
      const tr = traitRatings[trait]?.[1];
      score += (tr && tr.games >= minGamesForReliable) ? tr.score * weights.uniqueTrait : 5;
      continue;
    }

    const bpPos = activeIdx + 1;
    const bpMult = breakpointMultiplier[Math.min(activeIdx, breakpointMultiplier.length - 1)];
    const tr = traitRatings[trait]?.[bpPos];

    if (tr && tr.games >= minGamesForReliable) {
      const breakEven = activeIdx >= 3 ? 0.20 : activeIdx >= 1 ? 0.40 : 0.25;
      score += Math.max((tr.score - breakEven) * weights.traitRating * bpMult, -5);
    } else {
      // Style-based fallback
      const styleName = graph.traitStyles[trait]?.[bpPos] || 'Bronze';
      const fallback = styleScores[styleName] || 0.22;
      score += fallback * weights.traitRating * bpMult;
    }

    if (activeIdx >= 1) {
score += weights.synergyBonus;
}

    // Proven bonus — exceptional breakpoints get direct boost (mirrors full scorer)
    if (tr && tr.games >= thresholds.phaseMinGames && tr.avgPlace < 4.0) {
      let proven = (4.0 - tr.avgPlace) * weights.traitRating;

      if (tr.avgPlace < 2.5) {
proven += Math.pow(2.5 - tr.avgPlace, 2) * weights.traitRating * 2;
}

      score += proven;
    }

    const nextBp = bps[activeIdx + 1];

    if (nextBp) {
      const toNext = nextBp - count;

      if (toNext === 1) {
score += nearBreakpointBonus;
} else if (count > bps[activeIdx]) {
score -= (count - bps[activeIdx]) * weights.overflowPenalty;
}
    }
  }

  // Active traits = those that hit at least their first breakpoint
  const activeTraitApis = new Set();

  for (const [trait, count] of Object.entries(traitCounts)) {
    const bps = traitBreakpoints[trait] || [];

    if (bps.length > 0 && count >= bps[0]) {
activeTraitApis.add(trait);
}
  }

  // Orphan penalty — champion whose traits don't overlap with any active trait
  for (const api of champApis) {
    const node = nodes[api];

    if (!node) {
continue;
}

    let hasActive = false;

    for (const t of node.traits) {
      if (activeTraitApis.has(t)) {
 hasActive = true; break; 
}
    }

    if (!hasActive) {
score -= weights.orphanPenalty;
}
  }

  // Lightweight affinity + companion bonus (subset of full scorer)
  const champApiSet = new Set(champApis);

  for (const api of champApis) {
    const node = nodes[api];

    if (!node) {
continue;
}

    const lookupApi = node.baseApiName || api;

    // Affinity: does this champion statistically win with active traits?
    // Cap at top 3 matches per champion to avoid diversity bias
    const affData = affinity[lookupApi];

    if (affData) {
      const affMatches = [];

      for (const aff of affData) {
        if (activeTraitApis.has(aff.trait) && aff.games >= thresholds.affinityMinGames) {
          affMatches.push(weights.affinityBonus * (1 - aff.avgPlace / 8));
        }
      }

      affMatches.sort((a, b) => b - a);

      for (let i = 0; i < Math.min(affMatches.length, 3); i++) {
score += affMatches[i];
}
    }

    // Companions: are champion pairs confirmed as strong?
    const compData = companions[lookupApi];

    if (compData) {
      for (const comp of compData) {
        if (champApiSet.has(comp.companion) && comp.games >= thresholds.companionMinGames) {
          score += weights.affinityBonus * (1 - comp.avgPlace / 8);
        }
      }
    }
  }

  return score;
}

// ── Shop odds / cost penalty ────────────────────

const SHOP_ODDS = {
  1:  [1.00, 0,    0,    0,    0],
  2:  [1.00, 0,    0,    0,    0],
  3:  [0.75, 0.25, 0,    0,    0],
  4:  [0.55, 0.30, 0.15, 0,    0],
  5:  [0.45, 0.33, 0.20, 0.02, 0],
  6:  [0.30, 0.40, 0.25, 0.05, 0],
  7:  [0.19, 0.30, 0.40, 0.10, 0.01],
  8:  [0.15, 0.20, 0.32, 0.30, 0.03],
  9:  [0.10, 0.17, 0.25, 0.33, 0.15],
  10: [0.05, 0.10, 0.20, 0.40, 0.25],
};

function costPenalty(champApis, graph, level, lockedSet = null, max5Cost = null) {
  if (!level) {
return 0;
}

  const odds = SHOP_ODDS[level] || SHOP_ODDS[8];
  // Locked champions are a pure bonus — they don't consume budget and don't
  // count toward cost limits. Limits are still computed from the full team size
  // so non-locked slots have the normal budget of a fielded team.
  const teamSize = champApis.length;

  if (teamSize === 0) {
return 0;
}

  const limits = odds.map(o => {
    if (o === 0) {
return 0;
}

    if (o <= 0.05) {
return 1;
}

    if (o <= 0.15) {
return 2;
}

    return Math.ceil(o * teamSize) + 1;
  });

  // User's explicit max5Cost raises the 5-cost soft cap — they signaled they
  // want 5-cost heavy teams, so don't penalize them up to their chosen limit.
  if (max5Cost != null && max5Cost > limits[4]) {
    limits[4] = max5Cost;
  }

  const costCounts = [0, 0, 0, 0, 0];

  for (const api of champApis) {
    if (lockedSet && lockedSet.has(api)) {
continue;
}

    const cost = graph.nodes[api]?.cost || 3;

    if (cost >= 1 && cost <= 5) {
costCounts[cost - 1]++;
}
  }

  let penalty = 0;

  for (let i = 0; i < 5; i++) {
    const excess = costCounts[i] - limits[i];

    if (excess > 0) {
penalty += excess * 12;
}
  }

  return penalty;
}

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

function weightedPick(candidates, temperature, rng) {
  const poolSize = Math.min(candidates.length, Math.max(3, Math.round(12 * temperature)));
  const w = [];

  for (let i = 0; i < poolSize; i++) {
w.push(Math.pow(1 - temperature * 0.6, i));
}

  const total = w.reduce((a, b) => a + b, 0);
  let rand = rng() * total;

  for (let i = 0; i < w.length; i++) {
    rand -= w[i];

    if (rand <= 0) {
return candidates[i];
}
  }

  return candidates[poolSize - 1];
}

// ── Team building ───────────────────────────────

function buildOneTeam(graph, teamSize, startChamps, context, temperature, rng) {
  const { nodes, adjacency, exclusionLookup = {} } = graph;
  const { emblems = [], excludedChampions = [], max5Cost = null, lockedChamps = [], allowedSet = null } = context;
  const excludedSet = new Set(excludedChampions);

  // Track 5-cost count to enforce limit during building
  let fiveCostCount = 0;

  // Locked champions ALWAYS stay — they are the user's hard constraint
  const lockedSet = new Set(lockedChamps.filter(api => nodes[api]));
  // Defensive: filter non-locked seeds through allowedSet too, so any phase
  // that passes unfiltered seeds can't leak disallowed champions into a team.
  const seeds = startChamps.filter(api =>
    nodes[api] &&
    !lockedSet.has(api) &&
    (!allowedSet || allowedSet.has(api))
  );

  // Budget for seeds = teamSize minus locked slots
  const seedBudget = teamSize - lockedSet.size;
  let validSeeds = seeds;

  if (validSeeds.length > seedBudget) {
    validSeeds.sort((a, b) => (nodes[b]?.cost || 0) - (nodes[a]?.cost || 0));
    validSeeds = validSeeds.slice(0, seedBudget);
  }

  const validStart = [...lockedSet, ...validSeeds];
  const team = [...validStart];
  const used = new Set(validStart);

  // Exclude conflicts of start champions + count 5-costs
  for (const api of validStart) {
    const conflicts = exclusionLookup[api];

    if (conflicts) {
conflicts.forEach(c => excludedSet.add(c));
}

    if ((nodes[api]?.cost || 0) === 5) {
fiveCostCount++;
}
  }

  while (team.length < teamSize) {
    const candidates = [];
    const seen = new Set();

    const atFiveCostLimit = max5Cost != null && fiveCostCount >= max5Cost;

    // Neighbors first
    for (const member of team) {
      for (const edge of (adjacency[member] || [])) {
        if (used.has(edge.champ) || seen.has(edge.champ) || excludedSet.has(edge.champ)) {
continue;
}

        if (allowedSet && !allowedSet.has(edge.champ)) {
continue;
}

        if (atFiveCostLimit && (nodes[edge.champ]?.cost || 0) === 5) {
continue;
}

        seen.add(edge.champ);
        const testTeam = [...team, edge.champ];
        const score = quickScore(testTeam, graph, emblems) - costPenalty(testTeam, graph, context.level, context.lockedSet, context.max5Cost);
        candidates.push({ champ: edge.champ, score });
      }
    }

    // Fill with non-neighbors if needed
    if (candidates.length < 15) {
      for (const api of Object.keys(nodes)) {
        if (used.has(api) || seen.has(api) || excludedSet.has(api)) {
continue;
}

        if (allowedSet && !allowedSet.has(api)) {
continue;
}

        if (atFiveCostLimit && (nodes[api]?.cost || 0) === 5) {
continue;
}

        seen.add(api);
        const testTeam = [...team, api];
        const score = quickScore(testTeam, graph, emblems) - costPenalty(testTeam, graph, context.level, context.lockedSet, context.max5Cost);
        candidates.push({ champ: api, score });
      }
    }

    if (candidates.length === 0) {
break;
}

    candidates.sort((a, b) => b.score - a.score);

    // Penalize excluded traits
    if (context.excludedTraits?.length) {
      for (const c of candidates) {
        const node = nodes[c.champ];

        if (node) {
          for (const t of node.traits) {
            if (context.excludedTraits.includes(t)) {
c.score -= 15;
}
          }
        }
      }

      candidates.sort((a, b) => b.score - a.score);
    }

    const pick = weightedPick(candidates, temperature, rng);

    if (!pick) {
break;
}

    team.push(pick.champ);
    used.add(pick.champ);

    if ((nodes[pick.champ]?.cost || 0) === 5) {
fiveCostCount++;
}

    // Exclude conflicting members from same exclusion group
    const conflicts = exclusionLookup[pick.champ];

    if (conflicts) {
conflicts.forEach(c => excludedSet.add(c));
}
  }

  return team;
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
function buildLockedTraitPool(lockedTraits, graph, excludedSet, allowedSet) {
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
function pickSeedsTopUnitRating(pool, lockedTraits, graph, unitRatings, attemptIndex) {
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
function enumerateLockedTraitCompanionPairs(pool, lockedTraits, companions, graph) {
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
function pickSeedsCompanionPair(pool, lockedTraits, graph, unitRatings, pairs, attemptIndex) {
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
function pickSeedsCostStratified(pool, lockedTraits, graph, unitRatings, rng) {
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

/**
 * Phase entry point. Pulls lockedTraits from the shared context and
 * runs three batches of attempts:
 *   - 20 × top-unit-rating   (proven individual strength)
 *   - 20 × companion-pair    (MetaTFT "plays together" data)
 *   - 10 × cost-stratified   (diversity guard)
 *
 * Each attempt passes its seeds to buildOneTeam and writes any
 * successful team into the shared result map via addResult. Bounded
 * by a dedicated cap of 50 attempts regardless of maxResults so the
 * runtime contribution of this phase stays predictable (~250 ms at
 * ~5 ms per buildOneTeam) and does not eat into the budget for the
 * other phases that run afterwards.
 *
 * Uses the same buildOneTeam signature as every other phase — see
 * phaseTemperatureSweep for the canonical pattern.
 */
function phaseLockedTraitSeeded({ graph, teamSize, context, rng, addResult, excludedSet }) {
  const rawLockedTraits = context.lockedTraits ?? [];

  if (rawLockedTraits.length === 0) {
    return;
  }

  // Subtract emblem count per trait from minUnits so the phase seeds
  // only the physical champions the team actually needs to buy.
  // The engine-side filter still checks the emblem-inclusive count
  // through buildActiveTraits, so a team built with effective minUnits
  // physical champions + N emblems will pass the post-filter for the
  // original minUnits target. Without this adjustment the phase seeds
  // `minUnits` full-Ranged picks and saturates the team slots, leaving
  // no room for the emblem carrier to diversify across comps.
  const emblems = context.emblems || [];
  const lockedTraits = rawLockedTraits.map(lock => {
    let emblemCount = 0;

    for (const e of emblems) {
      if (e === lock.apiName) {
        emblemCount++;
      }
    }

    const effectiveMin = Math.max(0, lock.minUnits - emblemCount);

    return { apiName: lock.apiName, minUnits: effectiveMin };
  }).filter(lock => lock.minUnits > 0);

  if (lockedTraits.length === 0) {
    return;
  }

  const pool = buildLockedTraitPool(lockedTraits, graph, excludedSet, context.allowedSet);

  if (pool === null) {
    return;
  }

  const unitRatings = graph.scoringCtx?.unitRatings ?? {};
  const companions = graph.scoringCtx?.companions ?? null;
  const pairs = enumerateLockedTraitCompanionPairs(pool, lockedTraits, companions, graph);

  // Sweep the temperature across attempts so the flex-slot fillers
  // buildOneTeam picks behind the seeded core actually vary. With a
  // narrow 0.1–0.3 window the team-builder converges on the same
  // top-scoring filler every attempt; that collapses the 50-attempt
  // budget to a handful of unique comps whenever a trait lock with
  // an emblem pushes one filler far ahead of the rest (e.g.
  // ShieldTank:6 + RangedTrait:4 + emblem producing a single comp
  // because every attempt re-picked the same Morgana).
  const attempt = (seeds, attemptIdx, total) => {
    if (seeds.length === 0) {
      return;
    }

    const temperature = 0.1 + (attemptIdx / Math.max(1, total - 1)) * 0.8;

    const team = buildOneTeam(graph, teamSize, seeds, context, temperature, rng);
    addResult(team);
  };

  for (let i = 0; i < 20; i++) {
    attempt(pickSeedsTopUnitRating(pool, lockedTraits, graph, unitRatings, i), i, 20);
  }

  for (let i = 0; i < 20; i++) {
    attempt(pickSeedsCompanionPair(pool, lockedTraits, graph, unitRatings, pairs, i), i, 20);
  }

  for (let i = 0; i < 10; i++) {
    attempt(pickSeedsCostStratified(pool, lockedTraits, graph, unitRatings, rng), i, 10);
  }
}

function phaseTemperatureSweep({ graph, teamSize, startChamps, context, rng, maxResults, results, addResult }) {
  const attempts = Math.max(maxResults * 3, 60);

  for (let i = 0; i < attempts; i++) {
    const temp = 0.15 + (i / attempts) * 0.85;
    addResult(buildOneTeam(graph, teamSize, startChamps, context, temp, rng));

    if (results.size >= maxResults * 2) {
break;
}
  }
}

function phaseTraitSeeded({ graph, teamSize, startChamps, context, rng, maxResults, results, addResult, excludedSet, excludedTraits }) {
  const { traitBreakpoints, traitMap } = graph;

  for (const [trait, members] of Object.entries(traitMap)) {
    const bps = traitBreakpoints[trait] || [];

    if (bps.length === 0 || bps[0] <= 1) {
continue;
}

    if (excludedTraits.includes(trait)) {
continue;
}

    const available = members.filter(m =>
      !excludedSet.has(m) &&
      !startChamps.includes(m) &&
      (!context.allowedSet || context.allowedSet.has(m))
    );

    if (available.length < 2) {
continue;
}

    for (let a = 0; a < 3; a++) {
      const shuffled = [...available].sort(() => rng() - 0.5);
      const seeds = [...startChamps, ...shuffled.slice(0, 2)];
      addResult(buildOneTeam(graph, teamSize, seeds, context, 0.3 + rng() * 0.5, rng));
    }

    if (results.size >= maxResults * 3) {
break;
}
  }
}

function phaseDeepVertical({ graph, teamSize, startChamps, context, rng, maxResults, results, addResult, excludedSet, excludedTraits, emblems }) {
  const { traitBreakpoints, traitMap } = graph;
  const { traitRatings = {} } = graph.scoringCtx || {};

  for (const [trait, members] of Object.entries(traitMap)) {
    const bps = traitBreakpoints[trait] || [];

    if (bps.length < 2 || bps[0] <= 1) {
continue;
}

    if (excludedTraits.includes(trait)) {
continue;
}

    const startSet = new Set(startChamps);
    const available = members.filter(m =>
      !excludedSet.has(m) &&
      !startSet.has(m) &&
      (!context.allowedSet || context.allowedSet.has(m))
    );
    const startMembersInTrait = startChamps.filter(s => members.includes(s)).length;
    const rawEmblemCount = emblems.filter(e => e === trait).length;

    for (let bpIdx = bps.length - 1; bpIdx >= 1; bpIdx--) {
      const targetUnits = bps[bpIdx];
      const rating = traitRatings[trait]?.[bpIdx + 1];

      if (!rating || rating.avgPlace > thresholds.deepVerticalMaxAvg || rating.games < thresholds.phaseMinGames) {
continue;
}

      // Emblems are capped by non-trait champions available to hold them
      // At most (teamSize - traitMembers) champions won't have this trait
      const maxTraitMembers = startMembersInTrait + available.length;
      const nonTraitSlots = Math.max(0, teamSize - Math.min(maxTraitMembers, teamSize));
      const emblemCount = Math.min(rawEmblemCount, nonTraitSlots);
      const needed = targetUnits - startMembersInTrait - emblemCount;

      if (needed <= 0 || available.length < needed) {
continue;
}

      // Breakpoint targeting
      for (let a = 0; a < 5; a++) {
        const shuffled = [...available].sort(() => rng() - 0.5);
        const seeds = [...new Set([...startChamps, ...shuffled.slice(0, needed)])];
        addResult(buildOneTeam(graph, teamSize, seeds, context, 0.1 + rng() * 0.15, rng));
      }

      // All-in: seed every available member
      if (available.length > needed && available.length <= teamSize) {
        for (let a = 0; a < 3; a++) {
          const allIn = [...new Set([...startChamps, ...available])];
          addResult(buildOneTeam(graph, teamSize, allIn, context, 0.05 + rng() * 0.1, rng));
        }
      }
    }

    if (results.size >= maxResults * 8) {
break;
}
  }
}

function phasePairSynergy({ graph, teamSize, startChamps, context, rng, maxResults, results, addResult, excludedSet }) {
  const { traitBreakpoints, traitMap } = graph;
  const { traitRatings = {} } = graph.scoringCtx || {};

  const strongTraits = Object.entries(traitRatings)
    .flatMap(([api, bps]) =>
      Object.entries(bps)
        .filter(([, r]) => r.avgPlace <= thresholds.pairSynergyMaxAvg && r.games >= thresholds.phaseMinGames)
        .map(([pos, r]) => ({ api, position: +pos, avgPlace: r.avgPlace, minUnits: traitBreakpoints[api]?.[pos - 1] || 99 }))
    )
    .filter(t => t.minUnits <= teamSize && traitMap[t.api])
    .sort((a, b) => a.avgPlace - b.avgPlace)
    .slice(0, 10);

  for (let i = 0; i < strongTraits.length; i++) {
    for (let j = i + 1; j < strongTraits.length; j++) {
      const t1 = strongTraits[i], t2 = strongTraits[j];

      if (t1.minUnits + t2.minUnits > teamSize) {
continue;
}

      const m1 = (traitMap[t1.api] || []).filter(m =>
        !excludedSet.has(m) && (!context.allowedSet || context.allowedSet.has(m))
      );
      const m2 = (traitMap[t2.api] || []).filter(m =>
        !excludedSet.has(m) && (!context.allowedSet || context.allowedSet.has(m))
      );

      if (m1.length < 2 || m2.length < 2) {
continue;
}

      const s1 = [...m1].sort(() => rng() - 0.5).slice(0, Math.min(t1.minUnits, 3));
      const s2 = [...m2].sort(() => rng() - 0.5).slice(0, Math.min(t2.minUnits, 3));
      const combined = [...new Set([...startChamps, ...s1, ...s2])].slice(0, teamSize);
      addResult(buildOneTeam(graph, teamSize, combined, context, 0.2 + rng() * 0.3, rng));
    }

    if (results.size >= maxResults * 6) {
break;
}
  }
}

function phaseCompanionSeeded({ graph, teamSize, startChamps, context, rng, maxResults, results, addResult }) {
  const { nodes } = graph;
  const { companions: companionData = {} } = graph.scoringCtx || {};

  for (const [, companionList] of Object.entries(companionData)) {
    if (!companionList) {
continue;
}

    const topCompanions = companionList
      .filter(c => c.games >= thresholds.companionMinGames && c.avgPlace <= thresholds.companionMaxAvg && nodes[c.companion])
      .sort((a, b) => a.avgPlace - b.avgPlace);

    for (const comp of topCompanions) {
      if (context.allowedSet && !context.allowedSet.has(comp.companion)) {
continue;
}

      const seeds = [...startChamps, comp.companion];
      addResult(buildOneTeam(graph, teamSize, seeds, context, 0.2 + rng() * 0.3, rng));
    }

    if (results.size >= maxResults * 4) {
break;
}
  }
}

// ── Phase 6: Crossover ─────────────────────────────
// Take top results, breed new teams by combining halves.
// Parent A contributes some members, parent B contributes others.
// Child inherits locked champs + mix of both parents' non-locked members.

function phaseCrossover({ graph, teamSize, startChamps, context, rng, maxResults, results, addResult }) {
  const topTeams = [...results.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(10, results.size));

  if (topTeams.length < 2) {
return;
}

  const lockedSet = new Set(startChamps);

  for (let i = 0; i < topTeams.length; i++) {
    for (let j = i + 1; j < topTeams.length; j++) {
      const parentA = topTeams[i].champions.map(c => c.apiName);
      const parentB = topTeams[j].champions.map(c => c.apiName);

      // Non-locked members from each parent
      const genesA = parentA.filter(a =>
        !lockedSet.has(a) && (!context.allowedSet || context.allowedSet.has(a))
      );
      const genesB = parentB.filter(a =>
        !lockedSet.has(a) && (!context.allowedSet || context.allowedSet.has(a))
      );

      // Split point: take first half from A, second from B
      const splitA = Math.ceil(genesA.length / 2);
      const splitB = Math.floor(genesB.length / 2);
      const childGenes = [...new Set([...genesA.slice(0, splitA), ...genesB.slice(splitB)])];
      const seeds = [...startChamps, ...childGenes].slice(0, teamSize);

      addResult(buildOneTeam(graph, teamSize, seeds, context, 0.1 + rng() * 0.15, rng));
    }
  }
}

// ── Phase 7: Hill climbing ─────────────────────────
// Take top results, try swapping each non-locked member for a better candidate.
// Pure local search: if swap improves quickScore, keep it.

function phaseHillClimb({ graph, teamSize, startChamps, context, rng, results, addResult, excludedSet }) {
  const { nodes, exclusionLookup = {} } = graph;
  const { emblems = [], max5Cost = null } = context;
  const lockedSet = new Set(startChamps);

  const topTeams = [...results.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  for (const team of topTeams) {
    const current = team.champions.map(c => c.apiName);
    let currentScore = team.score;

    // Single round of improvement
    for (let round = 0; round < 1; round++) {
      let improved = false;

      for (let slot = 0; slot < current.length; slot++) {
        if (lockedSet.has(current[slot])) {
continue;
}

        const removed = current[slot];
        const teamWithout = current.filter((_, i) => i !== slot);
        const usedSet = new Set(teamWithout);

        // Collect exclusion conflicts from remaining team
        const conflicts = new Set();

        for (const api of teamWithout) {
          const c = exclusionLookup[api];

          if (c) {
c.forEach(x => conflicts.add(x));
}
        }

        // Collect swap candidates: graph neighbors of remaining team (fast, targeted)
        const swapCandidates = new Set();

        for (const member of teamWithout) {
          for (const edge of (graph.adjacency[member] || [])) {
            if (usedSet.has(edge.champ) || excludedSet.has(edge.champ) || conflicts.has(edge.champ)) {
continue;
}

            if (context.allowedSet && !context.allowedSet.has(edge.champ)) {
continue;
}

            swapCandidates.add(edge.champ);
          }
        }

        let bestSwap = null;
        let bestScore = currentScore;
        const fiveCount = max5Cost != null ? teamWithout.filter(a => (nodes[a]?.cost || 0) === 5).length : 0;

        for (const api of swapCandidates) {
          if (max5Cost != null && (nodes[api]?.cost || 0) === 5 && fiveCount >= max5Cost) {
continue;
}

          const candidate = [...teamWithout, api];
          const score = quickScore(candidate, graph, emblems) - costPenalty(candidate, graph, context.level, context.lockedSet, context.max5Cost);

          if (score > bestScore) {
            bestScore = score;
            bestSwap = api;
          }
        }

        if (bestSwap) {
          current[slot] = bestSwap;
          currentScore = bestScore;
          improved = true;
        }
      }

      if (!improved) {
break;
}
    }

    addResult(current);
  }
}

// ── Phase 8: Meta-comp seeded ──────────────────────
// Use real meta compositions as exploration seeds.
// Not served as-is — algorithm builds from them like any other seed.

function phaseMetaCompSeeded({ graph, teamSize, startChamps, context, rng, maxResults, results, addResult, excludedSet }) {
  const { nodes } = graph;
  const { metaComps = [] } = graph.scoringCtx || {};

  if (metaComps.length === 0) {
return;
}

  const startSet = new Set(startChamps);

  for (const comp of metaComps) {
    // Skip comps that conflict with locked champions
    const compUnits = comp.units.filter(u => nodes[u] && !excludedSet.has(u));

    // Hard cut: if any meta comp unit is disallowed by level, skip entire comp.
    // Meta comps are cohesive archetypes — partial seeds would break their intent.
    if (context.allowedSet) {
      const hasDisallowed = compUnits.some(u => !context.allowedSet.has(u));

      if (hasDisallowed) {
continue;
}
    }

    // Check overlap: at least 1 locked champ must be in the meta comp (or no locks)
    const overlap = startChamps.length === 0 || startChamps.some(s => compUnits.includes(s));

    if (!overlap) {
continue;
}

    // Seed: locked champs + meta comp members (dedup)
    const seeds = [...new Set([...startChamps, ...compUnits])];
    addResult(buildOneTeam(graph, teamSize, seeds, context, 0.1 + rng() * 0.2, rng));
  }
}

// ── Phase 9: Five-cost heavy ───────────────────────
// Only runs when user explicitly raises max5Cost (≥4), signaling they want
// 5-cost spam compositions. Seeds with subsets of available 5-costs and lets
// buildOneTeam fill remaining slots via trait synergies.

function phaseFiveCostHeavy({ graph, teamSize, startChamps, context, rng, addResult, excludedSet }) {
  const { nodes } = graph;
  const { max5Cost, allowedSet } = context;

  if (max5Cost == null || max5Cost < 4) {
return;
}

  const fiveCosts = Object.keys(nodes).filter(api =>
    (nodes[api]?.cost || 0) === 5 &&
    !excludedSet.has(api) &&
    (!allowedSet || allowedSet.has(api)) &&
    !startChamps.includes(api)
  );

  if (fiveCosts.length < 2) {
return;
}

  const targetCount = Math.min(max5Cost, fiveCosts.length, teamSize - startChamps.length);

  if (targetCount < 2) {
return;
}

  // Several attempts with different random subsets of 5-costs as seeds.
  const attempts = 8;

  for (let i = 0; i < attempts; i++) {
    const shuffled = [...fiveCosts].sort(() => rng() - 0.5);
    const seeds = [...startChamps, ...shuffled.slice(0, targetCount)];
    addResult(buildOneTeam(graph, teamSize, seeds, context, 0.1 + rng() * 0.15, rng));
  }
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
  phaseLockedTraitSeeded(phaseCtx);
  const lockedTraitSeedKeys = new Set(results.keys());
  phaseTemperatureSweep(phaseCtx);
  phaseTraitSeeded(phaseCtx);
  phaseDeepVertical(phaseCtx);
  phasePairSynergy(phaseCtx);
  phaseCompanionSeeded(phaseCtx);
  phaseMetaCompSeeded(phaseCtx);
  phaseFiveCostHeavy(phaseCtx);
  phaseCrossover(phaseCtx);
  phaseHillClimb(phaseCtx);

  const diverse = diversifyResults(results, maxResults, traitBreakpoints, emblems);

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
}
