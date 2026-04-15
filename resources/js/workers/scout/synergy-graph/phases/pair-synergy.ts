// resources/js/workers/scout/synergy-graph/phases/pair-synergy.ts

// @ts-nocheck

import { SCORING_CONFIG } from '../../config';
import { buildOneTeam } from '../shared/team-builder';
import type { PhaseContext } from '../types';

const { thresholds } = SCORING_CONFIG;

export function phasePairSynergy(ctx: PhaseContext): void {
  const { graph, teamSize, startChamps, context, rng, maxResults, results, addResult, excludedSet } = ctx;
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
