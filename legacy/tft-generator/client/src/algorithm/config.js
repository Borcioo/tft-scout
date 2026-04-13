/**
 * Scoring configuration — weights, multipliers, thresholds.
 *
 * Note: fallbackStyleScore is now in DB (trait_styles.fallbackScore).
 * The service layer loads it and passes it to the algorithm as styleScores.
 */

export const SCORING_CONFIG = {
  weights: {
    traitRating:     15.0,
    unitRating:      10.0,
    championPower:    3.0,  // fallback when no MetaTFT data
    uniqueTrait:     12.0,
    synergyBonus:     5.0,  // bonus per trait at 2nd+ breakpoint
    overflowPenalty:  5.0,  // penalty per wasted unit above breakpoint
    affinityBonus:    3.0,  // bonus when champion-trait combo confirmed by affinity data
    orphanPenalty:   20.0,  // penalty for champion with zero active/shared non-unique traits
  },

  // Multiplier per breakpoint level (0-indexed)
  breakpointMultiplier: [1.0, 1.3, 1.8, 2.5],

  nearBreakpointBonus: 2.0,

  minGamesForReliable: 50,

  // Exploration thresholds — controls which data phases consider "viable"
  thresholds: {
    deepVerticalMaxAvg:   4.75,  // Phase 3: force breakpoints with avg placement up to this
    pairSynergyMaxAvg:    4.75,  // Phase 4: traits considered "strong" for pair combinations
    companionMaxAvg:      5.0,   // Phase 5: companion seeds — pairs with avg up to this
    companionMinGames:    50,    // min games for companion data to be trusted
    affinityMinGames:     10,    // min games for affinity data to be trusted
    phaseMinGames:        30,    // min games for Phase 3/4 trait evaluation
  },

  // Star power per cost at each player level (fallback when no MetaTFT unit rating)
  expectedStarPower: {
    5:  [2.5, 1.8, 1.0, 1.0, 1.0],
    6:  [2.5, 1.8, 1.4, 1.0, 1.0],
    7:  [3.0, 1.8, 1.8, 1.0, 1.0],
    8:  [3.0, 2.5, 1.8, 1.4, 1.0],
    9:  [3.0, 3.0, 2.5, 1.8, 1.4],
    10: [3.0, 3.0, 3.0, 2.5, 1.8],
  },
};

/**
 * Minimalny poziom gracza dla każdego kosztu championa.
 * Progi oparte na SHOP_ODDS — champion jest dozwolony gdy realna
 * szansa na zaciągnięcie w sklepie wynosi ≥10%.
 *
 * 1-cost: zawsze (baseline)
 * 2-cost: lvl 3+ (25% odds)
 * 3-cost: lvl 4+ (15% odds)
 * 4-cost: lvl 7+ (10% odds)
 * 5-cost: lvl 9+ (15% odds)
 */
export const MIN_LEVEL_BY_COST = {
  1: 1,
  2: 3,
  3: 4,
  4: 7,
  5: 9,
};
