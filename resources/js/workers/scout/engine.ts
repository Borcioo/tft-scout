// @ts-nocheck
/**
 * Engine — orchestrates graph building + team finding.
 *
 * PURE — no DB, no fetch. Service layer provides all data.
 * This is the entry point for the algorithm layer.
 *
 * @typedef {Object} EngineInput
 * @property {object[]} champions - all champions (domain objects)
 * @property {object[]} traits - all traits with breakpoints (domain objects)
 * @property {object} scoringCtx - { unitRatings, traitRatings, styleScores, affinity }
 * @property {object} constraints - { lockedChampions, excludedChampions, lockedTraits, emblems, ... }
 * @property {string[][]} exclusionGroups - list of groups, each a list of
 *            mutually-exclusive champion apiNames (per base_champion_id)
 * @property {number} level - player level (5-10)
 * @property {number} topN - max results
 */

import { buildActiveTraits } from './active-traits';
import { filterCandidates, getLockedChampions, buildExclusionLookup } from './candidates';
import { buildHeroExclusionGroup } from './hero-exclusion';
import { teamScore, teamScoreBreakdown, teamRoleBalance } from './scorer';
import { buildGraph, findTeams } from './synergy-graph';
import { buildTeamInsights } from './team-insights';

/**
 * Generate team compositions.
 *
 * @param {EngineInput} input
 * @returns {object[]} - array of { champions, activeTraits, score, level, slotsUsed }
 */
export function generate(input) {
  const {
    champions,
    traits,
    scoringCtx = {},
    constraints = {},
    exclusionGroups = [],
    level = 8,
    topN = 10,
    seed = 0,
    stale = false,
  } = input;

  // Normalise emblems to a flat string[] of trait apiNames, one entry
  // per physical emblem unit. Callers pass either legacy string[] or
  // the newer [{apiName, count}]; most downstream code
  // (buildActiveTraits, synergy-graph.applyEmblems, phaseDeepVertical)
  // iterates with `for (const e of emblems)` and indexes by `e`, which
  // silently breaks on object-shaped entries and swallows the emblem
  // entirely. Expand counts by repeating the apiName and pass the flat
  // array everywhere so every existing consumer keeps working.
  const normalizedEmblems = [];

  for (const e of constraints.emblems || []) {
    if (typeof e === 'string') {
      normalizedEmblems.push(e);
      continue;
    }

    const count = Math.max(1, Number(e?.count ?? 1));

    for (let i = 0; i < count; i++) {
      normalizedEmblems.push(e.apiName);
    }
  }

  // Replace the emblems inside constraints so downstream reads stay
  // simple (`constraints.emblems`) without every consumer having to
  // renormalise.
  constraints.emblems = normalizedEmblems;

  // Append the hero mutual-exclusion group to whatever PHP gave us.
  // PHP emits base_champion_id variant groups; hero-exclusion is a
  // worker-side set rule (see hero-exclusion.ts for the TODO on
  // moving this to a proper set-rules hook later). If there are
  // fewer than 2 non-exempt hero variants, the helper returns [] so
  // no-op groups never reach buildExclusionLookup.
  const heroGroup = buildHeroExclusionGroup(champions);
  const effectiveExclusionGroups = heroGroup.length >= 2
    ? [...exclusionGroups, heroGroup]
    : exclusionGroups;

  // Filter candidates using exclusion groups
  const candidates = filterCandidates(champions, constraints, effectiveExclusionGroups);
  const rawLocked = getLockedChampions(champions, constraints.lockedChampions || []);

  // Hero variant → base swap. When the user locks a hero variant,
  // run the whole pipeline on its base champion instead. In TFT17
  // every hero has identical traits, cost and slot count as its base
  // — the only real difference is ability power — so graph edges,
  // affinity lookups (already via baseApiName), companion bonuses and
  // scorer weights all behave identically. Swap back after generation
  // so the user sees the hero variant they asked for in the final
  // comp. This avoids having to force-activate the hero's signature
  // trait (heroes are strong when built properly but still need a
  // sensible team composition — forcing tight trait breakpoints like
  // Stargazer@7 starves the team-builder); instead we let the normal
  // flow produce a good comp and simply mark which unit in it is the
  // hero variant.
  const championByApi = Object.fromEntries(champions.map(c => [c.apiName, c]));
  const heroSwapBackByBaseApi = new Map();
  const locked = rawLocked.map(c => {
    if (c.variant !== 'hero' || !c.baseApiName) {
      return c;
    }

    const base = championByApi[c.baseApiName];

    if (!base) {
      return c;
    }

    heroSwapBackByBaseApi.set(base.apiName, c);

    return base;
  });

  // Normalise lockedTraits to {apiName, minUnits} shape. Accept
  // both the object form and a bare string (legacy). A bare string
  // means "trait must be active at all", so minUnits = 1.
  const traitLocks = (constraints.lockedTraits || []).map(t =>
    typeof t === 'string' ? { apiName: t, minUnits: 1 } : t,
  );

  // Tight-trait-lock auto-promotion: when a requested trait lock
  // requires exactly as many units as the accessible pool has, every
  // satisfying champion is mandatory — promote them all into
  // `locked` so the team-builder seeds from this mandatory core and
  // only explores filler combinations for the remaining slots.
  //
  // Without this, `traitLocks` only runs as a post-filter: phases
  // build generic teams that ignore the lock, almost none satisfy
  // it, and the filter throws nearly everything out (ShieldTank:6
  // with a 6-champion pool produced just 3 unique comps because
  // the vast majority of raw teams never hit the trait breakpoint).
  //
  // For loose locks (pool > minUnits) we leave the filter as-is —
  // auto-promoting a subset would arbitrarily pin specific champs
  // over others; that case wants a dedicated trait-seeded phase.
  const excludedSet = new Set(constraints.excludedChampions || []);
  const lockedApiSet = new Set(locked.map(c => c.apiName));

  for (const lock of traitLocks) {
    const poolForTrait = champions.filter(c =>
      c.variant !== 'hero'
      && !excludedSet.has(c.apiName)
      && c.traits.includes(lock.apiName),
    );

    if (poolForTrait.length !== lock.minUnits) {
      continue;
    }

    for (const c of poolForTrait) {
      if (lockedApiSet.has(c.apiName)) {
        continue;
      }

      locked.push(c);
      lockedApiSet.add(c.apiName);
    }
  }

  // Calculate team size from level, accounting for locked enhanced champions
  const baseTeamSize = level;
  let extraSlots = 0;

  for (const c of locked) {
    if (c.slotsUsed > 1) {
extraSlots += c.slotsUsed - 1;
}
  }

  const effectiveTeamSize = baseTeamSize - extraSlots;

  // Build graph from eligible champions (locked + candidates).
  // Auto-promoted tight-lock champions may have been in `candidates`
  // already; dedupe via apiName to avoid passing the same node twice
  // into buildGraph (which would inflate its edge count).
  const lockedApiSetForGraph = new Set(locked.map(c => c.apiName));
  const eligibleChampions = [
    ...locked,
    ...candidates.filter(c => !lockedApiSetForGraph.has(c.apiName)),
  ];
  const exclusionLookup = buildExclusionLookup(effectiveExclusionGroups);
  const graph = buildGraph(eligibleChampions, traits, scoringCtx, exclusionLookup);

  // Find teams — request extra so diversify has enough candidates.
  // When trait locks are active, widen the search even more because
  // the post-generation filter below drops teams that miss the
  // requirement, and the raw pool needs to be big enough to survive.
  //
  // Search budget is CONSTANT — it does not scale with topN. Phase
  // cutoffs inside findTeams early-exit on `results.size >= maxResults * N`,
  // so if the budget tracked topN, a small topN would cut phases
  // short and miss strong comps (rank-1 would then shift as topN
  // changes for the same seed — not what callers expect). Keeping
  // the budget constant means rank-k is deterministic for a given
  // seed regardless of topN, and runtime is predictable. topN only
  // slices the final sorted list.
  const SEARCH_BUDGET = 40;
  const searchMultiplier = (constraints.max5Cost != null ? 5 : 3)
    * (traitLocks.length > 0 ? 3 : 1);
  const rawTeams = findTeams(graph, {
    teamSize: effectiveTeamSize,
    startChamps: locked.map(c => c.apiName),
    maxResults: SEARCH_BUDGET * searchMultiplier,
    level,
    emblems: constraints.emblems || [],
    excludedTraits: constraints.excludedTraits || [],
    excludedChampions: constraints.excludedChampions || [],
    max5Cost: constraints.max5Cost ?? null,
    seed,
    lockedTraits: traitLocks,
  });

  // Enrich results with active traits and re-score with full scorer
  const enriched = rawTeams.map(team => {
    let totalSlots = 0;

    for (const c of team.champions) {
totalSlots += c.slotsUsed || 1;
}

    const activeTraits = buildActiveTraits(team.champions, traits, constraints.emblems || []);

    // Re-score with full scorer
    const score = teamScore({
      champions: team.champions,
      activeTraits,
      level,
      roleBalance: constraints.roleBalance ?? null,
    }, scoringCtx);

    const breakdown = teamScoreBreakdown({ champions: team.champions, activeTraits, level, roleBalance: constraints.roleBalance ?? null }, scoringCtx);

    const roles = teamRoleBalance(team.champions);

    return {
      champions: team.champions,
      activeTraits,
      score,
      breakdown,
      level,
      slotsUsed: totalSlots,
      roles: { frontline: roles.frontline, dps: roles.dps, fighter: roles.fighter },
    };
  });

  // Filter out comps that exceed slot budget OR that miss any
  // player-requested trait lock. Trait locks are a hard filter —
  // every active trait in the locked list must hit at least its
  // requested minUnits count.
  const maxSlots = level;
  const minFrontline = constraints.minFrontline ?? 0;
  const minDps = constraints.minDps ?? 0;
  const applyRoleFilter = minFrontline > 0 || minDps > 0;
  const validComps = enriched.filter(r => {
    if (r.slotsUsed > maxSlots) {
      return false;
    }

    for (const lock of traitLocks) {
      const active = r.activeTraits.find(t => t.apiName === lock.apiName);

      if (!active || active.count < lock.minUnits) {
        return false;
      }
    }

    if (applyRoleFilter) {
      if (!r.roles) {
        return false;
      }

      const fl = r.roles.frontline + 0.5 * r.roles.fighter;
      const dps = r.roles.dps + 0.5 * r.roles.fighter;

      if (fl < minFrontline) {
        return false;
      }

      if (dps < minDps) {
        return false;
      }
    }

    return true;
  });

  // Meta-comp match detection — annotate results that match known meta comps
  const metaComps = scoringCtx.metaComps || [];

  if (metaComps.length > 0) {
    for (const comp of validComps) {
      const teamApis = new Set(comp.champions.map(c => c.baseApiName || c.apiName));

      for (const meta of metaComps) {
        const overlap = meta.units.filter(u => teamApis.has(u)).length;

        // Match if ≥70% of meta comp units are in the team
        if (overlap >= Math.ceil(meta.units.length * 0.7)) {
          comp.metaMatch = {
            name: meta.name,
            avgPlace: meta.avgPlace,
            games: meta.games,
            overlap,
            total: meta.units.length,
          };
          break; // first (best) match only
        }
      }
    }
  }

  // Compute batch median so the `noMetaMatch` concern rule can
  // decide which teams look experimental (below median) vs just
  // variants of a meta build.
  const scoresAsc = validComps.map(t => t.score).sort((a, b) => a - b);
  const batchMedianScore = scoresAsc.length === 0
    ? 0
    : scoresAsc[Math.floor(scoresAsc.length / 2)];

  // stale lives on ScoutContext, not ScoringContext — fold it in
  // so the staleData concern rule can read it through the same
  // object as the rest of the scoring data.
  const ctxForInsights = { ...scoringCtx, stale };

  for (const team of validComps) {
    team.insights = buildTeamInsights(team, ctxForInsights, batchMedianScore);
  }

  // Sort by final score and return top N
  validComps.sort((a, b) => b.score - a.score);

  const finalComps = validComps.slice(0, topN);

  // Swap base champions back to their hero variants for any hero
  // the caller locked. Traits, cost and slotsUsed are identical so
  // the rest of the scoring stays correct, and the consumer sees
  // the hero variant they asked for.
  if (heroSwapBackByBaseApi.size > 0) {
    for (const comp of finalComps) {
      comp.champions = comp.champions.map(c => heroSwapBackByBaseApi.get(c.apiName) ?? c);
    }
  }

  return finalComps;
}
