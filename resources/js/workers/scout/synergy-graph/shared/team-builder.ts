// resources/js/workers/scout/synergy-graph/shared/team-builder.ts
//
// buildOneTeam — core team-building primitive called by every phase.
// Takes a seed (anchor champions) + the graph and greedily assembles
// a valid team around it using quickScore + cost penalty + weighted
// candidate selection. Pure — no profiler spans, no side effects
// beyond the returned team object.
//
// costPenalty lives in ./cost-penalty (the scorer uses it too) and is
// re-exported here for the phases that import it from this module.
//
// Private helpers moved with buildOneTeam: weightedPick.

// @ts-nocheck

import { quickScore } from '../quick-score';
import type { Graph } from '../types';

import { costPenalty } from './cost-penalty';

// Re-exported for the phases that import it from here
export { costPenalty };

// ── Private helper of buildOneTeam ─────────────

function weightedPick(candidates, temperature, rng) {
    const poolSize = Math.min(
        candidates.length,
        Math.max(3, Math.round(12 * temperature)),
    );
    const w = [];

    for (let i = 0; i < poolSize; i++) {
        w.push((1 - temperature * 0.6) ** i);
    }

    const total = w.reduce((a, b) => a + b, 0);
    let rand = rng() * total;

    for (let i = 0; i < w.length; i++) {
        rand -= w[i];

        if (rand <= 0) {
            return candidates[i];
        }
    }

    return candidates[poolSize - 1];
}

// ── Team building ───────────────────────────────

export function buildOneTeam(
    graph: Graph,
    teamSize,
    startChamps,
    context,
    temperature,
    rng,
) {
    const { nodes, adjacency, exclusionLookup = {} } = graph;
    const {
        emblems = [],
        excludedChampions = [],
        max5Cost = null,
        lockedChamps = [],
        allowedSet = null,
    } = context;
    const excludedSet = new Set(excludedChampions);

    // Track 5-cost count to enforce limit during building
    let fiveCostCount = 0;

    // Locked champions ALWAYS stay — they are the user's hard constraint
    const lockedSet = new Set(lockedChamps.filter((api) => nodes[api]));
    // Defensive: filter non-locked seeds through allowedSet too, so any phase
    // that passes unfiltered seeds can't leak disallowed champions into a team.
    const seeds = startChamps.filter(
        (api) =>
            nodes[api] &&
            !lockedSet.has(api) &&
            (!allowedSet || allowedSet.has(api)),
    );

    // Budget for seeds = teamSize minus locked slots
    const seedBudget = teamSize - lockedSet.size;
    let validSeeds = seeds;

    if (validSeeds.length > seedBudget) {
        validSeeds.sort(
            (a, b) => (nodes[b]?.cost || 0) - (nodes[a]?.cost || 0),
        );
        validSeeds = validSeeds.slice(0, seedBudget);
    }

    const validStart = [...lockedSet, ...validSeeds];
    const team = [...validStart];
    const used = new Set(validStart);

    // Exclude conflicts of start champions + count 5-costs
    for (const api of validStart) {
        const conflicts = exclusionLookup[api];

        if (conflicts) {
            for (const c of conflicts) {
                excludedSet.add(c);
            }
        }

        if ((nodes[api]?.cost || 0) === 5) {
            fiveCostCount++;
        }
    }

    // teamSize is a SLOT budget (not a unit count) so that enhanced
    // Mecha (slotsUsed=2) can coexist with base champs on the same
    // board without the builder having to pre-compute champion counts.
    // Board capacity = level + any trait-rule bonuses (e.g. Mecha@6
    // Companion Mech). Score is unchanged; this only affects *stopping*
    // and *candidate filtering*.
    const slotsOf = (api: string): number => nodes[api]?.slotsUsed ?? 1;
    const currentSlots = (t: string[]): number =>
        t.reduce((s, api) => s + slotsOf(api), 0);

    while (currentSlots(team) < teamSize) {
        const candidates = [];
        const seen = new Set();
        const slotsLeft = teamSize - currentSlots(team);

        const atFiveCostLimit = max5Cost != null && fiveCostCount >= max5Cost;

        // Neighbors first
        for (const member of team) {
            for (const edge of adjacency[member] || []) {
                if (
                    used.has(edge.champ) ||
                    seen.has(edge.champ) ||
                    excludedSet.has(edge.champ)
                ) {
                    continue;
                }

                if (allowedSet && !allowedSet.has(edge.champ)) {
                    continue;
                }

                if (atFiveCostLimit && (nodes[edge.champ]?.cost || 0) === 5) {
                    continue;
                }

                // Skip if candidate doesn't fit in remaining slot budget.
                if (slotsOf(edge.champ) > slotsLeft) {
                    continue;
                }

                seen.add(edge.champ);
                const testTeam = [...team, edge.champ];
                const score =
                    quickScore(testTeam, graph, emblems, context.focusSet) -
                    costPenalty(
                        testTeam,
                        graph,
                        context.level,
                        context.lockedSet,
                        context.max5Cost,
                    );
                candidates.push({ champ: edge.champ, score });
            }
        }

        // Fill with non-neighbors if needed
        if (candidates.length < 15) {
            for (const api of Object.keys(nodes)) {
                if (used.has(api) || seen.has(api) || excludedSet.has(api)) {
                    continue;
                }

                if (allowedSet && !allowedSet.has(api)) {
                    continue;
                }

                if (atFiveCostLimit && (nodes[api]?.cost || 0) === 5) {
                    continue;
                }

                if (slotsOf(api) > slotsLeft) {
                    continue;
                }

                seen.add(api);
                const testTeam = [...team, api];
                const score =
                    quickScore(testTeam, graph, emblems, context.focusSet) -
                    costPenalty(
                        testTeam,
                        graph,
                        context.level,
                        context.lockedSet,
                        context.max5Cost,
                    );
                candidates.push({ champ: api, score });
            }
        }

        if (candidates.length === 0) {
            break;
        }

        candidates.sort((a, b) => b.score - a.score);

        // Penalize excluded traits
        if (context.excludedTraits?.length) {
            for (const c of candidates) {
                const node = nodes[c.champ];

                if (node) {
                    for (const t of node.traits) {
                        if (context.excludedTraits.includes(t)) {
                            c.score -= 15;
                        }
                    }
                }
            }

            candidates.sort((a, b) => b.score - a.score);
        }

        const pick = weightedPick(candidates, temperature, rng);

        if (!pick) {
            break;
        }

        team.push(pick.champ);
        used.add(pick.champ);

        if ((nodes[pick.champ]?.cost || 0) === 5) {
            fiveCostCount++;
        }

        // Exclude conflicting members from same exclusion group
        const conflicts = exclusionLookup[pick.champ];

        if (conflicts) {
            for (const c of conflicts) {
                excludedSet.add(c);
            }
        }
    }

    return team;
}
