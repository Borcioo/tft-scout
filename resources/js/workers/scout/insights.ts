// @ts-nocheck
/**
 * Insights — analyzes current game state and generates actionable tips.
 *
 * PURE — no DB, no fetch. All data passed as arguments.
 */

import { SCORING_CONFIG } from './config';

const { thresholds } = SCORING_CONFIG;

/**
 * Generate insights based on locked champions, emblems, and available data.
 *
 * @param {object} params
 * @param {object[]} params.champions - all champions
 * @param {object[]} params.traits - all traits with breakpoints
 * @param {string[]} params.lockedChampions - locked champion apiNames
 * @param {string[]} params.emblems - emblem trait apiNames
 * @param {number} params.level - current player level
 * @param {object} params.scoringCtx - { traitRatings }
 * @returns {object[]} - array of insight objects
 */
export function generateInsights({ champions, traits, lockedChampions = [], emblems = [], level = 8, scoringCtx = {} }) {
  const insights = [];
  const { traitRatings = {} } = scoringCtx;

  // Build trait lookup
  const traitMap = {};
  for (const t of traits) traitMap[t.apiName] = t;

  // Build champion trait membership
  const champsByTrait = {};
  for (const c of champions) {
    for (const t of c.traits) {
      (champsByTrait[t] ??= []).push(c);
    }
  }

  // Group emblems by trait
  const emblemsByTrait = {};
  for (const e of emblems) emblemsByTrait[e] = (emblemsByTrait[e] || 0) + 1;

  // Locked champions' traits
  const lockedSet = new Set(lockedChampions);
  const lockedChampObjects = champions.filter(c => lockedSet.has(c.apiName));

  // ── Emblem opportunity insights ──────────────────
  for (const [traitApi, emblemCount] of Object.entries(emblemsByTrait)) {
    const trait = traitMap[traitApi];
    if (!trait) continue;

    const members = champsByTrait[traitApi] || [];
    const bps = [...(trait.breakpoints || [])].sort((a, b) => a.minUnits - b.minUnits);
    if (bps.length === 0) continue;

    const lockedInTrait = lockedChampObjects.filter(c => c.traits.includes(traitApi)).length;

    // Check each breakpoint from highest down
    for (let i = bps.length - 1; i >= 0; i--) {
      const bp = bps[i];
      const champsNeeded = bp.minUnits - emblemCount;
      if (champsNeeded < 0) continue;
      if (champsNeeded > members.length) continue;

      // Each emblem needs a non-trait champion to hold it
      // Min team size = champsNeeded (trait) + emblemCount (holders)
      // But some holders might overlap with trait members... safe estimate:
      const minTeamSize = Math.max(champsNeeded + emblemCount, champsNeeded + 1);
      const minLevel = Math.max(Math.min(minTeamSize, 10), 5);

      const bpPosition = i + 1;
      const rating = traitRatings[traitApi]?.[bpPosition];

      // Only show if data exists
      if (!rating || rating.games < thresholds.phaseMinGames) continue;

      const alreadyHave = lockedInTrait + emblemCount;
      const stillNeed = Math.max(0, champsNeeded - lockedInTrait);

      insights.push({
        type: 'emblem_opportunity',
        priority: rating.avgPlace < 3.0 ? 'high' : rating.avgPlace < 4.0 ? 'medium' : 'low',
        trait: { apiName: traitApi, name: trait.name, icon: trait.icon },
        breakpoint: bp.minUnits,
        style: bp.style,
        avgPlace: rating.avgPlace,
        games: rating.games,
        minLevel,
        champsNeeded,
        alreadyHave,
        stillNeed,
        emblemCount,
      });

      // Only show the highest achievable breakpoint per trait
      break;
    }
  }

  // ── Vertical potential from locked champions ─────
  // If user locked 3+ of the same trait, hint at going deeper
  const lockedTraitCounts = {};
  for (const c of lockedChampObjects) {
    for (const t of c.traits) lockedTraitCounts[t] = (lockedTraitCounts[t] || 0) + 1;
  }

  for (const [traitApi, count] of Object.entries(lockedTraitCounts)) {
    if (count < 3) continue;
    if (emblemsByTrait[traitApi]) continue; // already covered by emblem insight

    const trait = traitMap[traitApi];
    if (!trait) continue;
    const bps = [...(trait.breakpoints || [])].sort((a, b) => a.minUnits - b.minUnits);
    const members = champsByTrait[traitApi] || [];

    // Find next breakpoint above current count
    const nextBp = bps.find(bp => bp.minUnits > count);
    if (!nextBp) continue;

    const bpIdx = bps.indexOf(nextBp);
    const rating = traitRatings[traitApi]?.[bpIdx + 1];
    if (!rating || rating.games < thresholds.phaseMinGames) continue;
    if (rating.avgPlace > thresholds.deepVerticalMaxAvg) continue;

    const stillNeed = nextBp.minUnits - count;
    const available = members.filter(m => !lockedSet.has(m.apiName)).length;
    if (available < stillNeed) continue;

    insights.push({
      type: 'vertical_potential',
      priority: rating.avgPlace < 3.5 ? 'high' : 'medium',
      trait: { apiName: traitApi, name: trait.name, icon: trait.icon },
      breakpoint: nextBp.minUnits,
      style: nextBp.style,
      avgPlace: rating.avgPlace,
      games: rating.games,
      currentCount: count,
      stillNeed,
      minLevel: Math.max(nextBp.minUnits, level),
    });
  }

  // Sort: high priority first, then by avgPlace
  insights.sort((a, b) => {
    const prio = { high: 0, medium: 1, low: 2 };
    return (prio[a.priority] - prio[b.priority]) || (a.avgPlace - b.avgPlace);
  });

  return insights;
}
