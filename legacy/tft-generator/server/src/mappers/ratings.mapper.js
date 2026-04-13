/**
 * Ratings mapper — translates MetaTFT API responses and DB rows
 * into a unified format that the algorithm consumes.
 *
 * Key principle: fromApi() and fromDb() return IDENTICAL shapes.
 * The algorithm never knows where the data came from.
 */

// ── Helpers ─────────────────────────────────────

export function placesToStats(places) {
  const games = places.reduce((s, p) => s + p, 0);
  if (games === 0) return null;
  const avgPlace = places.reduce((s, p, i) => s + p * (i + 1), 0) / games;
  const winRate = places[0] / games;
  const top4Rate = places.slice(0, 4).reduce((s, p) => s + p, 0) / games;
  return { avgPlace, winRate, top4Rate, games };
}

export function computeScore(avgPlace) {
  return Math.max(0, Math.min(1, (6.0 - avgPlace) / 3.0));
}

export function scoreTier(score) {
  if (score >= 0.75) return 'S';
  if (score >= 0.63) return 'A';
  if (score >= 0.53) return 'B';
  if (score >= 0.43) return 'C';
  return 'D';
}

// ── Unit ratings ────────────────────────────────

/** MetaTFT API unit entry → domain rating */
export function unitRatingFromApi(entry) {
  const stats = placesToStats(entry.places);
  if (!stats) return null;
  const score = computeScore(stats.avgPlace);
  return {
    apiName: entry.unit,
    avgPlace: stats.avgPlace,
    winRate: stats.winRate,
    top4Rate: stats.top4Rate,
    games: stats.games,
    score,
    tier: scoreTier(score),
  };
}

/** DB row → domain rating (same shape as fromApi) */
export function unitRatingFromDb(row) {
  return {
    apiName: row.apiName,
    avgPlace: row.avgPlace,
    winRate: row.winRate,
    top4Rate: row.top4Rate,
    games: row.games,
    score: row.score,
    tier: scoreTier(row.score),
  };
}

// ── Trait ratings ───────────────────────────────

/** Parse MetaTFT trait key "TFT17_Mecha_3" → { apiName, position } */
export function parseTraitKey(key) {
  const lastUnderscore = key.lastIndexOf('_');
  const suffix = key.substring(lastUnderscore + 1);
  const position = parseInt(suffix, 10);
  if (isNaN(position)) return null;
  const apiName = key.substring(0, lastUnderscore);
  return { apiName, position };
}

/**
 * Normalize Stargazer variants to base trait for scoring.
 * MetaTFT returns TFT17_Stargazer_Wolf_1, TFT17_Stargazer_Serpent_1 etc.
 * All map to TFT17_Stargazer for the algorithm.
 */
export function normalizeTraitApiName(apiName) {
  const stargazerVariants = ['_Wolf', '_Serpent', '_Huntress', '_Medallion', '_Shield', '_Fountain', '_Mountain'];
  for (const v of stargazerVariants) {
    if (apiName.includes('Stargazer' + v)) {
      return apiName.replace('Stargazer' + v, 'Stargazer');
    }
  }
  return apiName;
}

/** MetaTFT API trait entry → domain rating */
export function traitRatingFromApi(entry) {
  const parsed = parseTraitKey(entry.trait);
  if (!parsed) return null;
  const stats = placesToStats(entry.places);
  if (!stats) return null;
  const score = computeScore(stats.avgPlace);
  return {
    traitApiName: normalizeTraitApiName(parsed.apiName),
    breakpointPosition: parsed.position,
    avgPlace: stats.avgPlace,
    winRate: stats.winRate,
    top4Rate: stats.top4Rate,
    games: stats.games,
    score,
  };
}

/** DB row → domain rating */
export function traitRatingFromDb(row) {
  return {
    traitApiName: row.traitApiName,
    breakpointPosition: row.breakpointPosition,
    avgPlace: row.avgPlace,
    winRate: row.winRate,
    top4Rate: row.top4Rate,
    games: row.games,
    score: row.score,
  };
}

// ── Trait affinity ──────────────────────────────

/** MetaTFT explorer/traits entry → affinity record */
export function affinityFromApi(unitApiName, entry, totalGames) {
  const parsed = parseTraitKey(entry.traits);
  if (!parsed) return null;
  const stats = placesToStats(entry.placement_count);
  if (!stats) return null;
  return {
    unitApiName,
    traitApiName: normalizeTraitApiName(parsed.apiName),
    breakpointPosition: parsed.position,
    avgPlace: stats.avgPlace,
    games: stats.games,
    frequency: stats.games / totalGames,
  };
}

/** DB row → domain affinity */
export function affinityFromDb(row) {
  return {
    unitApiName: row.unitApiName,
    traitApiName: row.traitApiName,
    breakpointPosition: row.breakpointPosition,
    avgPlace: row.avgPlace,
    games: row.games,
    frequency: row.frequency,
  };
}
