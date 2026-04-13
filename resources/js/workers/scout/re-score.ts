/**
 * Re-score a saved team using the current scoring context.
 *
 * This is NOT the generator — it does not explore compositions. It
 * simply computes the score of a specific (already-chosen) team using
 * the current MetaTFT ratings. Used by the SavedTeamsPage to show
 * drift between "score at save time" and "score now".
 *
 * If any champion is missing from the current pool (e.g. removed in a
 * patch), returns `{ score: null, missing: N, champions }` so the UI
 * can render a warning instead of a broken score.
 */

import { teamScore } from './scorer';
import { buildActiveTraits } from './active-traits';

/**
 * @param {object} params
 * @param {string[]} params.championApis - apiNames from the saved team
 * @param {number} params.level - player level at save time
 * @param {string[]} params.emblems - emblem trait apiNames at save time
 * @param {object} params.context - { champions, traits, scoringCtx } from /api/scout/context
 * @returns {{ score: number | null, missing: number, champions: object[], activeTraits: object[] }}
 */
export function rescoreTeam({ championApis, level, emblems, context }: any) {
  const { champions, traits, scoringCtx } = context;

  const champs = championApis
    .map((api: any) => champions.find((c: any) => c.apiName === api))
    .filter(Boolean);

  const missing = championApis.length - champs.length;
  if (missing > 0) {
    return { score: null, missing, champions: champs, activeTraits: [] };
  }

  const activeTraits = buildActiveTraits(champs, traits, emblems);
  const score = teamScore({ champions: champs, activeTraits, level }, scoringCtx);
  return { score, missing: 0, champions: champs, activeTraits };
}
