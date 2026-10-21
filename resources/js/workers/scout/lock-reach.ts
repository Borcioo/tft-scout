/**
 * Trait-lock reach — how far a locked trait can go with the units the
 * player can field, and why a lock comes back empty.
 *
 * PURE — shared by the engine (tight-lock auto-promotion, impossible-lock
 * short-circuit) and the worker (empty-slate explanation for the UI).
 */

import { MIN_LEVEL_BY_COST } from './config';
import { traitAmount } from './trait-amount';
import type { Champion, LockIssue, Trait } from './types';

type ReachChampion = Pick<Champion, 'apiName' | 'cost' | 'traits'> & {
    traitAmounts?: Record<string, number> | null;
    variant?: string | null;
    lockOnly?: boolean;
};

type EmblemInput = string | { apiName: string; count?: number };
type TraitLockInput = string | { apiName: string; minUnits: number };

/**
 * Flat string[] of trait apiNames, one entry per physical emblem. Callers
 * pass either legacy string[] or [{apiName, count}]; downstream code
 * indexes by the entry, which silently drops object-shaped emblems.
 */
export function normalizeEmblems(emblems: EmblemInput[] = []): string[] {
    const out: string[] = [];

    for (const e of emblems) {
        if (typeof e === 'string') {
            out.push(e);
            continue;
        }

        const count = Math.max(1, Number(e?.count ?? 1));

        for (let i = 0; i < count; i++) {
            out.push(e.apiName);
        }
    }

    return out;
}

/** A bare string means "the trait must be active at all". */
export function normalizeTraitLocks(
    locks: TraitLockInput[] = [],
): { apiName: string; minUnits: number }[] {
    return locks.map((t) =>
        typeof t === 'string' ? { apiName: t, minUnits: 1 } : t,
    );
}

/** First level the scout fields a unit of this cost (shop odds ≥10%). */
export function minLevelForCost(cost: number): number {
    return (MIN_LEVEL_BY_COST as Record<number, number>)[cost || 1] ?? 1;
}

/**
 * Best-case count of `trait` and the units that reach it: one member per
 * exclusion group (the one contributing most — Lux forms, Mecha base vs
 * enhanced), weighted by trait amounts. Hero variants and bans never
 * count. With a `level`, gated units — not offered by the shop yet, or
 * lock-only — count only when the player locked them; `level: null`
 * lifts both gates.
 */
export function traitReach<C extends ReachChampion>(
    champions: C[],
    trait: string,
    opts: {
        excluded: Set<string>;
        locked: Set<string>;
        exclusionGroups: string[][];
        level: number | null;
    },
): { count: number; picks: C[] } {
    const groupOf: Record<string, string[]> = {};

    for (const group of opts.exclusionGroups) {
        for (const member of group) {
            groupOf[member] = group;
        }
    }

    const best: Record<string, { amount: number; champ: C }> = {};

    for (const c of champions) {
        if (c.variant === 'hero' || opts.excluded.has(c.apiName)) {
            continue;
        }

        if (
            opts.level &&
            !opts.locked.has(c.apiName) &&
            gateReason(c, opts.level) !== null
        ) {
            continue;
        }

        if (!c.traits.includes(trait)) {
            continue;
        }

        const key = groupOf[c.apiName]?.slice().sort().join('|') ?? c.apiName;
        const amount = traitAmount(c, trait);

        if (!best[key] || amount > best[key].amount) {
            best[key] = { amount, champ: c };
        }
    }

    let count = 0;
    const picks: C[] = [];

    for (const v of Object.values(best)) {
        count += v.amount;
        picks.push(v.champ);
    }

    return { count, picks };
}

/** Why the scout won't field `c` on its own at `level`, if it won't. */
function gateReason(
    c: ReachChampion,
    level: number,
): 'level' | 'lockOnly' | null {
    if (c.lockOnly) {
        return 'lockOnly';
    }

    return level < minLevelForCost(c.cost) ? 'level' : null;
}

/**
 * Trait locks the current constraints cannot reach, with what would close
 * the gap: units the scout won't field on its own — kept out by the level
 * gate or lock-only (the player may already own one; locking it lifts the
 * gate) — or nothing at all (pool, bans, emblems).
 */
export function findLockIssues(input: {
    champions: (ReachChampion &
        Pick<Champion, 'name'> & {
            baseApiName?: string | null;
        })[];
    traits: Pick<Trait, 'apiName' | 'name'>[];
    exclusionGroups?: string[][];
    constraints: {
        lockedChampions?: string[];
        excludedChampions?: string[];
        lockedTraits?: TraitLockInput[];
        emblems?: EmblemInput[];
    };
    level: number;
}): LockIssue[] {
    const {
        champions,
        traits,
        exclusionGroups = [],
        constraints,
        level,
    } = input;
    const excluded = new Set(constraints.excludedChampions ?? []);
    const locked = new Set<string>();

    for (const api of constraints.lockedChampions ?? []) {
        if (excluded.has(api)) {
            continue;
        }

        locked.add(api);

        // The engine plays a locked hero as its base champion
        const champ = champions.find((c) => c.apiName === api);

        if (champ?.variant === 'hero' && champ.baseApiName) {
            locked.add(champ.baseApiName);
        }
    }

    const emblems = normalizeEmblems(constraints.emblems);
    const traitName = Object.fromEntries(
        traits.map((t) => [t.apiName, t.name]),
    );
    const issues: LockIssue[] = [];

    for (const lock of normalizeTraitLocks(constraints.lockedTraits)) {
        const boost = emblems.filter((e) => e === lock.apiName).length;
        const opts = { excluded, locked, exclusionGroups };
        const atLevel = traitReach(champions, lock.apiName, {
            ...opts,
            level,
        });

        if (atLevel.count + boost >= lock.minUnits) {
            continue;
        }

        const ungated = traitReach(champions, lock.apiName, {
            ...opts,
            level: null,
        });

        issues.push({
            traitApiName: lock.apiName,
            traitName: traitName[lock.apiName] ?? lock.apiName,
            minUnits: lock.minUnits,
            reach: atLevel.count + boost,
            reachIgnoringLevel: ungated.count + boost,
            gatedUnits: ungated.picks.flatMap((c) => {
                const reason = locked.has(c.apiName)
                    ? null
                    : gateReason(c, level);

                return reason === null
                    ? []
                    : [
                          {
                              apiName: c.apiName,
                              name: c.name,
                              cost: c.cost,
                              amount: traitAmount(c, lock.apiName),
                              fromLevel: minLevelForCost(c.cost),
                              reason,
                          },
                      ];
            }),
        });
    }

    return issues;
}
