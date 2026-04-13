/**
 * Scout Service — orchestrates data + algorithm.
 *
 * This is the "automated player" — it does what a human does on MetaTFT:
 *   1. Check what works with locked champions (affinity)
 *   2. Find candidates that maximize synergies (graph)
 *   3. Score using real match data (ratings)
 *   4. Return ranked team compositions
 */

import { generate } from '../algorithm/engine.js';
import { generateInsights } from '../algorithm/insights.js';

export function createScoutService(championService, ratingsService) {

  return {
    /**
     * Generate team compositions for given constraints.
     *
     * @param {object} params
     * @param {string[]} params.lockedChampions
     * @param {string[]} params.excludedChampions
     * @param {Array<string|{apiName:string,minCount:number}>} params.lockedTraits
     * @param {string[]} params.excludedTraits
     * @param {string[]} params.emblems
     * @param {number} params.level - player level (5-10)
     * @param {number} params.topN - max results
     * @param {number|null} params.max5Cost
     * @param {number|null} params.roleBalance
     */
    async generateComps(params = {}) {
      const {
        lockedChampions = [],
        excludedChampions = [],
        lockedTraits = [],
        excludedTraits = [],
        emblems = [],
        level = 8,
        topN = 10,
        max5Cost = null,
        roleBalance = null,
        seed = 0,
      } = params;

      // Load static data
      const champions = championService.getAllChampions();
      const traits = championService.getAllTraits();
      const exclusionGroups = championService.getExclusionGroups();

      // Build scoring context with real MetaTFT data
      // Affinity fetched on-demand for locked champions
      const scoringCtx = await ratingsService.buildScoringContext(lockedChampions);

      // Run algorithm (pure, no side effects)
      const results = generate({
        champions,
        traits,
        scoringCtx,
        constraints: {
          lockedChampions,
          excludedChampions,
          lockedTraits,
          excludedTraits,
          emblems,
          max5Cost,
          roleBalance,
        },
        exclusionGroups,
        level,
        topN,
        seed,
      });

      const insights = generateInsights({
        champions, traits, lockedChampions, emblems, level, scoringCtx,
      });

      return { teams: results, insights };
    },

    /**
     * Generate "road to" variants — what a team could become at a higher level.
     * Tries different subsets of the base team as locks to explore transitions.
     */
    async generateRoadTo(params = {}) {
      const {
        baseTeam = [],
        emblems = [],
        excludedChampions = [],
        targetLevel = 10,
        topN = 5,
      } = params;

      const champions = championService.getAllChampions();
      const traits = championService.getAllTraits();
      const exclusionGroups = championService.getExclusionGroups();
      const scoringCtx = await ratingsService.buildScoringContext();

      const allResults = new Map();

      // Build cost lookup
      const costOf = (api) => champions.find(c => c.apiName === api)?.cost || 3;
      const byCost = [...baseTeam].sort((a, b) => costOf(a) - costOf(b));

      const subsets = new Set();
      const addSubset = (arr) => subsets.add(JSON.stringify([...arr].sort()));

      // Full team locked
      addSubset(baseTeam);

      // Drop each member one at a time (keep N-1)
      for (let i = 0; i < baseTeam.length; i++) {
        addSubset(baseTeam.filter((_, j) => j !== i));
      }

      // Drop cheapest member
      if (byCost.length >= 3) {
        addSubset(byCost.slice(1));
      }

      // Drop 2 cheapest
      if (byCost.length >= 4) {
        addSubset(byCost.slice(2));
      }

      for (const subsetJson of subsets) {
        const subset = JSON.parse(subsetJson);
        const results = generate({
          champions, traits, scoringCtx, exclusionGroups,
          constraints: {
            lockedChampions: subset,
            excludedChampions,
            lockedTraits: [],
            excludedTraits: [],
            emblems,
            max5Cost: null,
          },
          level: targetLevel,
          topN: 3,
          seed: Math.floor(Math.random() * 1000000),
        });

        for (const r of results) {
          const key = r.champions.map(c => c.apiName).sort().join(',');
          if (!allResults.has(key) || allResults.get(key).score < r.score) {
            allResults.set(key, r);
          }
        }
      }

      return [...allResults.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, topN);
    },

    /** Get data stats (cache, ratings, etc.) */
    async stats() {
      const champions = championService.getAllChampions();
      const ratingsStats = ratingsService.stats();
      return {
        champions: champions.length,
        variants: champions.filter(c => c.variant).length,
        ...ratingsStats,
      };
    },
  };
}
