import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Drop-in useState replacement that persists to a URL query param.
 *
 * - Initial render reads from `window.location.search`; missing param
 *   falls back to `defaultValue`.
 * - Updates write via `history.replaceState` so there's no navigation,
 *   no Inertia reload, and browser back-button isn't polluted.
 * - `serialize` returning `null` removes the param from the URL (used
 *   to keep default values out of the query string — short URLs).
 *
 * NOT reactive to external URL changes (e.g. browser back/forward). That
 * would require a popstate listener; not needed for Scout which owns
 * the URL state end-to-end.
 */
export function useUrlState<T>(
    key: string,
    defaultValue: T,
    parse: (raw: string) => T,
    serialize: (value: T) => string | null,
): [T, (value: T) => void] {
    // Read-once initialiser. On SSR `window` is undefined — fall back to
    // default. Inertia hydrates on the client so the effect below
    // reconciles the URL on first client render.
    const [value, setValue] = useState<T>(() => {
        if (typeof window === 'undefined') return defaultValue;
        const params = new URLSearchParams(window.location.search);
        const raw = params.get(key);
        if (raw === null) return defaultValue;
        try {
            return parse(raw);
        } catch {
            return defaultValue;
        }
    });

    // Skip the first effect run — initial state already reflects URL,
    // writing it back would be a no-op + one extra history entry.
    const isFirstRender = useRef(true);
    useEffect(() => {
        if (isFirstRender.current) {
            isFirstRender.current = false;
            return;
        }
        if (typeof window === 'undefined') return;
        const params = new URLSearchParams(window.location.search);
        const serialized = serialize(value);
        if (serialized === null || serialized === '') {
            params.delete(key);
        } else {
            params.set(key, serialized);
        }
        const qs = params.toString();
        const url =
            window.location.pathname +
            (qs ? '?' + qs : '') +
            window.location.hash;
        window.history.replaceState(null, '', url);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, value]);

    const set = useCallback((v: T) => setValue(v), []);
    return [value, set];
}

// ── Codecs for common param shapes ─────────────────────────────────

/** Integer with default. Omit from URL when equal to default. */
export function intCodec(defaultValue: number) {
    return {
        parse: (raw: string) => {
            const n = parseInt(raw, 10);
            return Number.isFinite(n) ? n : defaultValue;
        },
        serialize: (v: number) =>
            v === defaultValue ? null : String(v),
    };
}

/** Nullable integer. `null` → param absent. */
export const nullableIntCodec = {
    parse: (raw: string): number | null => {
        const n = parseInt(raw, 10);
        return Number.isFinite(n) ? n : null;
    },
    serialize: (v: number | null) => (v === null ? null : String(v)),
};

/** CSV of strings (e.g. champion apiNames). Empty array → absent. */
export const csvCodec = {
    parse: (raw: string): string[] =>
        raw === '' ? [] : raw.split(',').filter(Boolean),
    serialize: (v: string[]) => (v.length === 0 ? null : v.join(',')),
};

/**
 * CSV of `apiName:N` pairs for locked traits / emblems:
 * "TFT17_DRX:4,TFT17_Anima:2" ↔ [{apiName, minUnits|count: 4}, ...]
 */
export function keyValueListCodec<K extends string>(valueKey: K) {
    return {
        parse: (raw: string): Array<{ apiName: string } & Record<K, number>> => {
            if (raw === '') return [];
            return raw
                .split(',')
                .map((pair) => {
                    const [api, nStr] = pair.split(':');
                    const n = parseInt(nStr ?? '', 10);
                    if (!api || !Number.isFinite(n)) return null;
                    return { apiName: api, [valueKey]: n } as { apiName: string } & Record<K, number>;
                })
                .filter(
                    (x): x is { apiName: string } & Record<K, number> =>
                        x !== null,
                );
        },
        serialize: (v: Array<{ apiName: string } & Record<K, number>>) =>
            v.length === 0
                ? null
                : v.map((e) => `${e.apiName}:${e[valueKey]}`).join(','),
    };
}
