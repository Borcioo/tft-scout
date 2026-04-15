// resources/js/workers/scout/synergy-graph/phases/meta-comp-seeded.ts

// @ts-nocheck

import { buildOneTeam } from '../shared/team-builder';
import type { PhaseContext } from '../types';

export function phaseMetaCompSeeded(ctx: PhaseContext): void {
  const { graph, teamSize, startChamps, context, rng, maxResults, results, addResult, excludedSet } = ctx;
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
