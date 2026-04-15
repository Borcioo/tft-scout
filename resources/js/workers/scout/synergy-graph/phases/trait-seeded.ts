// resources/js/workers/scout/synergy-graph/phases/trait-seeded.ts

// @ts-nocheck

import { buildOneTeam } from '../shared/team-builder';

export function phaseTraitSeeded({ graph, teamSize, startChamps, context, rng, maxResults, results, addResult, excludedSet, excludedTraits }) {
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
