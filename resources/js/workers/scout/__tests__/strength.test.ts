import { describe, expect, it } from 'vitest';

import { teamScore, teamScoreBreakdown } from '../scorer';
import {
    activeLevels,
    boardStrength,
    estimatedAvgPlace,
    STRENGTH,
} from '../strength';
import { unscoredTraits } from '../trait-amount';

// Synthetic MetaTFT stats: enough games that shrinkage barely moves them
const ctx = {
    unitRatings: {
        A: { avgPlace: 4.0, games: 1e6 },
        B: { avgPlace: 4.4, games: 1e6 },
        C: { avgPlace: 4.6, games: 1e6 },
        Few: { avgPlace: 2.0, games: 10 },
        KhaZix: { avgPlace: 4.5, games: 1e6 },
        Rengar: { avgPlace: 4.5, games: 1e6 },
    },
    companions: {
        // A does 0.4 better with B on the board
        A: [{ companion: 'B', avgPlace: 3.6, games: 1e6 }],
    },
    affinity: {
        // C does 0.3 better at Bruiser level 2 only
        C: [{ trait: 'Bruiser', breakpoint: 2, avgPlace: 4.3, games: 1e6 }],
        B: [{ trait: 'Rival', breakpoint: 1, avgPlace: 3.9, games: 1e6 }],
    },
};
const unit = (apiName: string, extra = {}) => ({
    apiName,
    traits: [] as string[],
    ...extra,
});
const place = (champs: any[], levels: any[] = []) =>
    boardStrength(champs, levels, ctx).place;
const close = (x: number, y: number) => expect(x).toBeCloseTo(y, 3);

describe('boardStrength', () => {
    it('averages unit bases, so board size does not inflate it', () => {
        close(place([unit('A'), unit('C')]), 4.3);
        close(place([unit('A'), unit('C'), unit('A'), unit('C')]), 4.3);
    });

    it('pulls a thin sample towards the lobby average', () => {
        const few = place([unit('Few')]);

        expect(few).toBeGreaterThan(4.0);
        expect(few).toBeLessThan(STRENGTH.baseline);
    });

    it('rewards units that place better together', () => {
        const apart = place([unit('A'), unit('C')]);
        const together = place([unit('A'), unit('B')]);
        // A's 0.4 lift, weighted, over two units
        const lift = (STRENGTH.pairWeight * -0.4) / 2;

        close(together, (4.0 + 4.4) / 2 + lift);
        expect(together).toBeLessThan(apart);
    });

    it('applies a trait lift only at its breakpoint', () => {
        const at2 = place([unit('C')], [{ trait: 'Bruiser', position: 2 }]);
        const at1 = place([unit('C')], [{ trait: 'Bruiser', position: 1 }]);

        close(at1, 4.6);
        close(at2, 4.6 + STRENGTH.traitWeight * -0.3);
    });

    it("ignores Rival lifts while Kha'Zix is the only Rival", () => {
        const khazix = unit('KhaZix', {
            traits: ['Rival'],
            unscoredTraits: ['Rival'],
        });
        const rival = [{ trait: 'Rival', position: 1 }];

        expect([...unscoredTraits([khazix, unit('B')])]).toEqual(['Rival']);
        close(place([khazix, unit('B')], rival), (4.5 + 4.4) / 2);

        const rengar = unit('Rengar', { traits: ['Rival'] });
        expect(place([khazix, unit('B'), rengar], rival)).toBeLessThan(
            place([khazix, unit('B'), rengar]),
        );
    });
});

describe('activeLevels', () => {
    const bps = {
        Rival: [
            { minUnits: 1, position: 1 },
            { minUnits: 1, position: 2 },
            { minUnits: 2, position: 3 },
        ],
        Coven: [
            { minUnits: 3, position: 1 },
            { minUnits: 5, position: 2 },
        ],
    };

    it('takes the first of breakpoints sharing a unit count', () => {
        expect(activeLevels({ Rival: 1 }, (t) => bps[t as 'Rival'])).toEqual([
            { trait: 'Rival', position: 1 },
        ]);
        expect(activeLevels({ Rival: 2 }, (t) => bps[t as 'Rival'])).toEqual([
            { trait: 'Rival', position: 3 },
        ]);
    });

    it('skips traits below their first breakpoint', () => {
        expect(activeLevels({ Coven: 2 }, (t) => bps[t as 'Coven'])).toEqual(
            [],
        );
        expect(activeLevels({ Coven: 6 }, (t) => bps[t as 'Coven'])).toEqual([
            { trait: 'Coven', position: 2 },
        ]);
    });
});

describe('teamScore', () => {
    const board = (champions: any[], level = 8) => ({
        champions,
        activeTraits: [],
        level,
    });
    const tank = (apiName: string) =>
        unit(apiName, { role: 'ADTank', cost: 1 });
    const carry = (apiName: string) =>
        unit(apiName, { role: 'ADCarry', cost: 1 });

    it('is hundredths of a place better than the lobby average', () => {
        // One unit per cost tier stays inside the level 8 shop-odds caps
        const team = board(
            [tank('A'), tank('C'), carry('A'), carry('C')].map((c, i) => ({
                ...c,
                cost: i + 1,
            })),
        );
        const parts = teamScoreBreakdown(team, ctx);

        close(parts.place, 4.3);
        expect(parts.avgPlace).toBeCloseTo(
            estimatedAvgPlace(parts.place, 4),
            2,
        );
        expect(parts.beyondData).toBe(0);
        expect(teamScore(team, ctx)).toBeCloseTo(20, 1);
        expect(parts.total).toBe(teamScore(team, ctx));
    });

    it('charges role and cost penalties in places', () => {
        const noTank = board([carry('A'), carry('C'), carry('A'), carry('C')]);
        // no frontline: +0.30 places
        expect(teamScoreBreakdown(noTank, ctx).roles).toBeCloseTo(0.3, 3);

        const fiveCosts = board(
            [tank('A'), tank('C'), carry('A'), carry('C')].map((c) => ({
                ...c,
                cost: 5,
            })),
            7,
        );
        // level 7 offers 5-costs at 1%: one is tolerated, three over the cap
        expect(teamScoreBreakdown(fiveCosts, ctx).cost).toBeCloseTo(0.36, 3);
    });
});

describe('estimatedAvgPlace', () => {
    it('maps the raw scale onto real placements, floor to 8', () => {
        const { intercepts, slope, floor } = STRENGTH.calibration;

        close(estimatedAvgPlace(4, 8), intercepts[8] + 4 * slope);
        // Size 7..9; smaller and bigger boards use the nearest fit
        close(estimatedAvgPlace(4, 4), estimatedAvgPlace(4, 7));
        close(estimatedAvgPlace(4, 10), estimatedAvgPlace(4, 9));
        // At equal raw place a level-9 board places better
        expect(estimatedAvgPlace(3, 9)).toBeLessThan(estimatedAvgPlace(3, 8));
        // Raw places past anything played stop at the best real board
        expect(estimatedAvgPlace(-20, 8)).toBe(floor);
        expect(estimatedAvgPlace(40, 8)).toBe(8);
        expect(estimatedAvgPlace(2, 8)).toBeLessThan(estimatedAvgPlace(3, 8));
    });
});
