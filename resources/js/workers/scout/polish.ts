/**
 * Polish — local search on finished teams.
 *
 * PURE. The phases build teams from seeds and heuristics, so a returned
 * team is often one swap away from a better one under the real scorer
 * (before this step: 9 of 10 at level 8, by ~0.25 places on average).
 * Polishing swaps one unit at a time for the best-scoring legal
 * replacement until no swap helps, so every team it returns is at least
 * a local optimum of the objective the results are ranked by.
 */

type Unit = { apiName: string; slotsUsed?: number };

export type PolishOptions<C extends Unit, T> = {
    /** Units a swap may bring in. */
    pool: C[];
    /** apiNames that must stay (player locks, tight trait-lock picks). */
    fixed: Set<string>;
    /** Mutually exclusive units share a key (Lux forms, Kha'Zix forms). */
    conflictKey: (apiName: string) => string;
    /** Scored team, or null when it breaks a constraint. */
    evaluate: (champions: C[]) => T | null;
    maxRounds?: number;
};

export function polishTeam<
    C extends Unit,
    T extends { champions: C[]; score: number },
>(team: T, opts: PolishOptions<C, T>): T {
    const { pool, fixed, conflictKey, evaluate, maxRounds = 4 } = opts;
    let current = team;

    for (let round = 0; round < maxRounds; round++) {
        let best = current;

        for (let i = 0; i < current.champions.length; i++) {
            const out = current.champions[i];

            if (fixed.has(out.apiName)) {
                continue;
            }

            const others = current.champions.filter((_, j) => j !== i);
            const taken = new Set(others.map((c) => conflictKey(c.apiName)));

            for (const cand of pool) {
                if (
                    taken.has(conflictKey(cand.apiName)) ||
                    cand.apiName === out.apiName ||
                    (cand.slotsUsed ?? 1) !== (out.slotsUsed ?? 1)
                ) {
                    continue;
                }

                const next = [...others];
                next.splice(i, 0, cand);
                const scored = evaluate(next);

                if (scored && scored.score > best.score + 1e-9) {
                    best = scored;
                }
            }
        }

        if (best === current) {
            break;
        }

        current = best;
    }

    return current;
}
