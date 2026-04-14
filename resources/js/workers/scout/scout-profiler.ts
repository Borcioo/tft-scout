// @ts-nocheck
/**
 * Env-gated span collector for measuring scout pipeline hot spots.
 *
 * Enabled by either:
 *   - Node: SCOUT_PROFILE=1 env var
 *   - Browser: globalThis.__SCOUT_PROFILE__ = true
 *
 * When disabled, startSpan returns a cached no-op closure so the hot
 * path pays essentially nothing. When enabled, each span contributes
 * one Map lookup + one subtraction + (on first hit per name) one Map
 * insertion — all aggregated across the scenario run.
 *
 * Usage:
 *
 *   const end = startSpan('engine.findTeams');
 *   try {
 *     // ...work...
 *   } finally {
 *     end();
 *   }
 *
 * Reports by summing `durationMs` per name and dividing by `count` if
 * you want a mean. Names are flat strings (no nesting) so the ordering
 * in the final table is trivial — sort by durationMs descending.
 */

type Span = { name: string; durationMs: number; count: number };

const spans = new Map<string, Span>();

function isEnabled(): boolean {
    if (typeof process !== 'undefined' && process.env && process.env.SCOUT_PROFILE === '1') {
        return true;
    }

    if (typeof globalThis !== 'undefined' && (globalThis as any).__SCOUT_PROFILE__ === true) {
        return true;
    }

    return false;
}

const NOOP = () => {};

export function startSpan(name: string): () => void {
    if (!isEnabled()) {
        return NOOP;
    }

    const t0 = performance.now();

    return () => {
        const dur = performance.now() - t0;
        const existing = spans.get(name);

        if (existing) {
            existing.durationMs += dur;
            existing.count += 1;
        } else {
            spans.set(name, { name, durationMs: dur, count: 1 });
        }
    };
}

export function resetProfiler(): void {
    spans.clear();
}

export function dumpProfile(): Span[] {
    return [...spans.values()].sort((a, b) => b.durationMs - a.durationMs);
}
