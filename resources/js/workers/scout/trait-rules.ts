/**
 * Per-trait algorithm rules — mechanics that CDragon doesn't expose but
 * the algorithm needs to honour. One switch per trait apiName; the
 * algorithm core stays data-driven for the common case.
 *
 * Keep this file small and boring — each rule should be a one-liner
 * gated on `apiName === 'TFT17_X'`. If a trait needs more than a few
 * conditions, split it into its own module.
 *
 * Current rules:
 *   - TFT17_Mecha @ 6 units → +1 team slot (the Companion Mech).
 *     Player on level N with active 6-Mecha can field N+1 champions.
 *     Without this bonus the generator rejects any Mecha:6 comp as
 *     exceeding the slot budget.
 */

type LockOrActive = {
    apiName: string;
    /** Active trait has `count`; locked trait has `minUnits`. Callers
     *  pass whichever they have — the helper reads `count ?? minUnits`. */
    count?: number;
    minUnits?: number;
};

/**
 * How many extra team slots the player gets beyond their level cap
 * when the given traits are active or locked at their given counts.
 *
 * Pass either active traits (from buildActiveTraits) or trait locks —
 * the shape difference is absorbed.
 */
export function teamSizeBonus(traits: LockOrActive[] | undefined | null): number {
    if (!traits || traits.length === 0) return 0;
    let bonus = 0;
    for (const t of traits) {
        const n = t.count ?? t.minUnits ?? 0;
        // Mecha @ 6 breakpoint → +1 Companion Mech slot.
        if (t.apiName === 'TFT17_Mecha' && n >= 6) {
            bonus += 1;
        }
    }
    return bonus;
}
