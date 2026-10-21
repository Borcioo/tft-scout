/**
 * How many units of `trait` a champion contributes to trait counting.
 *
 * 1 unless the scout context says otherwise. `traitAmounts` comes from
 * the champion_trait pivot, filled at import time from the character
 * bin's `mLinkedTraits[].Amount`:
 *   - Set 18 Lux forms count their element twice ("Avatar")
 *   - Set 18 Elder Dragon counts 2 Riftbeast ("Apex Predator")
 *   - Set 17 Mecha Enhanced counts 2 Mecha
 */
export function traitAmount(
    champ: { traitAmounts?: Record<string, number> | null } | null | undefined,
    trait: string,
): number {
    return champ?.traitAmounts?.[trait] ?? 1;
}

/**
 * Traits active on a board that earn no score: every unit holding them
 * lists them in `unscoredTraits`. Set 18 Rival on Kha'Zix only feeds his
 * evolutions (modelled as forms), so it still shows on the comp but adds
 * nothing until Rengar — whose gold and team AD are the trait's payoff —
 * joins the board.
 */
export function unscoredTraits(
    champions: ReadonlyArray<
        | { traits?: string[]; unscoredTraits?: string[] | null }
        | null
        | undefined
    >,
): Set<string> {
    const unscored = new Set<string>();
    const scored = new Set<string>();

    for (const c of champions) {
        for (const t of c?.traits ?? []) {
            if (c?.unscoredTraits?.includes(t)) {
                unscored.add(t);
            } else {
                scored.add(t);
            }
        }
    }

    for (const t of scored) {
        unscored.delete(t);
    }

    return unscored;
}
