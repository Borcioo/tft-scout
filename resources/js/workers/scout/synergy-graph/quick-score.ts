// resources/js/workers/scout/synergy-graph/quick-score.ts
//
// quickScore — lightweight pre-filter scorer used during team
// seeding. Subset of the full scorer; intentional divergence from
// scorer.ts (different aggregation strategy for affinity so the
// pre-filter is fast and doesn't dominate budget).

// @ts-nocheck

import type { Graph } from './types';
import { SCORING_CONFIG } from '../config';
import { applyEmblems } from './shared/emblems';
import { collectAffinityMatches } from './shared/affinity';

const { weights, breakpointMultiplier, nearBreakpointBonus, minGamesForReliable, thresholds } = SCORING_CONFIG;

// ── Quick synergy scoring (for graph traversal) ─

export function quickScore(champApis, graph: Graph, emblems = []) {
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
    // NOTE: intentionally not using findActiveBreakpointIdx here —
    // traitBreakpoints stores raw number[] (minUnits values directly),
    // not {minUnits: number}[] objects. The helper expects the object form.
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
    const affMatches = collectAffinityMatches(
      { apiName: api, baseApiName: node.baseApiName },
      activeTraitApis,
      affinity,
      { affinityMinGames: thresholds.affinityMinGames },
      { affinityBonus: weights.affinityBonus },
    );

    if (affMatches.length > 0) {
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
