/**
 * Hero variant mutual exclusion — set-specific scout rule.
 *
 * TFT17: the match gives the player exactly one hero augment, so at
 * most one non-exempt hero variant can appear in a real comp. Aatrox
 * is exempt because its hero augment is compatible with the player's
 * separately-chosen hero.
 *
 * Note: Aatrox_hero still conflicts with Aatrox base through the
 * existing `base_champion_id` group emitted by ScoutContextBuilder.
 * Nothing extra handled here for that case.
 *
 * Set 18 has no hero augments (no `hero` variants are imported), so
 * this is a no-op there. If a later set brings them back, move the
 * exemption list into config/tft.php `sets` and ship it in the scout
 * context instead of hardcoding it here.
 */

export const HERO_EXCLUSION_EXEMPT: ReadonlySet<string> = new Set([
    'TFT17_Aatrox_hero',
]);

type MinimalChampion = {
    apiName: string;
    variant: string | null;
};

/**
 * Returns the apiNames of all hero variant champions that should be
 * mutually exclusive (i.e. every hero variant except those in
 * HERO_EXCLUSION_EXEMPT).
 *
 * Returns an empty array when the group would have fewer than 2
 * members — a group of 0 or 1 contributes nothing to exclusion and
 * would only bloat the downstream lookup.
 */
export function buildHeroExclusionGroup(
    champions: MinimalChampion[],
): string[] {
    const group = champions
        .filter(
            (c) =>
                c.variant === 'hero' && !HERO_EXCLUSION_EXEMPT.has(c.apiName),
        )
        .map((c) => c.apiName);

    return group.length >= 2 ? group : [];
}
