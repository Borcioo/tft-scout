// resources/js/workers/scout/synergy-graph/shared/affinity.ts
//
// collectAffinityMatches — per-trait affinity match collection
// shared by scorer.ts and quick-score.ts. Returns raw list of
// weighted place-bonus values for every trait that (a) matches
// an active trait and (b) clears the noise threshold. Caller
// aggregates — scorer caps against trait-diverse abuse,
// quickScore sums lightly. Aggregation strategy is caller-specific
// by design.

type AffinityEntry = { trait: string; avgPlace: number; games: number };

/**
 * Collects per-trait affinity match bonuses for a champion given
 * the active trait set. Returns an array of weighted bonuses; the
 * caller decides whether to cap/sum/penalise.
 *
 * Lookup uses `champion.baseApiName ?? champion.apiName` — variants
 * (e.g. Miss Fortune Conduit) share the base champion's affinity
 * table. The `affinity` object is keyed by base apiName.
 *
 * Entries with `games < thresholds.affinityMinGames` are filtered
 * out to avoid noise from low-sample trait combos.
 */
export function collectAffinityMatches(
  champion: { apiName: string; baseApiName?: string },
  activeTraitApis: ReadonlySet<string>,
  affinity: Record<string, readonly AffinityEntry[] | undefined>,
  thresholds: { affinityMinGames: number },
  weights: { affinityBonus: number },
): number[] {
  const lookupApi = champion.baseApiName ?? champion.apiName;
  const data = affinity[lookupApi];

  if (!data) {
return [];
}

  const matches: number[] = [];

  for (const aff of data) {
    if (activeTraitApis.has(aff.trait) && aff.games >= thresholds.affinityMinGames) {
      matches.push(weights.affinityBonus * (1 - aff.avgPlace / 8));
    }
  }

  return matches;
}
