// resources/js/workers/scout/synergy-graph/phases/companion-seeded.ts

// @ts-nocheck

import { SCORING_CONFIG } from '../../config';
import { buildOneTeam } from '../shared/team-builder';
import {
  FILLER_COST_WEIGHTS,
  FILLER_PICK_DECAY,
  FILLER_TOP_K_PER_ANCHOR,
  FILLER_MAX_PICKS,
  FILLER_BOOTSTRAP_ANCHORS,
  FILLER_DEFAULT_FIVE_COST_CAP,
} from '../shared/const';
import type { PhaseContext } from '../types';

const { thresholds } = SCORING_CONFIG;

export function phaseCompanionSeeded(ctx: PhaseContext): void {
  const { graph, teamSize, startChamps, context, rng, addResult } = ctx;
  const picks = pickCompanionFillers(graph, context, startChamps);

  for (const filler of picks) {
    const seeds = [...startChamps, filler];

    addResult(buildOneTeam(graph, teamSize, seeds, context, 0.2 + rng() * 0.3, rng));
  }
}

// ── Companion filler ranker (Fix 1E) ───────────────
//
// Private helper — moved from synergy-graph.ts monolith in Task 14.
// Replaces the old "iterate every champion × every companion" seed
// loop with a deterministic, context-aware ranker:
//
//   1. Start from anchors (locked champs + tight-auto-promoted +
//      hero swap), or bootstrap from top-unitRating champs when the
//      anchor set is empty.
//   2. For each anchor, read its top companions from MetaTFT data,
//      weighted by the anchor's cost (TFT17 meta is 3/4-cost
//      centric — 5-costs are spike units, not anchors).
//   3. Aggregate scores into a per-candidate Map. Champions that
//      appear as top companions for multiple anchors accumulate
//      score naturally — no explicit cross-reference step needed.
//   4. Pick top M with a decay-on-pick loop so flex fillers like
//      Shen (who score top-1 because they're on every archetype's
//      companion list) surface once or twice, not thirty times.
//      A 5-cost throttle caps how many of the M picks can be a
//      5-cost filler so the phase doesn't burn its budget on
//      power-spike variants.
//   5. Fall back to unit-rating order if the cross-referenced
//      ranking runs out (e.g. very tight candidate pool) so the
//      phase always contributes enough raw teams for the engine's
//      topN guarantee to hold.

function pickCompanionFillers(graph, context, anchorApis) {
  const { nodes } = graph;
  const companionData = graph.scoringCtx?.companions || {};
  const unitRatings = graph.scoringCtx?.unitRatings || {};

  const anchorSet = new Set(anchorApis);
  const allowedSet = context.allowedSet;
  const excludedSet = new Set(context.excludedChampions || []);

  let effectiveAnchors = anchorApis;

  if (effectiveAnchors.length === 0) {
    const sorted = Object.keys(nodes)
      .filter(api => {
        const node = nodes[api];

        if (!node || node.variant === 'hero') {
          return false;
        }

        if (excludedSet.has(api)) {
          return false;
        }

        if (allowedSet && !allowedSet.has(api)) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        const ra = unitRatings[a]?.score ?? 0;
        const rb = unitRatings[b]?.score ?? 0;

        if (ra !== rb) {
          return rb - ra;
        }

        return a.localeCompare(b);
      });

    effectiveAnchors = sorted.slice(0, FILLER_BOOTSTRAP_ANCHORS);
  }

  const candidateScore = new Map();

  for (const anchorApi of effectiveAnchors) {
    const anchorNode = nodes[anchorApi];

    if (!anchorNode) {
      continue;
    }

    const weight = FILLER_COST_WEIGHTS[Math.max(0, Math.min(4, (anchorNode.cost || 1) - 1))];
    const lookupApi = anchorNode.baseApiName || anchorApi;
    const entries = companionData[lookupApi];

    if (!entries) {
      continue;
    }

    const top = [...entries]
      .filter(c => c.games >= thresholds.companionMinGames && c.avgPlace <= thresholds.companionMaxAvg)
      .sort((a, b) => a.avgPlace - b.avgPlace)
      .slice(0, FILLER_TOP_K_PER_ANCHOR);

    for (const comp of top) {
      const compApi = comp.companion;

      if (anchorSet.has(compApi)) {
        continue;
      }

      if (excludedSet.has(compApi)) {
        continue;
      }

      if (allowedSet && !allowedSet.has(compApi)) {
        continue;
      }

      if (!nodes[compApi]) {
        continue;
      }

      const contribution = weight * (1 - comp.avgPlace / 8);
      candidateScore.set(compApi, (candidateScore.get(compApi) || 0) + contribution);
    }
  }

  const fiveCostCap = Math.max(
    0,
    typeof context.max5Cost === 'number'
      ? Math.min(context.max5Cost, FILLER_DEFAULT_FIVE_COST_CAP)
      : FILLER_DEFAULT_FIVE_COST_CAP,
  );
  const picks = [];
  const pickedSet = new Set();
  let fiveCostPicks = 0;

  while (picks.length < FILLER_MAX_PICKS && candidateScore.size > 0) {
    let bestApi = null;
    let bestScore = -Infinity;

    for (const [api, score] of candidateScore) {
      if (score > bestScore) {
        bestScore = score;
        bestApi = api;
      }
    }

    if (bestApi === null) {
      break;
    }

    const bestNode = nodes[bestApi];
    const isFiveCost = (bestNode?.cost || 0) === 5;

    if (isFiveCost && fiveCostPicks >= fiveCostCap) {
      candidateScore.delete(bestApi);
      continue;
    }

    picks.push(bestApi);
    pickedSet.add(bestApi);

    if (isFiveCost) {
      fiveCostPicks++;
    }

    candidateScore.set(bestApi, bestScore * FILLER_PICK_DECAY);
  }

  if (picks.length < FILLER_MAX_PICKS) {
    const fallback = Object.keys(nodes)
      .filter(api => {
        if (pickedSet.has(api) || anchorSet.has(api)) {
          return false;
        }

        const node = nodes[api];

        if (!node || node.variant === 'hero') {
          return false;
        }

        if (excludedSet.has(api)) {
          return false;
        }

        if (allowedSet && !allowedSet.has(api)) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        const ra = unitRatings[a]?.score ?? 0;
        const rb = unitRatings[b]?.score ?? 0;

        if (ra !== rb) {
          return rb - ra;
        }

        return a.localeCompare(b);
      });

    let idx = 0;

    while (picks.length < FILLER_MAX_PICKS && idx < fallback.length) {
      const api = fallback[idx++];
      const node = nodes[api];
      const isFiveCost = (node?.cost || 0) === 5;

      if (isFiveCost && fiveCostPicks >= fiveCostCap) {
        continue;
      }

      picks.push(api);
      pickedSet.add(api);

      if (isFiveCost) {
        fiveCostPicks++;
      }
    }
  }

  return picks;
}
