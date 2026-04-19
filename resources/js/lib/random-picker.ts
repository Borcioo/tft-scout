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
 * Pick one trait anchor. Only `public` traits — `unique` covers hero traits
 * that are too narrow to seed a whole comp. minUnits is the smallest breakpoint.
 */
export function pickRandomTrait(
    traits: Trait[],
    rng: Rng = defaultRng,
): RandomTraitLock | null {
    const pool = traits.filter((t) => t.category === 'public' && t.breakpoints.length > 0);
    const picked = uniform(pool, rng);
    if (!picked) return null;

    const minUnits = picked.breakpoints
        .map((b) => b.minUnits)
        .reduce((a, b) => (a < b ? a : b), picked.breakpoints[0].minUnits);

    return { apiName: picked.apiName, minUnits };
}

/** Uniformly sample one team from a result list; ignores the scout ranking. */
export function pickRandomFromTeams(
    teams: ScoredTeam[],
    rng: Rng = defaultRng,
): ScoredTeam | null {
    return uniform(teams, rng);
}
