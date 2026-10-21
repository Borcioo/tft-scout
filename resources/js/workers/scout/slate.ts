/**
 * The slate: which of the ranked teams the player sees.
 *
 * Walks teams best first and keeps each unless it shares
 * dedupeOverlapPct of its core with a kept one (a 1–2 swap permutation of
 * the same comp), or its family — teams sharing familyOverlapPct — already
 * has perFamily members. A second walk fills the slate without the family
 * cap when the pool runs out; duplicates stay out. Each team is polished
 * as it is picked, against the same rule (see engine.ts), so it is a local
 * optimum among boards different from the ones above it.
 *
 * PURE. Cores are compared as given; the caller leaves locked units out of
 * them, since those are on every team.
 */

export type SlateRules = {
    topN: number;
    dedupeOverlapPct: number;
    familyOverlapPct: number;
    perFamily: number;
};

function overlap(core: Set<string>, kept: Set<string>): number {
    let shared = 0;

    for (const api of core) {
        if (kept.has(api)) {
            shared++;
        }
    }

    const size = Math.max(core.size, kept.size);

    return size > 0 ? shared / size : 1;
}

export function pickSlate<T>(
    ranked: T[],
    rules: SlateRules,
    coreOf: (team: T) => Set<string>,
    /** Improve a team; `allowed` says which boards it may turn into. */
    polish: (team: T, allowed: (team: T) => boolean) => T = (team) => team,
): T[] {
    const slate: T[] = [];
    const cores: Set<string>[] = [];
    const taken = new Set<T>();
    const blocked = (core: Set<string>, capFamilies: boolean) => {
        let family = 0;

        for (const kept of cores) {
            const o = overlap(core, kept);

            if (o >= rules.dedupeOverlapPct) {
                return true;
            }

            if (o >= rules.familyOverlapPct) {
                family++;
            }
        }

        return capFamilies && family >= rules.perFamily;
    };

    for (const capFamilies of [true, false]) {
        for (const team of ranked) {
            if (slate.length >= rules.topN) {
                return slate;
            }

            if (taken.has(team) || blocked(coreOf(team), capFamilies)) {
                continue;
            }

            const picked = polish(
                team,
                (t) => !blocked(coreOf(t), capFamilies),
            );

            taken.add(team);
            slate.push(picked);
            cores.push(coreOf(picked));
        }
    }

    return slate;
}
