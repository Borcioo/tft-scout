/**
 * Insights configuration — thresholds for team-insights.ts triggers.
 *
 * Single source of truth for every number a rule in team-insights.ts
 * checks. Change a value, reload, re-run scout. See
 * docs/superpowers/specs/2026-04-14-scout-why-this-comp-design.md
 * for the reasoning behind each value and the ones marked for
 * empirical tuning.
 */

export const INSIGHTS_CONFIG = {
    metaMatch: {
        minOverlapPct: 0.7,
        maxAvgPlace: 4.2,
    },
    topCarry: {
        maxAvgPlace: 3.5,
        minGames: 200,
    },
    strongTrait: {
        maxAvgPlace: 3.8,
        minGames: 500,
    },
    affinityHit: {
        maxAvgPlace: 3.8,
        minGames: 100,
        topN: 3,
    },
    provenPair: {
        maxAvgPlace: 3.8,
        minGames: 150,
        topN: 3,
    },
    highBreakpoint: {
        maxAvgPlace: 4.0,
    },
    weakChampion: {
        minAvgPlace: 4.6,
        minGames: 200,
        minCost: 2,
    },
    lowBreakpoint: {
        minAvgPlace: 4.4,
    },
    unprovenTrait: {
        maxGames: 100,
    },
    noMetaMatch: {
        minOverlapPctIgnore: 0.4,
    },
} as const;
