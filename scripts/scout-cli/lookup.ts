import type { Champion, ScoutContext, Trait } from '../../resources/js/workers/scout/types';

/**
 * Find a champion by case-insensitive apiName. Throws with the three
 * nearest matches if not found, so the caller can surface a helpful error.
 */
export function findChampion(ctx: ScoutContext, apiName: string): Champion {
    const lower = apiName.toLowerCase();
    const exact = ctx.champions.find((c) => c.apiName.toLowerCase() === lower);
    if (exact) return exact;
    const nearest = nearestNames(
        apiName,
        ctx.champions.map((c) => c.apiName),
    );
    throw new Error(
        `Unknown champion apiName: "${apiName}". Did you mean: ${nearest.join(', ')}?`,
    );
}

export function findTrait(ctx: ScoutContext, apiName: string): Trait {
    const lower = apiName.toLowerCase();
    const exact = ctx.traits.find((t) => t.apiName.toLowerCase() === lower);
    if (exact) return exact;
    const nearest = nearestNames(
        apiName,
        ctx.traits.map((t) => t.apiName),
    );
    throw new Error(
        `Unknown trait apiName: "${apiName}". Did you mean: ${nearest.join(', ')}?`,
    );
}

/** Map a list of apiNames to champions, throwing on the first unknown. */
export function findChampions(ctx: ScoutContext, apiNames: string[]): Champion[] {
    return apiNames.map((name) => findChampion(ctx, name));
}

/**
 * Return up to `k` candidates ranked by case-insensitive substring match
 * first, then by Levenshtein distance. Used only for error messages, so
 * a naive O(n * m) loop is fine for ~60 champions / ~30 traits.
 */
function nearestNames(query: string, pool: string[], k = 3): string[] {
    const q = query.toLowerCase();
    const scored = pool.map((name) => {
        const lname = name.toLowerCase();
        const substring = lname.includes(q) || q.includes(lname) ? 0 : 1;
        const distance = levenshtein(q, lname);
        return { name, substring, distance };
    });
    scored.sort((a, b) => {
        if (a.substring !== b.substring) return a.substring - b.substring;
        return a.distance - b.distance;
    });
    return scored.slice(0, k).map((s) => s.name);
}

function levenshtein(a: string, b: string): number {
    if (a === b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const prev: number[] = new Array(b.length + 1);
    const curr: number[] = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
        curr[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
        }
        for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
    }
    return prev[b.length];
}
