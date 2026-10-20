import { describe, expect, it } from 'vitest';

import { applyBronzeStacking } from '../scorer';

const bronze = (apiName: string, rawScore: number) => ({ apiName, activeIdx: 0, rawScore, near: false });

describe('applyBronzeStacking', () => {
    it('leaves a single Bronze at full value', () => {
        expect(applyBronzeStacking([bronze('A', 10)])[0].score).toBeCloseTo(10);
    });

    it('diminishes stacked Bronze by 0.6^k', () => {
        const out = applyBronzeStacking([bronze('A', 10), bronze('B', 10), bronze('C', 10)]);

        expect(out.reduce((s, r) => s + r.score, 0)).toBeCloseTo(10 + 6 + 3.6);
    });

    it('does not touch Silver and above', () => {
        const out = applyBronzeStacking([
            { apiName: 'S1', activeIdx: 1, rawScore: 20, near: false },
            { apiName: 'S2', activeIdx: 1, rawScore: 20, near: false },
            bronze('B1', 10),
            { apiName: 'G1', activeIdx: 2, rawScore: 30, near: false },
        ]);

        expect(out.map(r => r.score)).toEqual([20, 20, 10, 30]);
    });

    it('preserves input order but scales by descending raw score', () => {
        const out = applyBronzeStacking([bronze('A', 5), bronze('B', 10), bronze('C', 3)]);

        expect(out.map(r => r.apiName)).toEqual(['A', 'B', 'C']);
        expect(out[1].score).toBeCloseTo(10);
        expect(out[0].score).toBeCloseTo(5 * 0.6);
        expect(out[2].score).toBeCloseTo(3 * 0.36);
    });

    it('keeps negative Bronze out of the ranking', () => {
        const out = applyBronzeStacking([bronze('Bad', -5), bronze('Good', 10)]);

        expect(out[0].score).toBeCloseTo(-5);
        expect(out[1].score).toBeCloseTo(10);
    });

    it('handles empty input', () => {
        expect(applyBronzeStacking([])).toEqual([]);
    });
});
