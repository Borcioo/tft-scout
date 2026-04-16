// resources/js/workers/scout/synergy-graph/core.ts
//
// Orchestration for the synergy-graph algorithm. Owns findTeams, the
// PHASES registry, and the phase dispatch loop. Never contains
// phase-level algorithmic logic — that lives in phases/*.
//
// Task 14 (6e): extracted from the legacy synergy-graph.ts monolith.
// The monolith is deleted once this file is in place; engine.ts's
// `import from './synergy-graph'` now resolves to the folder's
// index.ts which re-exports findTeams from here.

// @ts-nocheck

import { SCORING_CONFIG, MIN_LEVEL_BY_COST } from '../config';
import { startSpan } from '../scout-profiler';
import { buildGraph } from './graph';
import { phaseCompanionSeeded } from './phases/companion-seeded';
import { phaseCrossover } from './phases/crossover';
import { phaseDeepVertical } from './phases/deep-vertical';
import { phaseFiveCostHeavy } from './phases/five-cost-heavy';
import { phaseHillClimb } from './phases/hill-climb';
import { phaseLockedTraitSeeded } from './phases/locked-trait-seeded';
import { phaseMetaCompSeeded } from './phases/meta-comp-seeded';
import { phasePairSynergy } from './phases/pair-synergy';
import { phaseTemperatureSweep } from './phases/temperature-sweep';
import { phaseTraitSeeded } from './phases/trait-seeded';
import { quickScore } from './quick-score';
import { applyEmblems } from './shared/emblems';
import { costPenalty } from './shared/team-builder';
import type { PhaseContext, PhaseEntry } from './types';

const { weights, breakpointMultiplier, nearBreakpointBonus, minGamesForReliable, thresholds } = SCORING_CONFIG;

// ── RNG ─────────────────────────────────────────

function createRng(seed) {
  let s = seed | 0;

  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Phase registry ─────────────────────────────────
//
// Ordered dispatch table for findTeams. Matches the exact call order
// the old monolith used inside its findTeams body — do not reorder
// without re-running the refactor-R baseline diff.
//
// `skipWhen` is a registry-level predicate evaluated per-phase before
// the call. Fix 2A's locked-run skip for phaseTemperatureSweep used to
// live as an inline early-return at the top of the phase body; Task 14
// surfaces it here so the orchestration decision is visible at the
// registry level and the phase body stays focused on its core loop.

function skipTemperatureSweepOnLocked(ctx: PhaseContext): boolean {
  return (ctx.context.lockedTraits || []).length > 0;
}

const PHASES: PhaseEntry[] = [
  // ORDER MATCHES THE OLD findTeams DISPATCH ORDER — do not reorder.
  { name: 'lockedTraitSeeded', phase: phaseLockedTraitSeeded },
  { name: 'temperatureSweep',  phase: phaseTemperatureSweep, skipWhen: skipTemperatureSweepOnLocked },
  { name: 'traitSeeded',       phase: phaseTraitSeeded },
  { name: 'deepVertical',      phase: phaseDeepVertical },
  { name: 'pairSynergy',       phase: phasePairSynergy },
  { name: 'companionSeeded',   phase: phaseCompanionSeeded },
  { name: 'metaCompSeeded',    phase: phaseMetaCompSeeded },
  { name: 'fiveCostHeavy',     phase: phaseFiveCostHeavy },
  { name: 'crossover',         phase: phaseCrossover },
  { name: 'hillClimb',         phase: phaseHillClimb },
];

// ── Diversification ────────────────────────────────

function diversifyResults(results, maxResults, traitBreakpoints, emblems = []) {
  const sorted = [...results.values()].sort((a, b) => b.score - a.score);

  // Group by dominant trait pair + breakpoint level
  const grouped = new Map();

  for (const team of sorted) {
    const traitCounts = {};

    for (const c of team.champions) {
      for (const t of c.traits) {
        traitCounts[t] = (traitCounts[t] || 0) + 1;
      }
    }

    const champTraitSets = team.champions.map(c => new Set(c.traits || []));
    applyEmblems(traitCounts, emblems, champTraitSets);
    const groupKey = Object.entries(traitCounts)
      .filter(([t]) => (traitBreakpoints[t]?.[0] || 0) > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([t, count]) => {
        const bps = traitBreakpoints[t] || [];
        // NOTE: intentionally not using findActiveBreakpointIdx here —
        // traitBreakpoints stores raw number[] (minUnits values directly),
        // not {minUnits: number}[] objects. The helper expects the object form.
        let lvl = 0;

        for (let i = bps.length - 1; i >= 0; i--) {
          if (count >= bps[i]) {
            lvl = i; break;
          }
        }

        return `${t}@${lvl}`;
      })
      .sort()
      .join('+') || 'flex';

    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, team);
    }
  }

  // Best per group first, then fill with remaining
  const diverse = [...grouped.values()].sort((a, b) => b.score - a.score);
  const seenKeys = new Set(diverse.map(t => t.champions.map(c => c.apiName).sort().join(',')));

  for (const t of sorted) {
    const key = t.champions.map(c => c.apiName).sort().join(',');

    if (!seenKeys.has(key)) {
      diverse.push(t);
      seenKeys.add(key);
    }

    if (diverse.length >= maxResults) {
      break;
    }
  }

  return diverse.slice(0, maxResults);
}

/**
 * Build the set of champion apiNames allowed in the generated team
 * based on player level. Locked champions always bypass the filter.
 *
 * @param {object} graph - from buildGraph()
 * @param {number|null} level - player level, or null for no filter
 * @param {string[]} lockedChamps - champion apiNames that must always be allowed
 * @returns {Set<string>} allowed apiNames
 */
function buildAllowedSet(graph, level, lockedChamps) {
  // Brak level → wszystko dozwolone (kompatybilność wsteczna).
  if (!level) {
    return new Set(Object.keys(graph.nodes));
  }

  const allowed = new Set(lockedChamps || []);

  for (const [api, node] of Object.entries(graph.nodes)) {
    const cost = node.cost || 1;
    const minLvl = MIN_LEVEL_BY_COST[cost];

    if (minLvl != null && level >= minLvl) {
      allowed.add(api);
    }
  }

  return allowed;
}

// ── Public API ───────────────────────────────────

/**
 * Find optimal teams using graph traversal.
 *
 * @param {object} graph - from buildGraph()
 * @param {object} options
 * @returns {Array<{champions: object[], score: number}>}
 */
export function findTeams(graph, options = {}) {
  const _end = startSpan('synergy.findTeams');

  try {
  const {
    teamSize = 8, startChamps = [], maxResults = 20,
    level = null, emblems = [], excludedTraits = [], excludedChampions = [],
    max5Cost = null, lockedTraits = [],
  } = options;

  const { nodes, traitBreakpoints, traitMap, exclusionLookup = {} } = graph;
  const allowedSet = buildAllowedSet(graph, level, startChamps);
  const lockedSet = new Set(startChamps);

  // Default max 5-cost scales with level. User-provided max5Cost overrides.
  // lvl 9: comp is 4-cost centric, 5-costs are lucky spike (max 2).
  // lvl 10: 5-costs are peak board but algorithm should propose variety (max 3).
  // lvl <9: 5-costs hard-filtered by MIN_LEVEL_BY_COST so cap is moot.
  let effectiveMax5Cost = max5Cost;

  if (effectiveMax5Cost == null && level != null) {
    if (level === 9) {
      effectiveMax5Cost = 2;
    } else if (level >= 10) {
      effectiveMax5Cost = 3;
    }
  }

  const context = {
    emblems, excludedTraits, excludedChampions, level,
    max5Cost: effectiveMax5Cost,
    lockedChamps: startChamps,
    allowedSet,
    lockedSet,
    lockedTraits,
  };

  // RNG seed — deterministic from inputs, or randomized via options.seed
  let seed = (options.seed || 0) + teamSize * 1000 + startChamps.length * 100 + (level || 0);

  for (const s of startChamps) {
    for (let i = 0; i < s.length; i++) {
seed = (seed * 31 + s.charCodeAt(i)) | 0;
}
  }

  const rng = createRng(seed);

  const results = new Map();

  function addResult(team) {
    if (team.length !== teamSize) {
return;
}

    if (effectiveMax5Cost != null) {
      const fiveCount = team.filter(api => (nodes[api]?.cost || 0) === 5).length;

      if (fiveCount > effectiveMax5Cost) {
return;
}
    }

    // Validate exclusion groups — reject teams with conflicting members
    const teamSet = new Set(team);

    for (const api of team) {
      const conflicts = exclusionLookup[api];

      if (conflicts) {
        for (const c of conflicts) {
          if (teamSet.has(c)) {
return;
} // conflicting pair found — reject
        }
      }
    }

    const key = [...team].sort().join(',');

    if (results.has(key)) {
return;
}

    const score = quickScore(team, graph, emblems) - costPenalty(team, graph, level, lockedSet, effectiveMax5Cost);
    const champions = team.map(api => nodes[api]).filter(Boolean);

    if (champions.length !== team.length) {
return;
}

    results.set(key, { champions, score });
  }

  // ── Run phases ──────────────────────────────────
  const excludedSet = new Set(excludedChampions);
  const phaseCtx: PhaseContext = {
    graph, teamSize, startChamps, context, rng, maxResults,
    results, addResult, excludedSet, emblems, excludedTraits,
  };

  // Snapshot result keys that came out of the locked-trait phase.
  // These are teams we spent budget on specifically to satisfy the
  // user's trait locks — diversifyResults below caps the return at
  // `maxResults` and sorts by quickScore, which can push our
  // lock-satisfying teams out of the cut when other phases flood
  // the result map with generic high-quickScore comps. We snapshot
  // them here and splice them back in after diversify so the engine
  // post-filter still has something to keep.
  //
  // Null until lockedTraitSeeded runs inside the dispatch loop (it
  // has no skipWhen today, but using null-by-default instead of
  // pre-computing keeps us safe if a future skipWhen is added or
  // the phase is reordered out of first position).
  let lockedTraitSeedKeys: Set<string> | null = null;

  for (const { name, phase, skipWhen } of PHASES) {
    if (skipWhen && skipWhen(phaseCtx)) {
      continue;
    }

    const _e = startSpan(`synergy.phase.${name}`);
    phase(phaseCtx);
    _e();

    if (name === 'lockedTraitSeeded') {
      lockedTraitSeedKeys = new Set(results.keys());
    }
  }

  const _endDiversify = startSpan('synergy.diversify');
  const diverse = diversifyResults(results, maxResults, traitBreakpoints, emblems);
  _endDiversify();

  // Ensure every team the locked-trait phase generated survives the
  // diversifyResults cut. Without this splice the cut drops most of
  // them whenever the result map grows past `maxResults` — generic
  // phases (temperatureSweep, traitSeeded) can easily add 1000+
  // entries with higher quickScore numbers, pushing the
  // lock-satisfying teams out.
  if (lockedTraitSeedKeys && lockedTraitSeedKeys.size > 0) {
    const diverseKeys = new Set(
      diverse.map(t => t.champions.map(c => c.apiName).sort().join(',')),
    );

    for (const key of lockedTraitSeedKeys) {
      const team = results.get(key);

      if (!team) {
        continue;
      }

      const teamKey = team.champions.map(c => c.apiName).sort().join(',');

      if (diverseKeys.has(teamKey)) {
        continue;
      }

      diverse.push(team);
      diverseKeys.add(teamKey);
    }
  }

  return diverse;
  } finally {
    _end();
  }
}
