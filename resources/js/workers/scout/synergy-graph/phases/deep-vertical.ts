// resources/js/workers/scout/synergy-graph/phases/deep-vertical.ts

// @ts-nocheck

import { SCORING_CONFIG } from '../../config';
import { traitAmount } from '../../trait-amount';
import { buildOneTeam } from '../shared/team-builder';
import type { PhaseContext } from '../types';

const { thresholds } = SCORING_CONFIG;

export function phaseDeepVertical(ctx: PhaseContext): void {
    const {
        graph,
        teamSize,
        startChamps,
        context,
        rng,
        maxResults,
        results,
        addResult,
        excludedSet,
        excludedTraits,
        emblems,
    } = ctx;
    const { traitBreakpoints, traitMap } = graph;
    const { traitRatings = {} } = graph.scoringCtx || {};

    for (const [trait, members] of Object.entries(traitMap)) {
        const bps = traitBreakpoints[trait] || [];

        if (bps.length < 2 || bps[0] <= 1) {
            continue;
        }

        if (excludedTraits.includes(trait)) {
            continue;
        }

        const startSet = new Set(startChamps);
        const available = members.filter(
            (m) =>
                !excludedSet.has(m) &&
                !startSet.has(m) &&
                (!context.allowedSet || context.allowedSet.has(m)),
        );
        // Trait counts, not head counts — Lux forms / Elder Dragon count 2.
        const amountOf = (api) => traitAmount(graph.nodes[api], trait);
        const startMembersInTrait = startChamps
            .filter((s) => members.includes(s))
            .reduce((sum, api) => sum + amountOf(api), 0);
        const availableAmount = available.reduce(
            (sum, api) => sum + amountOf(api),
            0,
        );
        const rawEmblemCount = emblems.filter((e) => e === trait).length;

        for (let bpIdx = bps.length - 1; bpIdx >= 1; bpIdx--) {
            const targetUnits = bps[bpIdx];
            const rating = traitRatings[trait]?.[bpIdx + 1];

            if (
                !rating ||
                rating.avgPlace > thresholds.deepVerticalMaxAvg ||
                rating.games < thresholds.phaseMinGames
            ) {
                continue;
            }

            // Emblems are capped by non-trait champions available to hold them
            // At most (teamSize - traitMembers) champions won't have this trait
            const maxTraitMembers = startMembersInTrait + availableAmount;
            const nonTraitSlots = Math.max(
                0,
                teamSize - Math.min(maxTraitMembers, teamSize),
            );
            const emblemCount = Math.min(rawEmblemCount, nonTraitSlots);
            const needed = targetUnits - startMembersInTrait - emblemCount;

            if (needed <= 0 || availableAmount < needed) {
                continue;
            }

            // Breakpoint targeting
            for (let a = 0; a < 5; a++) {
                const shuffled = [...available].sort(() => rng() - 0.5);
                const picked = [];
                let have = 0;

                for (const api of shuffled) {
                    if (have >= needed) {
                        break;
                    }

                    picked.push(api);
                    have += amountOf(api);
                }

                const seeds = [...new Set([...startChamps, ...picked])];
                addResult(
                    buildOneTeam(
                        graph,
                        teamSize,
                        seeds,
                        context,
                        0.1 + rng() * 0.15,
                        rng,
                    ),
                );
            }

            // All-in: seed every available member
            if (availableAmount > needed && available.length <= teamSize) {
                for (let a = 0; a < 3; a++) {
                    const allIn = [...new Set([...startChamps, ...available])];
                    addResult(
                        buildOneTeam(
                            graph,
                            teamSize,
                            allIn,
                            context,
                            0.05 + rng() * 0.1,
                            rng,
                        ),
                    );
                }
            }
        }

        if (results.size >= maxResults * 8) {
            break;
        }
    }
}
