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
