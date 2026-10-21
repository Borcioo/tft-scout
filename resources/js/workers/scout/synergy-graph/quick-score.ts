// resources/js/workers/scout/synergy-graph/quick-score.ts
//
// quickScore — score of a candidate team during the search, on the same
// scale and the same model as scorer.teamScore (strength.ts + role
// balance + trait overflow), so the phases climb towards what the final
// ranking rewards.
// Callers subtract costPenalty themselves, as the scorer does, and pass
// the player's locked units as focus, as the engine does.

// @ts-nocheck

import { overflowPenalty, roleBalancePenalty } from '../scorer';
import { activeLevels, boardStrength, STRENGTH } from '../strength';
import { traitAmount } from '../trait-amount';
import { applyEmblems } from './shared/emblems';
import type { Graph } from './types';

export function quickScore(
    champApis,
    graph: Graph,
    emblems = [],
    focus: ReadonlySet<string> | null = null,
) {
    const { nodes, traitBreakpoints, scoringCtx } = graph;
    const team = champApis.map((api) => nodes[api]).filter(Boolean);
    const traitCounts = {};

    for (const node of team) {
        for (const t of node.traits) {
            traitCounts[t] = (traitCounts[t] || 0) + traitAmount(node, t);
        }
    }

    applyEmblems(
        traitCounts,
        emblems,
        team.map((node) => new Set(node.traits)),
    );

    // traitBreakpoints holds sorted minUnits; positions follow that order
    const levels = activeLevels(traitCounts, (t) =>
        (traitBreakpoints[t] || []).map((minUnits, i) => ({
            minUnits,
            position: i + 1,
        })),
    );
    const { focused } = boardStrength(team, levels, scoringCtx, focus);
    const overflow = overflowPenalty(
        traitCounts,
        (t) => traitBreakpoints[t] || [],
    );

    return (
        (STRENGTH.baseline -
            focused -
            roleBalancePenalty(team) / 100 -
            overflow) *
        100
    );
}
