/**
 * Compute active traits for a team given champion objects and emblems.
 *
 * Pure function extracted from engine.js so it can be reused by both
 * the generator (which builds it after findTeams) and the re-score
 * helper (which scores a saved team without running the generator).
 *
 * Applies:
 * - Mecha "enhanced" 2x counting for TFT17_Mecha trait
 * - Emblem holder capping (emblem only counts for champs not already having the trait)
 *
 * @param {object[]} champions - champion objects with { apiName, traits, variant, ... }
 * @param {object[]} allTraits - all trait definitions with breakpoints
 * @param {string[]} emblems - emblem trait apiNames
 * @returns {object[]} active traits
 */
export function buildActiveTraits(champions, allTraits, emblems) {
  const traitMap = {};
  for (const t of allTraits) traitMap[t.apiName] = t;

  const traitCounts = {};
  for (const c of champions) {
    for (const t of c.traits) {
      const isMechaEnhanced = c.variant === 'enhanced' && t === 'TFT17_Mecha';
      traitCounts[t] = (traitCounts[t] || 0) + (isMechaEnhanced ? 2 : 1);
    }
  }

  // Emblems — capped by non-trait champions available as holders
  const champTraitSets = champions.map(c => new Set(c.traits || []));
  const emblemsByTrait = {};
  for (const e of (emblems || [])) emblemsByTrait[e] = (emblemsByTrait[e] || 0) + 1;
  for (const [trait, count] of Object.entries(emblemsByTrait)) {
    const holders = champTraitSets.filter(ts => !ts.has(trait)).length;
    const usable = Math.min(count, holders);
    if (usable > 0) traitCounts[trait] = (traitCounts[trait] || 0) + usable;
  }

  // Build active traits list (only traits that hit at least the first breakpoint)
  const activeTraits = [];
  for (const [apiName, count] of Object.entries(traitCounts)) {
    const traitDef = traitMap[apiName];
    if (!traitDef) continue;

    const sorted = [...(traitDef.breakpoints || [])].sort((a, b) => a.minUnits - b.minUnits);
    let activeBp = null;
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (count >= sorted[i].minUnits) { activeBp = sorted[i]; break; }
    }
    if (!activeBp) continue;

    activeTraits.push({
      apiName,
      name: traitDef.name,
      icon: traitDef.icon,
      count,
      breakpoints: sorted,
      activeStyle: activeBp.style,
      activeBreakpoint: activeBp.minUnits,
    });
  }

  return activeTraits;
}
