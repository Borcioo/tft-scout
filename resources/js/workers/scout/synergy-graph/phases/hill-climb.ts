// resources/js/workers/scout/synergy-graph/phases/hill-climb.ts

// @ts-nocheck

import { quickScore } from '../quick-score';
import { costPenalty } from '../shared/team-builder';
import type { PhaseContext } from '../types';

export function phaseHillClimb(ctx: PhaseContext): void {
  const { graph, teamSize, startChamps, context, rng, results, addResult, excludedSet } = ctx;
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
