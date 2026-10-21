// @ts-nocheck
//
// costPenalty — soft cap on units per cost tier from shop odds at the
// player's level. Used by the team-builder phases and, so both agree, by
// scorer.teamScore. Own module so the scorer can import it without
// pulling the team-builder (and its quickScore import) in a cycle.

import type { Graph } from '../types';

// ── Shop odds / cost penalty ────────────────────

const SHOP_ODDS = {
    1: [1.0, 0, 0, 0, 0],
    2: [1.0, 0, 0, 0, 0],
    3: [0.75, 0.25, 0, 0, 0],
    4: [0.55, 0.3, 0.15, 0, 0],
    5: [0.45, 0.33, 0.2, 0.02, 0],
    6: [0.3, 0.4, 0.25, 0.05, 0],
    7: [0.19, 0.3, 0.4, 0.1, 0.01],
    8: [0.15, 0.2, 0.32, 0.3, 0.03],
    9: [0.1, 0.17, 0.25, 0.33, 0.15],
    10: [0.05, 0.1, 0.2, 0.4, 0.25],
};

export function costPenalty(
    champApis: string[],
    graph: Graph,
    level: number,
    lockedSet: Set<string> | null = null,
    max5Cost: number | null = null,
) {
    if (!level) {
        return 0;
    }

    const odds = SHOP_ODDS[level] || SHOP_ODDS[8];
    // Locked champions are a pure bonus — they don't consume budget and don't
    // count toward cost limits. Limits are still computed from the full team size
    // so non-locked slots have the normal budget of a fielded team.
    const teamSize = champApis.length;

    if (teamSize === 0) {
        return 0;
    }

    const limits = odds.map((o) => {
        if (o === 0) {
            return 0;
        }

        if (o <= 0.05) {
            return 1;
        }

        if (o <= 0.15) {
            return 2;
        }

        return Math.ceil(o * teamSize) + 1;
    });

    // User's explicit max5Cost raises the 5-cost soft cap — they signaled they
    // want 5-cost heavy teams, so don't penalize them up to their chosen limit.
    if (max5Cost != null && max5Cost > limits[4]) {
        limits[4] = max5Cost;
    }

    const costCounts = [0, 0, 0, 0, 0];

    for (const api of champApis) {
        if (lockedSet?.has(api)) {
            continue;
        }

        const cost = graph.nodes[api]?.cost || 3;

        if (cost >= 1 && cost <= 5) {
            costCounts[cost - 1]++;
        }
    }

    let penalty = 0;

    for (let i = 0; i < 5; i++) {
        const excess = costCounts[i] - limits[i];

        if (excess > 0) {
            penalty += excess * 12;
        }
    }

    return penalty;
}
