// resources/js/workers/scout/synergy-graph/phases/locked-trait-seeded.ts

// @ts-nocheck

import { buildOneTeam } from '../shared/team-builder';
import {
  buildLockedTraitPool,
  enumerateLockedTraitCompanionPairs,
  pickSeedsTopUnitRating,
  pickSeedsCompanionPair,
  pickSeedsCostStratified,
} from '../../synergy-graph';

export function phaseLockedTraitSeeded({ graph, teamSize, context, rng, addResult, excludedSet }) {
  const rawLockedTraits = context.lockedTraits ?? [];

  if (rawLockedTraits.length === 0) {
    return;
  }

  // Subtract emblem count per trait from minUnits so the phase seeds
  // only the physical champions the team actually needs to buy.
  // The engine-side filter still checks the emblem-inclusive count
  // through buildActiveTraits, so a team built with effective minUnits
  // physical champions + N emblems will pass the post-filter for the
  // original minUnits target. Without this adjustment the phase seeds
  // `minUnits` full-Ranged picks and saturates the team slots, leaving
  // no room for the emblem carrier to diversify across comps.
  const emblems = context.emblems || [];
  const lockedTraits = rawLockedTraits.map(lock => {
    let emblemCount = 0;

    for (const e of emblems) {
      if (e === lock.apiName) {
        emblemCount++;
      }
    }

    const effectiveMin = Math.max(0, lock.minUnits - emblemCount);

    return { apiName: lock.apiName, minUnits: effectiveMin };
  }).filter(lock => lock.minUnits > 0);

  if (lockedTraits.length === 0) {
    return;
  }

  const pool = buildLockedTraitPool(lockedTraits, graph, excludedSet, context.allowedSet);

  if (pool === null) {
    return;
  }

  const unitRatings = graph.scoringCtx?.unitRatings ?? {};
  const companions = graph.scoringCtx?.companions ?? null;
  const pairs = enumerateLockedTraitCompanionPairs(pool, lockedTraits, companions, graph);

  // Sweep the temperature across attempts so the flex-slot fillers
  // buildOneTeam picks behind the seeded core actually vary. With a
  // narrow 0.1–0.3 window the team-builder converges on the same
  // top-scoring filler every attempt; that collapses the 50-attempt
  // budget to a handful of unique comps whenever a trait lock with
  // an emblem pushes one filler far ahead of the rest (e.g.
  // ShieldTank:6 + RangedTrait:4 + emblem producing a single comp
  // because every attempt re-picked the same Morgana).
  const attempt = (seeds, attemptIdx, total) => {
    if (seeds.length === 0) {
      return;
    }

    const temperature = 0.1 + (attemptIdx / Math.max(1, total - 1)) * 0.8;

    const team = buildOneTeam(graph, teamSize, seeds, context, temperature, rng);
    addResult(team);
  };

  for (let i = 0; i < 20; i++) {
    attempt(pickSeedsTopUnitRating(pool, lockedTraits, graph, unitRatings, i), i, 20);
  }

  for (let i = 0; i < 20; i++) {
    attempt(pickSeedsCompanionPair(pool, lockedTraits, graph, unitRatings, pairs, i), i, 20);
  }

  for (let i = 0; i < 10; i++) {
    attempt(pickSeedsCostStratified(pool, lockedTraits, graph, unitRatings, rng), i, 10);
  }
}
