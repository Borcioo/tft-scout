/**
 * Board strength — how well a board places, from MetaTFT stats.
 *
 * PURE. Every MetaTFT number is "average placement of boards that had X";
 * the model only combines them, it never compares a board with known
 * comps:
 *
 *   unit i      base_i   = avg place of boards with i (shrunk to 4.5)
 *   pair i,j    lift_ij  = avg place of i on boards with j − base_i
 *   trait level lift_ikb = avg place of i while trait k is at level b − base_i
 *   own trait   lift_ik0 = avg place of i while its own trait k is inactive
 *                          − base_i; not published, but the unit's total
 *                          minus its per-level rows gives it exactly
 *                          (Murkwolf without Ravager: 5.26 vs 4.27)
 *
 *   est_i  = base_i + PAIR_WEIGHT · mean_j lift_ij
 *          + TRAIT_WEIGHT · mean(lift_ikb for active levels, lift_ik0 for
 *                                own traits left inactive)
 *   board  = mean_i est_i   (a mean, so board size doesn't inflate it)
 *
 * Lifts are what separates good boards from bad among those people
 * actually play: on 60 MetaTFT meta comps (scout-cli eval) unit ratings
 * alone rank them at Spearman 0.20, pair lifts at weight 5 at 0.47 under
 * 10-fold cross-validation, while the previous points-based scorer sat at
 * 0.03. Trait-level lifts cost ~0.05 there but are what makes breakpoints,
 * emblems and Kha'Zix evolutions matter at all, so they stay in.
 *
 * Stars. A unit's base is its average over boards where it stood at 1–2★:
 * 3★ is ~1% of a 4-cost's games and wins almost every time — luck, not a
 * plan, and it shouldn't lift the unit for everyone. For 1–3 costs 3★ is
 * a plan (reroll): 25–37% of their games, worth 0.7–1.6 places, and what
 * top players do with units the masses play badly (Camille 5.55 overall,
 * 3.26 in the top 200's hands, 92% of it at 3★). A board may carry a
 * reroll plan — up to four 1-costs, three 2-costs and one 3-cost, five in
 * all on a board of cheap units and fewer the more 4/5-costs it carries
 * (STRENGTH.reroll) — each counted at
 *
 *   p·base3★ + (1 − p)·base≤2★,  p = share of the unit's 3-item games at 3★
 *
 * (how often players who carry it hit), keeping the plan only when it
 * beats the board at ≤2★. Pair and trait lifts are over all stars.
 *
 * Focus. Units the player locked count STRENGTH.focusWeight times in the
 * board mean (and their reroll gain likewise), so their pairs, traits and
 * 3★ plan decide the board: locked Akali gets Varus, Camille and Inferno
 * rather than a filler slot in the best board overall. `focused` ranks;
 * `place` stays the board's own estimate, the number to show and compare.
 *
 * The result is on the placement scale but is not a placement: the lifts
 * overlap (a pair's lift already holds the rest of its usual board), so
 * weight 5 spreads boards ~2× wider than real averages of played boards,
 * and a strong board can come out below 1. It ranks boards;
 * estimatedAvgPlace() turns it into a number to show.
 */

import { findActiveBreakpointIdx } from './synergy-graph/shared/breakpoints';
import { unscoredTraits } from './trait-amount';

export const STRENGTH = {
    /** Mean placement in an 8-player lobby. */
    baseline: 4.5,
    /** Pseudo-games pulling a unit's average towards the baseline. */
    unitPrior: 500,
    /** Pseudo-games pulling a lift towards 0. */
    liftPrior: 100,
    /**
     * Chosen by 10-fold cross-validation on meta comps; on 3.9k played
     * boards (scout-cli oracle) least squares puts pairs at 6.3× units,
     * within noise of 5.
     */
    pairWeight: 5,
    /**
     * Product requirement, see the header. Played boards put it at 1.4×
     * units; ranking which unit to add alone would pick 0.
     */
    traitWeight: 1,
    /**
     * Raw place → real average placement: least squares (games-weighted)
     * of 3.9k boards played ≥300 times in 18.4b (scout-cli oracle) on raw
     * place, one intercept per board size — at equal raw place a bigger
     * board places better, reaching level 9 being itself a sign of
     * winning. Linear across the whole range (top decile 2.39 predicted,
     * 2.41 real). Floor: the best real average of any of those boards;
     * the search reaches raw places no played board has (level 9 ~0.8 vs
     * 1.28), and the estimate doesn't extrapolate past what was seen.
     * Fitted with Emerald+ star-split ratings (units at 1–2★, reroll
     * plans under STRENGTH.reroll's caps) and the scorer's penalties
     * (trait overflow, dead units, rare pairs, frontline).
     * scout-cli eval prints the current fit; refit when it drifts.
     */
    calibration: {
        slope: 0.45,
        intercepts: { 7: 1.41, 8: 1.26, 9: 0.81 },
        floor: 1.5,
    },
    /**
     * Reroll plan caps, from the top 200's boards (18.4): per cost (1-costs
     * are the cheapest to 3★, one 3-cost at most); in total by the number
     * of 4/5-costs on the board (0 → 4.9 3★ on average, 2 → 2.8, 4+ →
     * 0.3); and on boards of 9+ units (level 9: 90% have at most 3).
     */
    reroll: {
        perCost: { 1: 4, 2: 3, 3: 1 } as Record<number, number>,
        byExpensive: [5, 5, 4, 3, 1],
        bySize: { 9: 3, 10: 2 } as Record<number, number>,
    },
    /** Pseudo-games pulling a unit's hit chance towards 1/2. */
    hitPrior: 200,
    /** Weight of a locked unit in the board mean (see the header). */
    focusWeight: 3,
} as const;

/**
 * Display estimate of a board's average placement, from its raw place
 * and size: the player's level where known — an 8-unit board with Elder
 * Dragon (2 slots) is a level 9 board — else the units on the board (the
 * fit's own measure: explorer boards carry no level).
 */
export function estimatedAvgPlace(rawPlace: number, size: number): number {
    const { slope, intercepts, floor } = STRENGTH.calibration;
    const intercept = intercepts[Math.min(9, Math.max(7, size)) as 7 | 8 | 9];

    return Math.min(8, Math.max(floor, intercept + slope * rawPlace));
}

type UnitStat = { avgPlace: number; games: number };
type StarStat = UnitStat & { carryGames?: number };
// Nested by unit: scoring runs ~10⁵ times per search, and string keys per
// pair were most of its cost
type Index = {
    unitAvg: Map<string, number>;
    /** At 1–2★ when star data exists, else over all stars. */
    unitBase: Map<string, number>;
    /** At 3★ (1–3 costs use it in reroll plans). */
    unitBase3: Map<string, number>;
    /** Share of the unit's 3-item games played at 3★. */
    hitChance: Map<string, number>;
    /** unit → companion → lift */
    pairLift: Map<string, Map<string, number>>;
    /** unit → trait → lift by breakpoint position */
    traitLift: Map<string, Map<string, number[]>>;
    /** unit → own trait → lift while that trait is inactive */
    inactiveLift: Map<string, Map<string, number>>;
};

const shrink = (avg: number, games: number, prior: number, k: number) =>
    (games * avg + k * prior) / (games + k);

const indexCache = new WeakMap<object, Index>();

/** Precomputed lookups, built once per scoring context. */
function indexFor(ctx: any): Index {
    const cached = indexCache.get(ctx);

    if (cached) {
        return cached;
    }

    const unitAvg = new Map<string, number>();
    const unitBase = new Map<string, number>();
    const unitBase3 = new Map<string, number>();
    const hitChance = new Map<string, number>();

    for (const [api, r] of Object.entries<
        UnitStat & { stars?: Record<string, StarStat> }
    >(ctx.unitRatings ?? {})) {
        unitAvg.set(api, r.avgPlace);
        const all = shrink(
            r.avgPlace,
            r.games,
            STRENGTH.baseline,
            STRENGTH.unitPrior,
        );
        const low = [r.stars?.['1'], r.stars?.['2']].filter(
            (x): x is StarStat => x !== undefined,
        );
        const lowGames = low.reduce((s, x) => s + x.games, 0);

        if (lowGames === 0) {
            unitBase.set(api, all);
            continue;
        }

        const base2 = shrink(
            low.reduce((s, x) => s + x.avgPlace * x.games, 0) / lowGames,
            lowGames,
            all,
            STRENGTH.unitPrior,
        );
        unitBase.set(api, base2);

        const s3 = r.stars?.['3'];

        if (s3?.games) {
            unitBase3.set(
                api,
                shrink(s3.avgPlace, s3.games, base2, STRENGTH.unitPrior),
            );

            const carry = low.reduce((s, x) => s + (x.carryGames ?? 0), 0);
            const hit = s3.carryGames ?? 0;
            hitChance.set(
                api,
                shrink(
                    hit / Math.max(hit + carry, 1),
                    hit + carry,
                    0.5,
                    STRENGTH.hitPrior,
                ),
            );
        }
    }

    const lift = (unit: string, stat: UnitStat) =>
        shrink(
            stat.avgPlace - (unitAvg.get(unit) ?? STRENGTH.baseline),
            stat.games,
            0,
            STRENGTH.liftPrior,
        );

    const pairLift = new Map<string, Map<string, number>>();

    for (const [unit, list] of Object.entries<any[]>(ctx.companions ?? {})) {
        const byCompanion = new Map<string, number>();

        for (const p of list ?? []) {
            byCompanion.set(p.companion, lift(unit, p));
        }

        pairLift.set(unit, byCompanion);
    }

    const traitLift = new Map<string, Map<string, number[]>>();
    const inactiveLift = new Map<string, Map<string, number>>();

    for (const [unit, list] of Object.entries<any[]>(ctx.affinity ?? {})) {
        const activeByTrait = new Map<string, { games: number; sum: number }>();
        const byTrait = new Map<string, number[]>();
        traitLift.set(unit, byTrait);

        for (const a of list ?? []) {
            const levels = byTrait.get(a.trait) ?? [];
            levels[a.breakpoint] = lift(unit, a);
            byTrait.set(a.trait, levels);

            const acc = activeByTrait.get(a.trait) ?? { games: 0, sum: 0 };
            acc.games += a.games;
            acc.sum += a.avgPlace * a.games;
            activeByTrait.set(a.trait, acc);
        }

        // Boards where the trait was at no level = the unit's total minus
        // every per-level row of that trait
        const total = ctx.unitRatings?.[unit];

        if (!total) {
            continue;
        }

        const inactive = new Map<string, number>();
        inactiveLift.set(unit, inactive);

        for (const [trait, acc] of activeByTrait) {
            const games = total.games - acc.games;

            if (games > 0) {
                const avgPlace =
                    (total.avgPlace * total.games - acc.sum) / games;
                inactive.set(trait, lift(unit, { avgPlace, games }));
            }
        }
    }

    const index = {
        unitAvg,
        unitBase,
        unitBase3,
        hitChance,
        pairLift,
        traitLift,
        inactiveLift,
    };
    indexCache.set(ctx, index);

    return index;
}

export type ActiveLevel = { trait: string; position: number };

/**
 * Active trait levels in MetaTFT's terms (breakpoint position). Among
 * breakpoints sharing a unit count the first wins: Set 18 Rival lists
 * [1, 1, 2], and the plain one-Rival state is position 1 (800k games),
 * not the 2.7k-game position 2 the last match would pick.
 */
export function activeLevels(
    counts: Record<string, number>,
    breakpointsOf: (trait: string) => { minUnits: number; position?: number }[],
): ActiveLevel[] {
    const out: ActiveLevel[] = [];

    for (const [trait, count] of Object.entries(counts)) {
        const sorted = [...breakpointsOf(trait)].sort(
            (a, b) => a.minUnits - b.minUnits,
        );
        let idx = findActiveBreakpointIdx(count, sorted);

        if (idx < 0) {
            continue;
        }

        while (idx > 0 && sorted[idx - 1].minUnits === sorted[idx].minUnits) {
            idx--;
        }

        out.push({ trait, position: sorted[idx].position ?? idx + 1 });
    }

    return out;
}

export type StrengthChampion = {
    apiName: string;
    baseApiName?: string | null;
    cost?: number;
    traits?: string[];
    unscoredTraits?: string[] | null;
};

export type Strength = {
    /** Raw place, lower is better (see the header on its scale). */
    place: number;
    /** Raw place with focused units weighted — equals place without focus. */
    focused: number;
    /** Mean unit base — the board without any synergy. */
    units: number;
    /** Weighted mean pair lift (negative = the units lift each other). */
    pairs: number;
    /** Weighted mean trait-level lift. */
    traits: number;
    /** Units the board rolls to 3★, with the chance it hits (see header). */
    reroll: { apiName: string; hitChance: number }[];
};

/**
 * Best reroll plan: the units whose expected 3★ gain is largest, within
 * STRENGTH.reroll's caps — per cost, in total by how many 4/5-costs the
 * board carries, and on big boards. A board of 1–3 costs takes up to five
 * 3★ (top players: 4.9 on such boards), one with four 4/5-costs one; the
 * caps bind in order of gain (weighted, so a locked unit goes first),
 * which picks the best plan under them. Returns each picked unit's gain
 * (places, negative = better) and hit chance.
 */
function rerollPlan(
    champions: StrengthChampion[],
    apis: string[],
    idx: Index,
    weights: number[],
): { i: number; gain: number; p: number }[] {
    const { perCost, byExpensive, bySize } = STRENGTH.reroll;
    const gains: { i: number; gain: number; p: number; cost: number }[] = [];
    let expensive = 0;

    for (let i = 0; i < apis.length; i++) {
        const cost = champions[i].cost ?? 0;

        if (cost >= 4) {
            expensive++;
            continue;
        }

        const b3 = idx.unitBase3.get(apis[i]);
        const p = idx.hitChance.get(apis[i]);
        const b2 = idx.unitBase.get(apis[i]);

        if (
            (perCost[cost] ?? 0) > 0 &&
            b3 !== undefined &&
            p !== undefined &&
            b2 !== undefined &&
            b3 < b2
        ) {
            gains.push({ i, gain: p * (b3 - b2), p, cost });
        }
    }

    const cap = Math.min(
        byExpensive[Math.min(expensive, byExpensive.length - 1)],
        bySize[Math.min(apis.length, 10)] ?? Number.POSITIVE_INFINITY,
    );
    const used: Record<number, number> = {};
    const picked: typeof gains = [];

    gains.sort((a, b) => weights[a.i] * a.gain - weights[b.i] * b.gain);

    for (const g of gains) {
        if (picked.length >= cap) {
            break;
        }

        if ((used[g.cost] ?? 0) < perCost[g.cost]) {
            used[g.cost] = (used[g.cost] ?? 0) + 1;
            picked.push(g);
        }
    }

    return picked;
}

export function boardStrength(
    champions: StrengthChampion[],
    levels: ActiveLevel[],
    ctx: any,
    focus?: ReadonlySet<string> | null,
): Strength {
    if (champions.length === 0) {
        return {
            place: STRENGTH.baseline,
            focused: STRENGTH.baseline,
            units: 0,
            pairs: 0,
            traits: 0,
            reroll: [],
        };
    }

    const idx = indexFor(ctx);
    const apis = champions.map((c) => c.baseApiName ?? c.apiName);
    // Active but scoreless for the whole board (Kha'Zix's Rival without
    // Rengar) — no unit gets a lift from it
    const boardUnscored = unscoredTraits(champions);
    const activeTraits = new Set(levels.map((l) => l.trait));
    const weights = champions.map((c, i) =>
        focus?.has(c.apiName) || focus?.has(apis[i]) ? STRENGTH.focusWeight : 1,
    );
    // Per unit: base, mean pair lift, mean trait lift
    const unitOf = new Array<number>(apis.length);
    const pairOf = new Array<number>(apis.length).fill(0);
    const traitOf = new Array<number>(apis.length).fill(0);

    for (let i = 0; i < apis.length; i++) {
        const u = apis[i];
        unitOf[i] = idx.unitBase.get(u) ?? STRENGTH.baseline;

        let pairSum = 0;
        let pairN = 0;
        const pairsOfU = idx.pairLift.get(u);

        for (let j = 0; pairsOfU && j < apis.length; j++) {
            const l = j === i ? undefined : pairsOfU.get(apis[j]);

            if (l !== undefined) {
                pairSum += l;
                pairN++;
            }
        }

        if (pairN > 0) {
            pairOf[i] = pairSum / pairN;
        }

        let traitSum = 0;
        let traitN = 0;
        const unscored = champions[i].unscoredTraits;
        const traitsOfU = idx.traitLift.get(u);

        for (const level of levels) {
            if (
                !traitsOfU ||
                boardUnscored.has(level.trait) ||
                unscored?.includes(level.trait)
            ) {
                continue;
            }

            const l = traitsOfU.get(level.trait)?.[level.position];

            if (l !== undefined) {
                traitSum += l;
                traitN++;
            }
        }

        const inactiveOfU = idx.inactiveLift.get(u);

        for (const own of champions[i].traits ?? []) {
            if (
                !inactiveOfU ||
                activeTraits.has(own) ||
                unscored?.includes(own)
            ) {
                continue;
            }

            const l = inactiveOfU.get(own);

            if (l !== undefined) {
                traitSum += l;
                traitN++;
            }
        }

        if (traitN > 0) {
            traitOf[i] = traitSum / traitN;
        }
    }

    const plan = rerollPlan(champions, apis, idx, weights);

    for (const g of plan) {
        unitOf[g.i] += g.gain;
    }

    const n = apis.length;
    let units = 0;
    let pairs = 0;
    let traits = 0;
    let focusedSum = 0;
    let weightSum = 0;

    for (let i = 0; i < n; i++) {
        units += unitOf[i];
        pairs += pairOf[i];
        traits += traitOf[i];
        focusedSum +=
            weights[i] *
            (unitOf[i] +
                STRENGTH.pairWeight * pairOf[i] +
                STRENGTH.traitWeight * traitOf[i]);
        weightSum += weights[i];
    }

    units /= n;
    pairs = (STRENGTH.pairWeight * pairs) / n;
    traits = (STRENGTH.traitWeight * traits) / n;
    const place = units + pairs + traits;

    return {
        place,
        focused: weightSum === n ? place : focusedSum / weightSum,
        units,
        pairs,
        traits,
        reroll: plan.map((g) => ({
            apiName: champions[g.i].apiName,
            hitChance: g.p,
        })),
    };
}
