/**
 * Trait rules that change the board itself rather than the score.
 *
 * Currently: max-team-size bonuses. A trait breakpoint can grow the
 * board (Set 17 Mecha 6 → +1 Companion Mech, Set 18 Riftbeast 10 → +2),
 * so a player on level N fields N + bonus slots. Without the bonus the
 * generator rejects every such comp as exceeding the slot budget.
 *
 * The bonus is data, not code: ScoutContextBuilder resolves it per
 * breakpoint from the trait's `TeamSize` effect variable + description
 * (see App\Services\Tft\TraitTeamSize) and ships it as
 * `breakpoint.teamSizeBonus`.
 */

type LockOrActive = {
    apiName: string;
    /** Active trait has `count`; locked trait has `minUnits`. Callers
     *  pass whichever they have — the helper reads `count ?? minUnits`. */
    count?: number;
    minUnits?: number;
};

type TraitDef = {
    apiName: string;
    breakpoints?: { minUnits: number; teamSizeBonus?: number }[];
};

/** traitApiName → breakpoints granting a bonus, highest minUnits first. */
export type TeamSizeRules = Record<string, { minUnits: number; bonus: number }[]>;

export function buildTeamSizeRules(traits: TraitDef[] | undefined | null): TeamSizeRules {
    const rules: TeamSizeRules = {};

    for (const t of traits ?? []) {
        const granting = (t.breakpoints ?? [])
            .filter(bp => (bp.teamSizeBonus ?? 0) > 0)
            .map(bp => ({ minUnits: bp.minUnits, bonus: bp.teamSizeBonus as number }))
            .sort((a, b) => b.minUnits - a.minUnits);

        if (granting.length > 0) {
            rules[t.apiName] = granting;
        }
    }

    return rules;
}

/**
 * How many extra team slots the player gets beyond their level cap
 * when the given traits are active or locked at their given counts.
 *
 * Pass either active traits (from buildActiveTraits) or trait locks —
 * the shape difference is absorbed.
 */
export function teamSizeBonus(
    traits: LockOrActive[] | undefined | null,
    rules: TeamSizeRules,
): number {
    if (!traits || traits.length === 0) {
        return 0;
    }

    let bonus = 0;

    for (const t of traits) {
        const n = t.count ?? t.minUnits ?? 0;
        const hit = rules[t.apiName]?.find(r => n >= r.minUnits);

        if (hit) {
            bonus += hit.bonus;
        }
    }

    return bonus;
}
