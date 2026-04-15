// resources/js/workers/scout/synergy-graph/phases/locked-trait-seeded.ts

// @ts-nocheck

import { buildOneTeam } from '../shared/team-builder';
import type { PhaseContext } from '../types';

export function phaseLockedTraitSeeded(ctx: PhaseContext): void {
  const { graph, teamSize, context, rng, addResult, excludedSet } = ctx;
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

// ── Locked-trait helpers (private — moved from synergy-graph.ts monolith) ──
//
// These helpers used to be exported from synergy-graph.ts so the
// locked-trait-seeded phase could import them across module
// boundaries. After Task 14 they live here as private helpers for
// better locality — nothing outside this file calls them.

/**
 * Collect candidate champions for every locked trait. Returns a map
 * keyed by trait apiName or null when any lock is impossible given
 * the current pool (caller should bail without running any attempts).
 *
 * Hero variants and user-excluded champions are filtered out; the
 * allowed-set gate (level-based shop odds) is respected too.
 */
function buildLockedTraitPool(lockedTraits, graph, excludedSet, allowedSet) {
  const pool = new Map();

  for (const lock of lockedTraits) {
    const candidates = [];

    for (const [api, node] of Object.entries(graph.nodes)) {
      if (!node || node.variant === 'hero') {
        continue;
      }

      if (excludedSet.has(api)) {
        continue;
      }

      if (allowedSet && !allowedSet.has(api)) {
        continue;
      }

      if (!node.traits || !node.traits.includes(lock.apiName)) {
        continue;
      }

      candidates.push(api);
    }

    if (candidates.length < lock.minUnits) {
      return null;
    }

    pool.set(lock.apiName, candidates);
  }

  return pool;
}

/**
 * Deterministic seed strategy #1 — sort each trait's pool by the
 * MetaTFT unitRating score (higher is better) with an apiName
 * tie-breaker, then slice `minUnits` champs. The attemptIndex
 * rotates the slice window so attempt 0 takes the top minUnits,
 * attempt 1 shifts by 1, etc. With 20 attempts on a typical
 * pool of 6–10 champs this rotates through every realistic
 * top-K combination without explicit enumeration.
 */
function pickSeedsTopUnitRating(pool, lockedTraits, graph, unitRatings, attemptIndex) {
  const seeds = new Set();

  for (const lock of lockedTraits) {
    const candidates = pool.get(lock.apiName) ?? [];

    if (candidates.length === 0) {
      continue;
    }

    const sorted = [...candidates].sort((a, b) => {
      const ra = unitRatings?.[a]?.score ?? 0;
      const rb = unitRatings?.[b]?.score ?? 0;

      if (ra !== rb) {
        return rb - ra;
      }

      return a.localeCompare(b);
    });

    const windowStart = attemptIndex % Math.max(1, sorted.length - lock.minUnits + 1);

    for (let i = 0; i < lock.minUnits; i++) {
      const pick = sorted[(windowStart + i) % sorted.length];

      seeds.add(pick);
    }
  }

  return [...seeds];
}

/**
 * Enumerate companion-proven pairs from the locked-trait pool, sorted
 * by avgPlace ascending. A pair (A, B) qualifies when:
 *   - A is in some locked trait's pool,
 *   - B is in a (possibly different) locked trait's pool,
 *   - ctx.companions[baseOf(A)] contains an entry for baseOf(B),
 *   - that entry's avgPlace < 4.0 (top-half of placements).
 *
 * Returned once per findTeams call — computed lazily and cached by
 * the caller.
 */
function enumerateLockedTraitCompanionPairs(pool, lockedTraits, companions, graph) {
  if (!companions) {
    return [];
  }

  const unionPool = new Set();

  for (const lock of lockedTraits) {
    for (const api of pool.get(lock.apiName) ?? []) {
      unionPool.add(api);
    }
  }

  const baseOf = (api) => graph.nodes[api]?.baseApiName || api;
  const pairs = [];
  const seen = new Set();

  for (const a of unionPool) {
    const entries = companions[baseOf(a)];

    if (!entries) {
      continue;
    }

    for (const entry of entries) {
      const b = entry.companion;

      if (!unionPool.has(b) || a === b) {
        continue;
      }

      const key = [a, b].sort((x, y) => x.localeCompare(y)).join('+');

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);

      if (typeof entry.avgPlace === 'number' && entry.avgPlace < 4.0) {
        pairs.push({ a, b, avgPlace: entry.avgPlace });
      }
    }
  }

  pairs.sort((x, y) => x.avgPlace - y.avgPlace);

  return pairs;
}

/**
 * Deterministic seed strategy #2 — pick the N-th companion-proven pair
 * from the pre-sorted list, then fill each trait's minUnits requirement
 * by drawing from the unit-rating-sorted pool. Falls back to the
 * top-unit-rating strategy when no pairs exist (no MetaTFT companion
 * data for the pool or all avgPlaces ≥ 4.0).
 */
function pickSeedsCompanionPair(pool, lockedTraits, graph, unitRatings, pairs, attemptIndex) {
  if (pairs.length === 0) {
    return pickSeedsTopUnitRating(pool, lockedTraits, graph, unitRatings, attemptIndex);
  }

  const pair = pairs[attemptIndex % pairs.length];
  const seeds = new Set([pair.a, pair.b]);

  for (const lock of lockedTraits) {
    const members = (pool.get(lock.apiName) ?? []).filter(api => seeds.has(api));

    if (members.length >= lock.minUnits) {
      continue;
    }

    const sorted = [...(pool.get(lock.apiName) ?? [])]
      .filter(api => !seeds.has(api))
      .sort((a, b) => {
        const ra = unitRatings?.[a]?.score ?? 0;
        const rb = unitRatings?.[b]?.score ?? 0;

        if (ra !== rb) {
          return rb - ra;
        }

        return a.localeCompare(b);
      });

    const needed = lock.minUnits - members.length;

    for (let i = 0; i < needed && i < sorted.length; i++) {
      seeds.add(sorted[i]);
    }
  }

  return [...seeds];
}

/**
 * Deterministic seed strategy #3 — for each locked trait, pick
 * minUnits champions with a deliberate cost spread instead of clustering
 * on the cheapest ones. For pools with enough variety we take the
 * cheapest, the most expensive, and fill the middle from the
 * unit-rating-sorted remainder. For small minUnits (<3) we just take
 * cheapest + most expensive so the strategy degrades gracefully.
 *
 * Uses the shared RNG so the cost buckets are shuffled deterministically
 * per attempt — without it every attempt would pick the same stratified
 * seed and we'd lose the diversity we're paying for.
 */
function pickSeedsCostStratified(pool, lockedTraits, graph, unitRatings, rng) {
  const seeds = new Set();

  for (const lock of lockedTraits) {
    const candidates = pool.get(lock.apiName) ?? [];

    if (candidates.length === 0) {
      continue;
    }

    const byCost = [...candidates].sort((a, b) => {
      const ca = graph.nodes[a]?.cost ?? 0;
      const cb = graph.nodes[b]?.cost ?? 0;

      if (ca !== cb) {
        return ca - cb;
      }

      return a.localeCompare(b);
    });

    const picks = new Set();
    const minUnits = lock.minUnits;

    picks.add(byCost[0]);

    if (minUnits >= 2) {
      picks.add(byCost[byCost.length - 1]);
    }

    if (minUnits >= 3) {
      const mid = Math.floor(byCost.length / 2);
      picks.add(byCost[mid]);
    }

    // Fill remaining slots from a shuffled copy so later attempts
    // explore different fillers around the anchored endpoints.
    const remaining = byCost.filter(api => !picks.has(api));

    for (let i = remaining.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = remaining[i];

      remaining[i] = remaining[j];
      remaining[j] = tmp;
    }

    let idx = 0;

    while (picks.size < minUnits && idx < remaining.length) {
      picks.add(remaining[idx]);
      idx++;
    }

    for (const api of picks) {
      seeds.add(api);
    }
  }

  return [...seeds];
}
