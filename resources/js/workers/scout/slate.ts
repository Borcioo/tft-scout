/**
 * The slate: which of the ranked teams the player sees.
 *
 * Walks teams best first and keeps each unless it shares
 * dedupeOverlapPct of its core with a kept one (a 1–2 swap permutation of
 * the same comp), its family — teams sharing familyOverlapPct — already
 * has perFamily members, one of its labels (title traits) already heads
 * perLabel kept teams, or one of its units is already in perUnitShare of
 * the slate — unless swapping those over-used units out (repair) gives a
 * board the rules allow, which is kept instead: the search leans on its
 * favourite units, and without this a level 9 pool was 38 Kayle teams of
 * 43. A second walk fills the slate without these caps when the pool
 * runs out; duplicates stay out. Each
 * team is polished as it is picked, against the same rule (see
 * engine.ts), so it is a local optimum among boards different from the
 * ones above it.
 *
 * PURE. Cores and labels are taken as given; the caller leaves locked
 * units out of cores and their traits out of labels — those are on every
 * team.
 */

export type SlateRules = {
    topN: number;
    dedupeOverlapPct: number;
    familyOverlapPct: number;
    perFamily: number;
    /** Teams that may share one label (title trait, see titleTraits). */
    perLabel: number;
    /** Share of the slate one (unlocked) unit may appear in. */
    perUnitShare: number;
};

/** Trait styles, strongest first, as the card ranks them. */
export const STYLE_RANK: Record<string, number> = {
    Prismatic: 4,
    Gold: 3,
    Silver: 2,
    Bronze: 1,
};

/**
 * The two traits a comp is named by — what the player reads as "the
 * comp" ("3 Solar + 4 Lunar"): highest style first, then most units;
 * unique traits never. Shared by the card title and the slate.
 */
export function titleTraits<T extends { count: number }>(
    traits: T[],
    styleOf: (t: T) => string | null | undefined,
): T[] {
    const rank = (t: T) => STYLE_RANK[styleOf(t) ?? 'Bronze'] ?? 0;

    return traits
        .filter((t) => (styleOf(t) ?? 'Bronze') !== 'Unique')
        .sort((a, b) => rank(b) - rank(a) || b.count - a.count)
        .slice(0, 2);
}

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
    labelsOf: (team: T) => string[] = () => [],
    /** The team without these units, on a board `allowed` accepts. */
    repair: (
        team: T,
        out: ReadonlySet<string>,
        allowed: (team: T) => boolean,
    ) => T | null = () => null,
): T[] {
    const slate: T[] = [];
    const cores: Set<string>[] = [];
    const labelUses = new Map<string, number>();
    const unitUses = new Map<string, number>();
    const perUnit = Math.max(1, Math.ceil(rules.topN * rules.perUnitShare));
    const taken = new Set<T>();
    const blocked = (team: T, capped: boolean) => {
        const core = coreOf(team);
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

        return (
            capped &&
            (family >= rules.perFamily ||
                labelsOf(team).some(
                    (l) => (labelUses.get(l) ?? 0) >= rules.perLabel,
                ) ||
                [...core].some((u) => (unitUses.get(u) ?? 0) >= perUnit))
        );
    };

    for (const capped of [true, false]) {
        for (const team of ranked) {
            if (slate.length >= rules.topN) {
                return slate;
            }

            if (taken.has(team)) {
                continue;
            }

            const allowed = (t: T) => !blocked(t, capped);
            let start: T | null = team;

            if (!allowed(team)) {
                const over = new Set(
                    [...coreOf(team)].filter(
                        (u) => (unitUses.get(u) ?? 0) >= perUnit,
                    ),
                );
                start =
                    capped && over.size > 0
                        ? repair(team, over, allowed)
                        : null;
            }

            if (start === null) {
                continue;
            }

            const picked = polish(start, allowed);

            taken.add(team);
            slate.push(picked);
            cores.push(coreOf(picked));

            for (const u of coreOf(picked)) {
                unitUses.set(u, (unitUses.get(u) ?? 0) + 1);
            }

            for (const l of labelsOf(picked)) {
                labelUses.set(l, (labelUses.get(l) ?? 0) + 1);
            }
        }
    }

    return slate;
}
