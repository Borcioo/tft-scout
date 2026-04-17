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
    fillerPenalty:   10.0,  // penalty for "filler" champion — one whose removal wouldn't drop any active breakpoint
  } as const,

  // Multiplier per breakpoint level (0-indexed)
  breakpointMultiplier: [1.0, 1.3, 1.8, 2.5] as const,

  // BreakEven score per activeIdx (0=Bronze ... 3=Prismatic). Bronze set
  // to 0.45 (was 0.25) so mediocre Bronze traits with avgPlace ≥ ~4.5
  // contribute ~0 pkt instead of inflating wide comps. Silver/Gold/Prismatic
  // unchanged (proven meta values).
  breakEvenByTier: [0.45, 0.40, 0.40, 0.20] as const,

  nearBreakpointBonus: 2.0,

  // Diminishing-returns multiplier applied to Bronze trait scores after
  // sorting desc. k-th Bronze score (0-indexed) is multiplied by
  // bronzeStackFactor ** k. 1.0 = disabled (full stacking). 0.6 = default.
  bronzeStackFactor: 0.6,

  // Non-linear trait reward formula — (neutralAvg - rating.avgPlace)^exponent * weight * bpMult
  // Captures the exponential nature of TFT placement: avgPlace 3.13 is
  // not "22% better than 4.0", it's a radically different tier.
  // Trait with avg >= neutralAvg contributes 0 pkt (no reward).
  // Linear fallback (score-based) kicks in only when rating missing.
  traitReward: {
    neutralAvg: 4.5,
    exponent: 1.8,
    weight: 15,
  },

  // Proven bonus — per-trait bonus when a breakpoint has exceptional
  // real-world results. Rewards comps where multiple traits align on
  // strong meta data, without hardcoding any specific comp.
  // - Linear portion: (maxAvg - avg) * weight for all traits under maxAvg
  // - Quadratic portion: (expThresh - avg)^2 * weight * quadMult when avg < expThresh
  //   Captures "meta-defining" traits (SummonTrait:3 avg 3.13 is a tier higher
  //   than Silver traits at avg 3.7-4.0 — quadratic reflects this).
  provenBonus: {
    maxAvgPlace: 4.3,
    weight: 20,
    exponentialThreshold: 3.5,  // widened from 3.0 — meta-defining starts here
    quadMult: 3,                // up from 2 — stronger boost for god-tier traits
    minGames: 30,
  },

  // Per-trait contribution cap — total pts from a single trait (traitScore
  // + provenBonus + synergy) never exceed this. Prevents the 6-Vanguard
  // family from piling ~62 pts in one trait while nuancée comps spread
  // points across many smaller traits. Empirically: Vanguard:6 Gold with
  // avgPlace 3.32 hits ~62 pre-cap, SummonTrait:3 avg 3.13 would hit ~83.
  // Cap at 45 levels both down while keeping them comfortably above
  // Bronze-stacked spread comps (which naturally sum to 20-30 per trait).
  maxTraitContribution: 45,

  // Dedupe threshold for engine topN — team is dropped if it shares
  // >= dedupeOverlapPct champions with an already-accepted higher-score team.
  // 0.75 = 6/8 shared → duplicate. 1.0 = disabled.
  dedupeOverlapPct: 0.75,

  minGamesForReliable: 50,

  // Exploration thresholds — controls which data phases consider "viable"
  thresholds: {
    deepVerticalMaxAvg:   4.75,  // Phase 3: force breakpoints with avg placement up to this
    pairSynergyMaxAvg:    4.75,  // Phase 4: traits considered "strong" for pair combinations
    companionMaxAvg:      5.0,   // Phase 5: companion seeds — pairs with avg up to this
    companionMinGames:    50,    // min games for companion data to be trusted
    affinityMinGames:     10,    // min games for affinity data to be trusted
    phaseMinGames:        30,    // min games for Phase 3/4 trait evaluation
  } as const,

  // Star power per cost at each player level (fallback when no MetaTFT unit rating)
  expectedStarPower: {
    5:  [2.5, 1.8, 1.0, 1.0, 1.0],
    6:  [2.5, 1.8, 1.4, 1.0, 1.0],
    7:  [3.0, 1.8, 1.8, 1.0, 1.0],
    8:  [3.0, 2.5, 1.8, 1.4, 1.0],
    9:  [3.0, 3.0, 2.5, 1.8, 1.4],
    10: [3.0, 3.0, 3.0, 2.5, 1.8],
  } as const,
} as const;

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
