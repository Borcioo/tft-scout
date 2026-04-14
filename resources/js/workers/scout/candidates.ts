/**
 * Candidate filtering — selects and ranks champions for team generation.
 *
 * Pure function. Receives all data as arguments.
 * Exclusion groups are enforced here, not in engine.
 */

/**
 * @param {object[]} allChampions - all champions (including variants) as domain objects
 * @param {object} constraints
 * @param {string[]} constraints.lockedChampions - apiNames of locked champions
 * @param {string[]} constraints.excludedChampions - apiNames to exclude
 * @param {Array<string|{apiName:string, minCount:number}>} constraints.lockedTraits
 * @param {string[]} constraints.emblems - trait apiNames from emblems
 * @param {string[][]} exclusionGroups - list of groups, each a list of
 *        mutually-exclusive champion apiNames (per base_champion_id)
 */
/**
 * Build exclusion lookup: apiName → Set of apiNames that can't share a team.
 * Used both here (for locked filtering) and by engine (during team building
 * via synergy-graph).
 *
 * Input is a list of groups, each group a list of apiNames that are
 * mutually exclusive (e.g. Miss Fortune + her three variants, or
 * Galio base + Galio Enhanced). Matches the shape PHP's
 * ScoutContextBuilder::buildExclusionGroups() emits.
 */
export function buildExclusionLookup(
  exclusionGroups: string[][],
): Record<string, Set<string>> {
  const lookup: Record<string, Set<string>> = {};

  for (const group of exclusionGroups) {
    for (const member of group) {
      lookup[member] = new Set(group.filter(x => x !== member));
    }
  }

  return lookup;
}

export function filterCandidates(
  allChampions: any,
  constraints: any,
  exclusionGroups: string[][] = [],
) {
  const {
    lockedChampions = [],
    excludedChampions = [],
    lockedTraits = [],
    emblems = [],
  } = constraints;

  const lockedSet = new Set(lockedChampions);
  const excludedSet = new Set(excludedChampions);

  // If a champion from an exclusion group is locked, exclude all other group members
  const exclusionLookup = buildExclusionLookup(exclusionGroups);

  for (const locked of lockedChampions) {
    const conflicts = exclusionLookup[locked];

    if (conflicts) {
conflicts.forEach((c: any) => excludedSet.add(c));
}
  }

  // Build relevant traits set (from locked champions + locked traits + emblems)
  const relevantTraits = new Set(
    lockedTraits.map((t: any) => typeof t === 'string' ? t : t.apiName)
  );

  for (const champ of allChampions) {
    if (lockedSet.has(champ.apiName)) {
      champ.traits.forEach((t: any) => relevantTraits.add(t));
    }
  }

  for (const emblem of emblems) {
relevantTraits.add(emblem);
}

  // Filter and rank candidates
  //
  // Hero variants (variant === 'hero') are dropped unconditionally here:
  // MetaTFT has no affinity/companion data for them, they are not
  // player-pickable (only appear via specific trait activations), and
  // leaving them in the pool would starve the scorer of data and let
  // them drown in post-fix affinity scoring. If the user explicitly
  // locks a hero variant, it still reaches the team-builder via
  // getLockedChampions, which bypasses this filter.
  // TODO: add a dedicated "locked-hero pivot" phase that builds teams
  // around a locked hero variant with a separate scoring path.
  const candidates = allChampions
    .filter((c: any) => !excludedSet.has(c.apiName))
    .filter((c: any) => !lockedSet.has(c.apiName))
    .filter((c: any) => c.variant !== 'hero')
    .map((c: any) => ({
      ...c,
      relevance: c.traits.filter((t: any) => relevantTraits.has(t)).length,
    }))
    .sort((a: any, b: any) => b.relevance - a.relevance);

  return candidates;
}

/**
 * Get locked champion objects from the full list.
 */
export function getLockedChampions(allChampions: any, lockedApiNames: any) {
  const lockSet = new Set(lockedApiNames);

  return allChampions.filter((c: any) => lockSet.has(c.apiName));
}
