/**
 * Scout configuration — search and result thresholds.
 *
 * Team scoring itself lives in strength.ts (board strength from MetaTFT
 * stats) and scorer.ts (role balance, cost cap); these values steer
 * which candidates the phases explore and how results are deduped.
 */

/**
 * Score scale version, saved with plans. A score from another model isn't
 * comparable with a live one (2 = board-strength model, hundredths of a
 * raw place; 1 = the old points scorer).
 */
export const SCORE_MODEL = 2;

export const SCORING_CONFIG = {
    // Dedupe threshold for engine topN — team is dropped if it shares
    // >= dedupeOverlapPct champions with an already-accepted higher-score team.
    // 0.75 = 6/8 shared → duplicate. 1.0 = disabled.
    dedupeOverlapPct: 0.75,

    // Exploration thresholds — controls which data phases consider "viable"
    thresholds: {
        deepVerticalMaxAvg: 4.75, // Phase 3: force breakpoints with avg placement up to this
        pairSynergyMaxAvg: 4.75, // Phase 4: traits considered "strong" for pair combinations
        companionMaxAvg: 5.0, // Phase 5: companion seeds — pairs with avg up to this
        companionMinGames: 50, // min games for companion data to be trusted
        affinityMinGames: 10, // min games for affinity data to be trusted
        phaseMinGames: 30, // min games for Phase 3/4 trait evaluation
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
