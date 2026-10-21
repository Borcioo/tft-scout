/**
 * Scout configuration — search and result thresholds.
 *
 * Team scoring itself lives in strength.ts (board strength from MetaTFT
 * stats) and scorer.ts (role balance, cost cap); these values steer
 * which candidates the phases explore and how results are deduped.
 */

/**
 * Score scale version, saved with plans. A score from another model isn't
 * comparable with a live one (6 = rare pair and frontline penalties; 5 =
 * Emerald+ MetaTFT sample and the dead unit penalty; 4 = reroll plans of up to five 3★ and the trait overflow
 * penalty; 3 = units rated at 1–2★ plus reroll plans of one cost; 2 =
 * board-strength model over all stars; 1 = the old points scorer).
 */
export const SCORE_MODEL = 6;

export const SCORING_CONFIG = {
    // Dedupe threshold for engine topN — team is dropped if it shares
    // >= dedupeOverlapPct champions with an already-accepted higher-score team.
    // 0.75 = 6/8 shared → duplicate. 1.0 = disabled.
    dedupeOverlapPct: 0.75,
    // Variety (slate.ts): at most perFamily teams of one family — sharing
    // at least familyOverlapPct of their unlocked units (half). Distinct
    // MetaTFT comps (18.4b) share a median 63% with their nearest
    // neighbour, a quarter of them half or less; without the cap a level 8
    // slate put the same Soraka/Azir/Kayle/Leona core in 6 of 8 teams.
    // Filled up without it when the pool runs out.
    familyOverlapPct: 0.5,
    perFamily: 2,
    // ...and at most perLabel teams named by one trait (the card title's
    // two traits). Families compare units, so on level 9 three Solar
    // boards with different units still opened the slate. Traits of
    // locked units and locked traits are exempt — the player asked for
    // them on every team.
    perLabel: 2,
    // ...and one unit in at most half of it (locked units aside): Kayle,
    // a strong 3★ plan next to most comps, was on 15 of 20 level 8–9
    // teams — a slate is a menu, and one contested unit sank all of it
    perUnitShare: 0.5,

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
