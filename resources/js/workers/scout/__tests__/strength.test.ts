import { describe, expect, it } from 'vitest';

import {
    OVERFLOW_PER_UNIT,
    overflowPenalty,
    teamScore,
    teamScoreBreakdown,
} from '../scorer';
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

    it('weighs a locked unit more in the ranking, not in the estimate', () => {
        const board = [unit('A'), unit('B'), unit('C')];
        const own = boardStrength(board, [], ctx);
        const onA = boardStrength(board, [], ctx, new Set(['A']));
        const w = STRENGTH.focusWeight;
        // A: 4.0 with its 0.4 lift from B at pair weight; B 4.4; C 4.6
        const a = 4.0 + STRENGTH.pairWeight * -0.4;

        close(own.place, (a + 4.4 + 4.6) / 3);
        close(own.focused, own.place);
        close(onA.place, own.place);
        close(onA.focused, (w * a + 4.4 + 4.6) / (w + 2));
        expect(onA.focused).toBeLessThan(
            boardStrength(board, [], ctx, new Set(['C'])).focused,
        );
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

    it('ranks with focus on locked units, itemises the board itself', () => {
        const team = board([tank('A'), carry('B'), tank('C')]);
        const focused = { ...team, focus: new Set(['A']) };

        // A is the best unit here, so weighing it more ranks the board up
        expect(teamScore(focused, ctx)).toBeGreaterThan(teamScore(team, ctx));
        expect(teamScoreBreakdown(focused, ctx)).toEqual(
            teamScoreBreakdown(team, ctx),
        );
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

describe('trait overflow', () => {
    const bps: Record<string, number[]> = { Solar: [3], Duo: [2, 4] };
    const of = (t: string) => bps[t] ?? [];

    it('charges trait counts past the last breakpoint', () => {
        expect(overflowPenalty({ Solar: 3, Duo: 4 }, of)).toBe(0);
        // Lux Sunbeam (Solar ×2) on a board that already has 3 Solar
        close(overflowPenalty({ Solar: 5, Duo: 3 }, of), 2 * OVERFLOW_PER_UNIT);
        expect(overflowPenalty({ Untracked: 9 }, of)).toBe(0);
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

describe('stars and reroll plans', () => {
    // 1★ 5.5 / 2★ 5.0 / 3★ 3.5; 40k of its 50k 3-item games at 3★
    const rerollable = (avg1 = 5.5, avg2 = 5.0, avg3 = 3.5) => ({
        avgPlace: 4.8,
        games: 3e6,
        stars: {
            '1': { games: 1e6, avgPlace: avg1, carryGames: 1e3 },
            '2': { games: 1e6, avgPlace: avg2, carryGames: 9e3 },
            '3': { games: 1e6, avgPlace: avg3, carryGames: 4e4 },
        },
    });
    const starCtx = {
        unitRatings: {
            One: rerollable(),
            Two: rerollable(5.5, 5.0, 4.0),
            Three: rerollable(5.5, 5.0, 4.5),
            Cost3: rerollable(),
            Cost3b: rerollable(),
            // 3★ 4-cost: 1% of its games and nearly always first
            Four: {
                avgPlace: 4.3,
                games: 1e6,
                stars: {
                    '1': { games: 6e5, avgPlace: 4.6, carryGames: 1e4 },
                    '2': { games: 3.9e5, avgPlace: 4.1, carryGames: 1e4 },
                    '3': { games: 1e4, avgPlace: 1.2, carryGames: 5e3 },
                },
            },
            Plain: { avgPlace: 4.4, games: 1e6 },
        },
    };
    const champ = (apiName: string, cost: number) => ({
        apiName,
        cost,
        traits: [] as string[],
    });
    const strength = (champs: any[]) => boardStrength(champs, [], starCtx);
    const base2 = 5.25;

    it('rates a unit at 1–2★, so 4-cost 3★ luck lifts nobody', () => {
        const s = strength([champ('Four', 4), champ('Plain', 4)]);

        close(s.units, (4.4 + (6 * 4.6 + 3.9 * 4.1) / 9.9) / 2);
        expect(s.reroll).toEqual([]);
    });

    it('counts a rerolled unit at its expected 3★ result', () => {
        const s = strength([champ('One', 1), champ('Plain', 4)]);
        // 40k hits of 50k carried games, shrunk 200 games towards 1/2
        const p = (4e4 + 200 * 0.5) / (5e4 + 200);

        expect(s.reroll).toEqual([
            { apiName: 'One', hitChance: expect.closeTo(p, 6) },
        ]);
        close(s.units, (base2 + p * (3.5 - base2) + 4.4) / 2);
    });

    it('mixes costs up to the per-cost caps, best gains first', () => {
        const s = strength([
            champ('Three', 1),
            champ('One', 1),
            champ('Two', 2),
            champ('Cost3', 3),
            champ('Cost3b', 3),
        ]);

        // One 3-cost at most; the rest fit under five
        expect(s.reroll.map((r) => r.apiName).sort()).toEqual(
            ['Cost3', 'One', 'Three', 'Two'].sort(),
        );
    });

    it('takes up to five 3★ on a board of cheap units', () => {
        const ones = ['One', 'Two', 'Three'].map((a) => champ(a, 1));
        const twos = ['One', 'Two', 'Three'].map((a) => champ(a, 2));
        const s = strength([...ones, ...twos, champ('Plain', 1)]);

        expect(s.reroll).toHaveLength(5);
    });

    it('takes fewer 3★ the more 4/5-costs the board carries', () => {
        const cheap = ['One', 'Two', 'Three'].map((a) => champ(a, 1));
        const fours = Array.from({ length: 4 }, () => champ('Four', 4));

        expect(strength([...cheap, ...fours.slice(0, 3)]).reroll).toHaveLength(
            3,
        );
        expect(strength([...cheap, ...fours]).reroll).toHaveLength(1);
    });

    it('rolls a locked unit first when the caps bind', () => {
        const fours = Array.from({ length: 4 }, () => champ('Four', 4));
        const board = [...fours, champ('One', 1), champ('Three', 1)];
        const rolled = (focus?: Set<string>) =>
            boardStrength(board, [], starCtx, focus).reroll.map(
                (r) => r.apiName,
            );

        // Four 4-costs leave room for one 3★: the bigger gain, unless the
        // player locked the other
        expect(rolled()).toEqual(['One']);
        expect(rolled(new Set(['Three']))).toEqual(['Three']);
    });

    it('keeps the board at 1–2★ when 3★ would not help', () => {
        const s = strength([champ('Plain', 1)]);

        expect(s.reroll).toEqual([]);
        close(s.units, 4.4);
    });
});
