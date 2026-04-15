// resources/js/workers/scout/synergy-graph/shared/team-builder.ts
//
// buildOneTeam — core team-building primitive called by every phase.
// Takes a seed (anchor champions) + the graph and greedily assembles
// a valid team around it using quickScore + cost penalty + weighted
// candidate selection. Pure — no profiler spans, no side effects
// beyond the returned team object.
//
// Also contains costPenalty (co-located because buildOneTeam is the
// primary caller; re-exported from the monolith for the two callers
// that remain there). SHOP_ODDS is a private const of costPenalty.
//
// Private helpers moved with buildOneTeam: weightedPick.
// Helpers staying in monolith because they're shared: none additional
// (costPenalty is re-exported from monolith for other callers).

// @ts-nocheck

import { quickScore } from '../quick-score';
import type { Graph } from '../types';

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

export function costPenalty(champApis, graph: Graph, level, lockedSet = null, max5Cost = null) {
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

// ── Private helper of buildOneTeam ─────────────

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

export function buildOneTeam(graph: Graph, teamSize, startChamps, context, temperature, rng) {
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
