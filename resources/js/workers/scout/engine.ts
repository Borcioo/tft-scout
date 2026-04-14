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

import { buildGraph, findTeams } from './synergy-graph';
import { filterCandidates, getLockedChampions, buildExclusionLookup } from './candidates';
import { teamScore, teamScoreBreakdown, teamRoleBalance } from './scorer';
import { buildActiveTraits } from './active-traits';
import { buildTeamInsights } from './team-insights';
import { buildHeroExclusionGroup } from './hero-exclusion';

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
  const locked = getLockedChampions(champions, constraints.lockedChampions || []);

  // Calculate team size from level, accounting for locked enhanced champions
  let baseTeamSize = level;
  let extraSlots = 0;
  for (const c of locked) {
    if (c.slotsUsed > 1) extraSlots += c.slotsUsed - 1;
  }
  const effectiveTeamSize = baseTeamSize - extraSlots;

  // Build graph from eligible champions (locked + candidates)
  const eligibleChampions = [...locked, ...candidates];
  const exclusionLookup = buildExclusionLookup(effectiveExclusionGroups);
  const graph = buildGraph(eligibleChampions, traits, scoringCtx, exclusionLookup);

  // Normalise lockedTraits to {apiName, minUnits} shape. Accept
  // both the object form and a bare string (legacy). A bare string
  // means "trait must be active at all", so minUnits = 1.
  const traitLocks = (constraints.lockedTraits || []).map(t =>
    typeof t === 'string' ? { apiName: t, minUnits: 1 } : t,
  );

  // Find teams — request extra so diversify has enough candidates.
  // When trait locks are active, widen the search even more because
  // the post-generation filter below drops teams that miss the
  // requirement, and the raw pool needs to be big enough to survive.
  const searchMultiplier = (constraints.max5Cost != null ? 5 : 3)
    * (traitLocks.length > 0 ? 3 : 1);
  const rawTeams = findTeams(graph, {
    teamSize: effectiveTeamSize,
    startChamps: locked.map(c => c.apiName),
    maxResults: topN * searchMultiplier,
    level,
    emblems: constraints.emblems || [],
    excludedTraits: constraints.excludedTraits || [],
    excludedChampions: constraints.excludedChampions || [],
    max5Cost: constraints.max5Cost ?? null,
    seed,
  });

  // Enrich results with active traits and re-score with full scorer
  const enriched = rawTeams.map(team => {
    let totalSlots = 0;
    for (const c of team.champions) totalSlots += c.slotsUsed || 1;
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
    if (r.slotsUsed > maxSlots) return false;
    for (const lock of traitLocks) {
      const active = r.activeTraits.find(t => t.apiName === lock.apiName);
      if (!active || active.count < lock.minUnits) return false;
    }
    if (applyRoleFilter) {
      if (!r.roles) return false;
      const fl = r.roles.frontline + 0.5 * r.roles.fighter;
      const dps = r.roles.dps + 0.5 * r.roles.fighter;
      if (fl < minFrontline) return false;
      if (dps < minDps) return false;
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
  return validComps.slice(0, topN);
}
