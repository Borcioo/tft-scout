// resources/js/workers/scout/synergy-graph/phases/deep-vertical.ts

// @ts-nocheck

import { SCORING_CONFIG } from '../../config';
import { buildOneTeam } from '../shared/team-builder';

const { thresholds } = SCORING_CONFIG;

export function phaseDeepVertical({ graph, teamSize, startChamps, context, rng, maxResults, results, addResult, excludedSet, excludedTraits, emblems }) {
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
