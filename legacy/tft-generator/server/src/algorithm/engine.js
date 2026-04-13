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
 * @property {object[]} exclusionGroups - [{ groupName, championApiName }]
 * @property {number} level - player level (5-10)
 * @property {number} topN - max results
 */

import { buildGraph, findTeams } from './synergy-graph.js';
import { filterCandidates, getLockedChampions, buildExclusionLookup } from './candidates.js';
import { teamScore, teamScoreBreakdown, teamRoleBalance } from './scorer.js';

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
  } = input;

  // Filter candidates using exclusion groups
  const candidates = filterCandidates(champions, constraints, exclusionGroups);
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
  const exclusionLookup = buildExclusionLookup(exclusionGroups);
  const graph = buildGraph(eligibleChampions, traits, scoringCtx, exclusionLookup);

  // Find teams — request extra so diversify has enough candidates
  const searchMultiplier = (constraints.max5Cost != null ? 5 : 3);
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
  const traitMap = {};
  for (const t of traits) traitMap[t.apiName] = t;

  const enriched = rawTeams.map(team => {
    const traitCounts = {};
    let totalSlots = 0;
    for (const c of team.champions) {
      totalSlots += c.slotsUsed || 1;
      for (const t of c.traits) {
        const isMechaEnhanced = c.variant === 'enhanced' && t === 'TFT17_Mecha';
        traitCounts[t] = (traitCounts[t] || 0) + (isMechaEnhanced ? 2 : 1);
      }
    }
    // Add emblems — capped by non-trait champions available as holders
    const champTraitSets = team.champions.map(c => new Set(c.traits || []));
    const emblemsByTrait = {};
    for (const e of (constraints.emblems || [])) emblemsByTrait[e] = (emblemsByTrait[e] || 0) + 1;
    for (const [trait, count] of Object.entries(emblemsByTrait)) {
      const holders = champTraitSets.filter(ts => !ts.has(trait)).length;
      const usable = Math.min(count, holders);
      if (usable > 0) traitCounts[trait] = (traitCounts[trait] || 0) + usable;
    }

    // Build active traits list
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

  // Filter out comps that exceed slot budget
  const maxSlots = level;
  const validComps = enriched.filter(r => r.slotsUsed <= maxSlots);

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

  // Sort by final score and return top N
  validComps.sort((a, b) => b.score - a.score);
  return validComps.slice(0, topN);
}
