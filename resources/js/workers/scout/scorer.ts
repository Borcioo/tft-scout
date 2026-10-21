/**
 * Scorer — pure scoring functions.
 *
 * NO imports from DB, fetch, or services.
 * All data passed as arguments via context objects.
 *
 * A team's score is its raw place (strength.ts) below the lobby average,
 * in hundredths: the board-strength model plus game-logic penalties in
 * the same unit — role balance and units beyond what the shop
 * realistically offers at the level (costPenalty, the same prior the
 * team-builder searches with, so search and ranking optimise one
 * objective). It ranks; the breakdown's avgPlace is the calibrated
 * placement estimate to show.
 */

import {
    activeLevels,
    boardStrength,
    estimatedAvgPlace,
    STRENGTH,
} from './strength';
import { costPenalty } from './synergy-graph/shared/cost-penalty';

// H* = hybrid damage. Riot ships HFighter; the HCarry / HCaster / HTank
// shapes come from our own role inference (Set 18 has no roles in data,
// see RoleInferenceHook) when an ability splits physical/magic evenly.
const ROLE_CATEGORY = {
    ADCarry: 'dps',
    APCarry: 'dps',
    ADCaster: 'dps',
    APCaster: 'dps',
    ADReaper: 'dps',
    APReaper: 'dps',
    ADSpecialist: 'dps',
    HCarry: 'dps',
    HCaster: 'dps',
    ADTank: 'frontline',
    APTank: 'frontline',
    HTank: 'frontline',
    ADFighter: 'fighter',
    APFighter: 'fighter',
    HFighter: 'fighter',
};

/**
 * Count team roles. Fighters count as 0.5 frontline + 0.5 dps
 * (they flex between both in TFT).
 */
export function teamRoleBalance(champions: any) {
    let frontline = 0,
        dps = 0,
        fighter = 0;

    for (const c of champions) {
        const cat = (ROLE_CATEGORY as any)[c.role] || 'fighter';

        if (cat === 'frontline') {
            frontline++;
        } else if (cat === 'dps') {
            dps++;
        } else {
            fighter++;
        }
    }

    return {
        frontline,
        dps,
        fighter,
        effectiveFrontline: frontline + fighter * 0.5,
        effectiveDps: dps + fighter * 0.5,
    };
}

/**
 * Soft penalty for unbalanced teams.
 * Based on meta analysis: avg 3.3 frontline, 3.1 dps, 1.9 fighter.
 * 0 frontline or 0 dps never appears in winning comps.
 * Fighters are flex — they compensate for missing roles.
 */
export function roleBalancePenalty(champions: any) {
    const { effectiveFrontline, effectiveDps } = teamRoleBalance(champions);
    const teamSize = champions.length;

    if (teamSize === 0) {
        return 0;
    }

    let penalty = 0;

    // No frontline at all = heavy penalty (never works in meta). Set 18
    // check (MetaTFT ranked, 60 meta comps): minimum effective frontline
    // is 2, so 0 has to sink a comp outright and < 2 still costs. At 15
    // a 0-frontline board of strong ranged units topped the level 8 slate.
    if (effectiveFrontline < 1) {
        penalty += 30;
    } else if (effectiveFrontline < 2 || effectiveFrontline / teamSize < 0.2) {
        penalty += 10;
    }

    // No DPS at all = heavy penalty
    if (effectiveDps < 1) {
        penalty += 15;
    } else if (effectiveDps / teamSize < 0.15) {
        // Less than ~20% DPS = soft penalty
        penalty += 5;
    }

    return penalty;
}

// ── Team scoring ────────────────────────────────

type ScoredBoard = {
    champions: any[];
    activeTraits: any[];
    level?: number;
    /** Locked apiNames — exempt from the cost cap, as in the search. */
    locked?: Set<string> | null;
    /**
     * Units the player locked by hand: they weigh more in the ranking
     * (strength.ts, "Focus"); the breakdown stays the board's own.
     */
    focus?: ReadonlySet<string> | null;
    max5Cost?: number | null;
};

/** Places charged per trait count past a trait's last breakpoint. */
export const OVERFLOW_PER_UNIT = 0.15;

/**
 * Trait counts past the last breakpoint add nothing — Solar has one
 * breakpoint at 3, so a Lux Sunbeam (Solar ×2) on a board that already
 * has it wastes both counts. Top players run 3 Solar on 644 of 647 Solar
 * boards. In places, like the role penalty; search and ranking share it.
 */
export function overflowPenalty(
    counts: Record<string, number>,
    minUnitsOf: (trait: string) => number[],
): number {
    let wasted = 0;

    for (const [trait, count] of Object.entries(counts)) {
        const mins = minUnitsOf(trait);

        if (mins.length > 0) {
            wasted += Math.max(0, count - Math.max(...mins));
        }
    }

    return wasted * OVERFLOW_PER_UNIT;
}

function evaluate(team: ScoredBoard, ctx: any) {
    const counts: Record<string, number> = {};
    const breakpointsOf: Record<string, any[]> = {};

    for (const t of team.activeTraits) {
        counts[t.apiName] = t.count;
        breakpointsOf[t.apiName] = t.breakpoints ?? [];
    }

    const strength = boardStrength(
        team.champions,
        activeLevels(counts, (t) => breakpointsOf[t]),
        ctx,
        team.focus,
    );
    const roles = roleBalancePenalty(team.champions) / 100;
    const nodes = Object.fromEntries(
        team.champions.map((c: any) => [c.apiName, c]),
    );
    const cost =
        costPenalty(
            team.champions.map((c: any) => c.apiName),
            { nodes } as any,
            team.level ?? 8,
            team.locked ?? null,
            team.max5Cost ?? null,
        ) / 100;

    const overflow = overflowPenalty(counts, (t) =>
        breakpointsOf[t].map((b) => b.minUnits),
    );

    const penalties = roles + cost + overflow;

    return {
        strength,
        roles,
        cost,
        overflow,
        place: strength.place + penalties,
        focused: strength.focused + penalties,
    };
}

const toScore = (place: number) =>
    Math.round((STRENGTH.baseline - place) * 10000) / 100;

/** What the search and the slate rank by — focused on locked units. */
export function teamScore(team: ScoredBoard, ctx: any) {
    return toScore(evaluate(team, ctx).focused);
}

/**
 * Same evaluation, itemised: raw place and each part in places (positive
 * = worse), the calibrated average placement, and the resulting score —
 * of the board itself, without focus, so saved plans compare with it.
 */
export function teamScoreBreakdown(team: ScoredBoard, ctx: any) {
    const { strength, roles, cost, overflow, place } = evaluate(team, ctx);
    const r = (x: number) => Math.round(x * 1000) / 1000;
    const avgPlace = estimatedAvgPlace(place, team.champions.length);

    return {
        avgPlace: Math.round(avgPlace * 100) / 100,
        // Rated above every board people played: avgPlace is the cap
        beyondData: avgPlace === STRENGTH.calibration.floor ? 1 : 0,
        place: r(place),
        units: r(strength.units),
        pairs: r(strength.pairs),
        traits: r(strength.traits),
        roles: r(roles),
        cost: r(cost),
        overflow: r(overflow),
        total: toScore(place),
    } as Record<string, number>;
}

/** The board's reroll plan (strength.ts): units to roll to 3★, hit chance. */
export function teamReroll(team: ScoredBoard, ctx: any) {
    return evaluate(team, ctx).strength.reroll;
}
