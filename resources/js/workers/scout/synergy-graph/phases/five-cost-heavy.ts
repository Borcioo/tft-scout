// resources/js/workers/scout/synergy-graph/phases/five-cost-heavy.ts
//
// Only runs when user explicitly raises max5Cost (≥4), signaling they want
// 5-cost spam compositions. Seeds with subsets of available 5-costs and lets
// buildOneTeam fill remaining slots via trait synergies.

// @ts-nocheck

import { buildOneTeam } from '../shared/team-builder';

export function phaseFiveCostHeavy({ graph, teamSize, startChamps, context, rng, addResult, excludedSet }) {
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
