// @ts-nocheck

import { buildOneTeam } from '../shared/team-builder';
import type { PhaseContext } from '../types';

/**
 * Ensure the team pool includes compositions seeded from each `slotsUsed=2`
 * variant (Mecha Enhanced in TFT17 — any future multi-slot variant will
 * be picked up automatically).
 *
 * Why a dedicated phase:
 *   Enhanced variants share their base's unit rating, so every other
 *   phase seeds them only by accident (if they happen to appear in a
 *   companion pair or a trait pool). The three Enhanced champions
 *   therefore rarely start a search and the generator ends up showing
 *   only base-only comps. This phase explicitly seeds each Enhanced
 *   champion one-at-a-time plus a few small combinations so the
 *   scorer gets to compare enhanced-heavy vs base-only teams on
 *   equal footing. It does NOT bias the result — no points added,
 *   no results favoured. Teams that don't earn a top score through
 *   normal scoring never reach `topN`.
 *
 * Cheap by design: at most ~7 seed shapes (3 single + 3 pair + 1 all),
 * each producing ~2 team variants via temperature sweep. Adds <1 ms
 * to total findTeams runtime.
 */
export function phaseVariantPairs(ctx: PhaseContext): void {
    const { graph, teamSize, context, rng, addResult, excludedSet } = ctx;

    const multiSlotVariants: string[] = [];
    for (const [api, node] of Object.entries(graph.nodes)) {
        if (!node) continue;
        if (excludedSet.has(api)) continue;
        if ((node as any).variant !== 'enhanced') continue;
        if (((node as any).slotsUsed ?? 1) < 2) continue;
        multiSlotVariants.push(api);
    }

    if (multiSlotVariants.length === 0) return;

    // Sort by baseApiName so Urgot_enhanced / AurelionSol_enhanced /
    // Galio_enhanced come out in a deterministic order every run.
    multiSlotVariants.sort();

    const seedShapes: string[][] = [];

    // Singletons — "what if I build a team around exactly THIS enhanced?"
    for (const api of multiSlotVariants) {
        seedShapes.push([api]);
    }

    // Pairs — enhanced pairs don't overlap on exclusion groups because
    // each has its own base, so all pairwise combinations are valid.
    for (let i = 0; i < multiSlotVariants.length; i++) {
        for (let j = i + 1; j < multiSlotVariants.length; j++) {
            seedShapes.push([multiSlotVariants[i], multiSlotVariants[j]]);
        }
    }

    // Full enhanced set — only bother when it fits in the slot budget.
    // teamSize is already in slots, so `multi.length * 2` is the cost.
    if (multiSlotVariants.length * 2 <= teamSize) {
        seedShapes.push([...multiSlotVariants]);
    }

    // Two temperatures per shape so filler picks aren't always the
    // same greedy top — gives diversity without enumerating every
    // permutation. Low temp = score-maximising; high = exploratory.
    const temperatures = [0.2, 0.7];

    for (const seeds of seedShapes) {
        for (const temperature of temperatures) {
            const team = buildOneTeam(
                graph,
                teamSize,
                seeds,
                context,
                temperature,
                rng,
            );
            if (team.length > 0) {
                addResult(team);
            }
        }
    }
}
