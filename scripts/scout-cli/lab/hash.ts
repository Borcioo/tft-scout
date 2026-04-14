import { createHash } from 'node:crypto';

/**
 * Stable sha256 over a params object. Keys are sorted and null/undefined
 * values are dropped so semantically equal inputs always hash the same.
 */
export function paramsHash(params: Record<string, unknown>): string {
    return createHash('sha256').update(normalise(params)).digest('hex');
}

function normalise(value: unknown): string {
    if (value === null || value === undefined) return 'null';
    if (Array.isArray(value)) {
        return '[' + value.map(normalise).join(',') + ']';
    }
    if (typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, v]) => v !== null && v !== undefined)
            .sort(([a], [b]) => a.localeCompare(b));
        return '{' + entries.map(([k, v]) => `${k}:${normalise(v)}`).join(',') + '}';
    }
    return JSON.stringify(value);
}
