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
 * @param {object[]} exclusionGroups - [{groupName, championApiName}]
 */
/**
 * Build exclusion lookup: apiName → Set of apiNames that can't be in team with it.
 * Used both here (for locked filtering) and by engine (during team building).
 */
export function buildExclusionLookup(exclusionGroups: any) {
  const groupMap: any = {};
  for (const eg of exclusionGroups) {
    (groupMap[eg.groupName] ??= []).push(eg.championApiName);
  }
  const lookup: any = {};
  for (const members of Object.values(groupMap)) {
    for (const m of members as any) {
      lookup[m] = new Set((members as any).filter((x: any) => x !== m));
    }
  }
  return lookup;
}

export function filterCandidates(allChampions: any, constraints: any, exclusionGroups = []) {
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
    if (conflicts) conflicts.forEach((c: any) => excludedSet.add(c));
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
  for (const emblem of emblems) relevantTraits.add(emblem);

  // Filter and rank candidates
  const candidates = allChampions
    .filter((c: any) => !excludedSet.has(c.apiName))
    .filter((c: any) => !lockedSet.has(c.apiName))
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
