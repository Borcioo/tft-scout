/**
 * Hero variant activation hints — infer which trait a locked hero
 * variant wants to see active so the team-builder actually triggers
 * the hero ability.
 *
 * TFT17 hero variants (Aatrox_hero, Nasus_hero, etc.) are trait-
 * activated — they reach full power only when a specific trait
 * breakpoint is hit. Without a constraint, generic generate just
 * treats them like any other champion and often picks a team where
 * the hero's trait is barely active. When the user explicitly locks
 * a hero variant, the intent is "build around this hero", so we
 * auto-inject a trait lock matching the hero's "signature" trait.
 *
 * Heuristic: pick the RAREST of the hero's traits (fewest champions
 * sharing it in the set), then its highest breakpoint that still
 * fits in the team. Rarer trait usually means origin/flavor trait
 * rather than generic class (Tank/MeleeTrait/etc.) — empirically
 * matches hero activation in 4/7 TFT17 heroes unambiguously, with
 * ties broken by higher max breakpoint.
 *
 * Known limitation: the "rarest trait" heuristic may pick the wrong
 * trait for heroes where both slots are origin traits (e.g.
 * Poppy_hero has Astronaut=10 champs, ResistTank=9 champs → picks
 * ResistTank which still produces a playable board, just not the
 * fabled 10-Astronaut dream). When the heuristic fails the user can
 * always override by locking a trait explicitly — that path is
 * untouched.
 */

type ChampionLite = {
  apiName: string;
  variant: string | null;
  traits: string[];
};

type TraitLite = {
  apiName: string;
  breakpoints?: { minUnits: number }[];
};

type TraitLock = { apiName: string; minUnits: number };

/**
 * Returns a trait lock for the rarest trait of the hero whose highest
 * breakpoint still fits within teamSize, or null if no breakpoint is
 * reachable.
 */
export function inferHeroTraitLock(
  hero: ChampionLite,
  allChampions: ChampionLite[],
  traitsByApi: Record<string, TraitLite>,
  teamSize: number,
): TraitLock | null {
  if (hero.variant !== 'hero') {
    return null;
  }

  // Count how many champions share each trait (sparsity proxy).
  const champCountByTrait: Record<string, number> = {};

  for (const c of allChampions) {
    for (const t of c.traits) {
      champCountByTrait[t] = (champCountByTrait[t] || 0) + 1;
    }
  }

  const scored = hero.traits
    .map(t => {
      const trait = traitsByApi[t];

      if (!trait || !trait.breakpoints || trait.breakpoints.length === 0) {
        return null;
      }

      const reachable = [...trait.breakpoints]
        .filter(bp => bp.minUnits <= teamSize)
        .sort((a, b) => b.minUnits - a.minUnits);

      if (reachable.length === 0) {
        return null;
      }

      return {
        apiName: t,
        minUnits: reachable[0].minUnits,
        sparsity: champCountByTrait[t] ?? 0,
      };
    })
    .filter((x): x is { apiName: string; minUnits: number; sparsity: number } => x !== null);

  if (scored.length === 0) {
    return null;
  }

  // Rarer first, tie-break by higher breakpoint (more dramatic activation).
  scored.sort((a, b) => a.sparsity - b.sparsity || b.minUnits - a.minUnits);

  return { apiName: scored[0].apiName, minUnits: scored[0].minUnits };
}
