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
 * TODO: promote to set-rules hook when Set 18 ships. At that point
 * introduce a per-set config file (e.g. set-rules/tft17.ts,
 * set-rules/tft18.ts) that exports { heroExemptApis, ... } and is
 * loaded at worker startup. For now a single hardcoded set is enough.
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
export function buildHeroExclusionGroup(champions: MinimalChampion[]): string[] {
  const group = champions
    .filter(c => c.variant === 'hero' && !HERO_EXCLUSION_EXEMPT.has(c.apiName))
    .map(c => c.apiName);

  return group.length >= 2 ? group : [];
}
