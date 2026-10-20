// @ts-nocheck

import { buildOneTeam } from '../shared/team-builder';
import type { PhaseContext } from '../types';

/**
 * Ensure the team pool includes compositions seeded from each
 * "multi-count" champion — one that takes 2+ slots or counts 2+ for a
 * trait: Mecha Enhanced in TFT17, Elder Dragon (2 slots, ×2 Riftbeast)
 * and the Lux forms (×2 on their element) in TFT18. Any future champion
 * with `slotsUsed > 1` or a `traitAmounts` entry is picked up
 * automatically.
 *
 * Why a dedicated phase:
 *   These champions share their base's unit rating (or have a single
 *   rating spread over many forms), so every other phase seeds them only
 *   by accident (if they happen to appear in a companion pair or a trait
 *   pool). Their value is in the double count, which only shows once
 *   the rest of the board leans into it. This phase explicitly seeds each
 *   one alone plus compatible pairs so the scorer gets to compare them
 *   with regular comps on equal footing. It does NOT bias the result —
 *   no points added, no results favoured. Teams that don't earn a top
 *   score through normal scoring never reach `topN`.
 *
 * Cheap by design: singletons + pairs that don't share an exclusion
 * group (Lux forms are mutually exclusive), each producing ~2 team
 * variants via temperature sweep. ~40 builds for TFT18, a few ms.
 */
export function phaseVariantPairs(ctx: PhaseContext): void {
    const { graph, teamSize, context, rng, addResult, excludedSet } = ctx;
    const exclusionLookup = graph.exclusionLookup ?? {};

    const multiCount: string[] = [];

    for (const [api, node] of Object.entries(graph.nodes)) {
        if (!node) {
continue;
}

        if (excludedSet.has(api)) {
continue;
}

        if (node.variant === 'hero') {
continue;
}

        if (context.allowedSet && !context.allowedSet.has(api)) {
continue;
}

        const slots = node.slotsUsed ?? 1;
        const maxAmount = Math.max(1, ...Object.values(node.traitAmounts ?? {}));

        if (slots < 2 && maxAmount < 2) {
continue;
}

        multiCount.push(api);
    }

    if (multiCount.length === 0) {
return;
}

    // Deterministic order every run.
    multiCount.sort();

    const slotsOf = (api: string): number => graph.nodes[api]?.slotsUsed ?? 1;
    const conflicts = (a: string, b: string): boolean =>
        exclusionLookup[a]?.has?.(b) || exclusionLookup[b]?.has?.(a) || false;

    const seedShapes: string[][] = [];

    // Singletons — "what if I build a team around exactly THIS one?"
    for (const api of multiCount) {
        seedShapes.push([api]);
    }

    // Pairs — skip same-group pairs (two Lux forms, base + enhanced).
    for (let i = 0; i < multiCount.length; i++) {
        for (let j = i + 1; j < multiCount.length; j++) {
            const [a, b] = [multiCount[i], multiCount[j]];

            if (conflicts(a, b)) {
continue;
}

            if (slotsOf(a) + slotsOf(b) > teamSize) {
continue;
}

            seedShapes.push([a, b]);
        }
    }

    // Full set — only when every member is compatible and it fits the
    // slot budget (TFT17's three Enhanced Mechas).
    const allCompatible = multiCount.every((a, i) =>
        multiCount.slice(i + 1).every(b => !conflicts(a, b)));
    const allSlots = multiCount.reduce((s, api) => s + slotsOf(api), 0);

    if (multiCount.length > 2 && allCompatible && allSlots <= teamSize) {
        seedShapes.push([...multiCount]);
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
