import { describe, expect, it } from 'vitest';

import { swapOut } from '../polish';

type U = { apiName: string; baseApiName?: string | null };
const u = (apiName: string, baseApiName: string | null = null): U => ({
    apiName,
    baseApiName,
});
// A board scores the sum of its units' values; Bad breaks a constraint
const value: Record<string, number> = { A: 1, B: 1, K: 9, X: 3, Y: 5 };
const opts = {
    pool: [u('K'), u('X'), u('Y'), u('Bad'), u('Lux_Sun', 'Lux')],
    fixed: new Set<string>(),
    conflictKey: (api: string) => api,
    evaluate: (champions: U[]) =>
        champions.some((c) => c.apiName === 'Bad')
            ? null
            : {
                  champions,
                  score: champions.reduce(
                      (s, c) => s + (value[c.apiName] ?? 0),
                      0,
                  ),
              },
};
const team = (apis: U[]) => {
    const t = opts.evaluate(apis);

    if (!t) {
        throw new Error('test board breaks a constraint');
    }

    return t;
};
const names = (t: { champions: U[] } | null) =>
    t?.champions.map((c) => c.apiName);

describe('swapOut', () => {
    it('replaces the unit with the best legal one that is not out', () => {
        const t = swapOut(team([u('A'), u('K'), u('B')]), new Set(['K']), opts);

        expect(names(t)).toEqual(['A', 'Y', 'B']);
    });

    it('matches forms by base apiName and keeps locked units', () => {
        const withLux = team([u('A'), u('Lux_Moon', 'Lux')]);

        // Any Lux form is out; K is the best of the rest
        expect(names(swapOut(withLux, new Set(['Lux']), opts))).toEqual([
            'A',
            'K',
        ]);
        expect(
            names(
                swapOut(withLux, new Set(['Lux']), {
                    ...opts,
                    fixed: new Set(['Lux_Moon']),
                }),
            ),
        ).toEqual(['A', 'Lux_Moon']);
    });

    it('gives up when nothing legal can replace the unit', () => {
        expect(
            swapOut(team([u('A'), u('K')]), new Set(['K']), {
                ...opts,
                pool: [u('K'), u('Bad')],
            }),
        ).toBeNull();
    });
});
