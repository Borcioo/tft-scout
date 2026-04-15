// resources/js/workers/scout/synergy-graph/phases/crossover.ts
//
// Take top results, breed new teams by combining halves.
// Parent A contributes some members, parent B contributes others.
// Child inherits locked champs + mix of both parents' non-locked members.

// @ts-nocheck

import { buildOneTeam } from '../shared/team-builder';
import type { PhaseContext } from '../types';

export function phaseCrossover(ctx: PhaseContext): void {
  const { graph, teamSize, startChamps, context, rng, maxResults, results, addResult } = ctx;
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
