// resources/js/workers/scout/synergy-graph/graph.ts
//
// buildGraph — produces the synergy graph consumed by findTeams
// and every phase. Pure function of (champions, traits, scoringCtx).

// @ts-nocheck — parity with the monolith it came from; engine.ts
// already opts out of strict typing for the scout worker, and this
// file is a pure code move with zero semantic change. Strict typing
// is a separate sub-project.

import { SCORING_CONFIG } from '../config';
import { startSpan } from '../scout-profiler';
import type { Graph } from './types';

const { thresholds } = SCORING_CONFIG;

/**
 * Build synergy graph from champion and trait data.
 * @param {object[]} champions - domain objects with .apiName, .traits, .cost, etc.
 * @param {object[]} traits - domain objects with .apiName, .breakpoints
 * @param {object} scoringCtx - { unitRatings, traitRatings, styleScores, affinity }
 */
export function buildGraph(
    champions,
    traits,
    scoringCtx = {},
    exclusionLookup = {},
): Graph {
    const _end = startSpan('synergy.buildGraph');

    try {
        const nodes = {};

        for (const c of champions) {
            nodes[c.apiName] = c;
        }

        // Trait → champion apiNames
        const traitMap = {};

        for (const c of champions) {
            for (const t of c.traits) {
                if (!traitMap[t]) {
                    traitMap[t] = [];
                }

                traitMap[t].push(c.apiName);
            }
        }

        // Adjacency: champA → [{ champ, sharedTraits, traits }]
        const adjacency = {};

        for (const api of Object.keys(nodes)) {
            adjacency[api] = [];
        }

        for (const [trait, members] of Object.entries(traitMap)) {
            for (let i = 0; i < members.length; i++) {
                for (let j = i + 1; j < members.length; j++) {
                    const a = members[i],
                        b = members[j];
                    const existing = adjacency[a].find((e) => e.champ === b);

                    if (existing) {
                        existing.sharedTraits++;
                        existing.traits.push(trait);
                    } else {
                        adjacency[a].push({
                            champ: b,
                            sharedTraits: 1,
                            traits: [trait],
                        });
                        adjacency[b].push({
                            champ: a,
                            sharedTraits: 1,
                            traits: [trait],
                        });
                    }
                }
            }
        }

        // Trait breakpoint lookup: traitApiName → [minUnits...]
        const traitBreakpoints = {};

        for (const t of traits) {
            traitBreakpoints[t.apiName] = (t.breakpoints || [])
                .sort((a, b) => a.minUnits - b.minUnits)
                .map((bp) => bp.minUnits);
        }

        // Trait style lookup: traitApiName → { position → styleName }
        const traitStyles = {};

        for (const t of traits) {
            const styleMap = {};

            for (const bp of t.breakpoints || []) {
                styleMap[bp.position] = bp.style;
            }

            traitStyles[t.apiName] = styleMap;
        }

        // Add companion edges — champions that perform well together in real games
        // These create "hidden" graph connections beyond shared traits.
        //
        // MetaTFT reports variant champions under their base id (every Lux
        // form is `DA_Lux18_Base`, which isn't a node itself), so expand each
        // side to the nodes sharing that base.
        const companionData = scoringCtx.companions || {};
        const nodesByBase = {};

        for (const [api, node] of Object.entries(nodes)) {
            const base = node.baseApiName || api;

            if (!nodesByBase[base]) {
                nodesByBase[base] = [];
            }

            nodesByBase[base].push(api);
        }

        for (const [unitBase, companionList] of Object.entries(companionData)) {
            const units = nodesByBase[unitBase];

            if (!units || !companionList) {
                continue;
            }

            for (const comp of companionList) {
                const partners = nodesByBase[comp.companion];

                if (!partners) {
                    continue;
                }

                if (comp.games < thresholds.companionMinGames) {
                    continue;
                }

                for (const unitApi of units) {
                    for (const partner of partners) {
                        if (partner === unitApi) {
                            continue;
                        }

                        // Only add edge if not already connected via traits
                        const existing = adjacency[unitApi]?.find(
                            (e) => e.champ === partner,
                        );

                        if (!existing) {
                            adjacency[unitApi].push({
                                champ: partner,
                                sharedTraits: 0,
                                traits: [],
                                companionScore: comp.avgPlace,
                            });
                            adjacency[partner].push({
                                champ: unitApi,
                                sharedTraits: 0,
                                traits: [],
                                companionScore: comp.avgPlace,
                            });
                        }
                    }
                }
            }
        }

        return {
            nodes,
            traitMap,
            adjacency,
            traitBreakpoints,
            traitStyles,
            scoringCtx,
            exclusionLookup,
        };
    } finally {
        _end();
    }
}
