import type { Champion, Trait, ScoredTeam } from '@/workers/scout/types';

export type CostTier = 'random' | 2 | 3 | 4;
export type RandomTraitLock = { apiName: string; minUnits: number };

export type Rng = () => number;

function defaultRng(): number {
    return Math.random();
}

function uniform<T>(pool: T[], rng: Rng): T | null {
    if (pool.length === 0) return null;
    const idx = Math.floor(rng() * pool.length);
    // Math.random can return exactly 1 only on pathological runtimes, but
    // clamp anyway so rng()==1 doesn't land on pool[pool.length] (undefined).
    return pool[Math.min(idx, pool.length - 1)];
}

/**
 * Pick one carry anchor from the champion pool.
 *
 * Filter: roleCategory !== 'frontline' (drops tanks / pure bruisers).
 * Cost tier: 'random' samples from the full DPS pool; a numeric tier restricts
 * to champions with that exact cost.
 * Hero variants are excluded — we never lock a hero directly because the
 * engine would force its signature trait and starve the builder.
 */
export function pickRandomCarry(
    champions: Champion[],
    tier: CostTier,
    rng: Rng = defaultRng,
): Champion | null {
    const pool = champions.filter((c) => {
        if (c.roleCategory === 'frontline') return false;
        if (c.variant === 'hero') return false;
        if (tier !== 'random' && c.cost !== tier) return false;
        return true;
    });
    return uniform(pool, rng);
}

/**
 * Max slots a trait can reach from the champion pool WITHOUT emblems.
 * Groups champions by `baseApiName ?? apiName` (base + enhanced variants
 * share a base id and are mutually exclusive on the board), picks the
 * max slotsUsed per group, sums. Hero variants excluded — they never
 * appear in random seeds.
 *
 * Example: 3 unique Mecha bases where each has an enhanced variant
 * (slotsUsed=2) → 3 groups × 2 slots = 6, so Mecha ≥ 6 is reachable.
 */
function maxAchievableSlots(champions: Champion[], traitApi: string): number {
    const groupBest = new Map<string, number>();

    for (const c of champions) {
        if (c.variant === 'hero') continue;
        if (!c.traits.includes(traitApi)) continue;

        const groupKey = c.baseApiName ?? c.apiName;
        const slots = c.slotsUsed ?? 1;
        const prev = groupBest.get(groupKey) ?? 0;

        if (slots > prev) groupBest.set(groupKey, slots);
    }

    let sum = 0;
    for (const s of groupBest.values()) sum += s;

    return sum;
}

/**
 * Pick one trait anchor. Only `public` traits — `unique` covers hero traits
 * that are too narrow to seed a whole comp.
 *
 * minUnits = MAX breakpoint reachable from the champion pool without
 * emblems. Traits whose smallest breakpoint already needs an emblem are
 * dropped from the pool entirely (no point rolling a lock that forces
 * the scout engine to flag it impossible).
 */
export function pickRandomTrait(
    traits: Trait[],
    champions: Champion[],
    rng: Rng = defaultRng,
): RandomTraitLock | null {
    type Candidate = { apiName: string; minUnits: number };
    const candidates: Candidate[] = [];

    for (const t of traits) {
        if (t.category !== 'public') continue;
        if (t.breakpoints.length === 0) continue;

        const maxSlots = maxAchievableSlots(champions, t.apiName);
        if (maxSlots === 0) continue;

        let bestBp = 0;
        for (const bp of t.breakpoints) {
            if (bp.minUnits <= maxSlots && bp.minUnits > bestBp) {
                bestBp = bp.minUnits;
            }
        }

        if (bestBp > 0) candidates.push({ apiName: t.apiName, minUnits: bestBp });
    }

    const picked = uniform(candidates, rng);
    if (!picked) return null;

    return { apiName: picked.apiName, minUnits: picked.minUnits };
}

/** Uniformly sample one team from a result list; ignores the scout ranking. */
export function pickRandomFromTeams(
    teams: ScoredTeam[],
    rng: Rng = defaultRng,
): ScoredTeam | null {
    return uniform(teams, rng);
}
