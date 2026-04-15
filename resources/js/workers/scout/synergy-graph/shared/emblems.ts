// resources/js/workers/scout/synergy-graph/shared/emblems.ts
//
// Emblem application helpers. Pure — operate on trait count maps
// and return new maps, never mutate inputs. Consumed by graph
// building (edge computation) and phases that explore emblem
// placements (deepVertical).

// @ts-nocheck

/**
 * Apply emblems to trait counts, respecting the constraint that each emblem
 * must go on a champion who doesn't already have that trait.
 * Mutates traitCounts in place.
 */
export function applyEmblems(traitCounts, emblems, champTraitSets) {
  // champTraitSets: array of Sets, one per champion (their natural traits)
  // For each emblem trait, count how many champions DON'T have it → max usable
  const emblemsByTrait = {};

  for (const e of emblems) {
emblemsByTrait[e] = (emblemsByTrait[e] || 0) + 1;
}

  for (const [trait, count] of Object.entries(emblemsByTrait)) {
    const holders = champTraitSets.filter(ts => !ts.has(trait)).length;
    const usable = Math.min(count, holders);

    if (usable > 0) {
traitCounts[trait] = (traitCounts[trait] || 0) + usable;
}
  }
}
