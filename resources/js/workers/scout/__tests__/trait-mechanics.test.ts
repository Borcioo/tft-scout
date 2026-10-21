import { describe, expect, it } from 'vitest';

import { buildActiveTraits } from '../active-traits';
import { traitAmount } from '../trait-amount';
import { buildTeamSizeRules, teamSizeBonus } from '../trait-rules';

const riftbeast = {
    apiName: 'Riftbeast',
    name: 'Riftbeast',
    breakpoints: [
        { position: 1, minUnits: 3, teamSizeBonus: 0 },
        { position: 2, minUnits: 5, teamSizeBonus: 0 },
        { position: 3, minUnits: 7, teamSizeBonus: 0 },
        { position: 4, minUnits: 10, teamSizeBonus: 2 },
    ],
};
const coven = {
    apiName: 'Coven',
    name: 'Coven',
    breakpoints: [
        { position: 1, minUnits: 3 },
        { position: 2, minUnits: 4 },
    ],
};

describe('traitAmount', () => {
    it('defaults to 1 and reads overrides', () => {
        expect(traitAmount({}, 'Coven')).toBe(1);
        expect(traitAmount(null, 'Coven')).toBe(1);
        expect(traitAmount({ traitAmounts: { Coven: 2 } }, 'Coven')).toBe(2);
        expect(traitAmount({ traitAmounts: { Coven: 2 } }, 'Avatar')).toBe(1);
    });
});

describe('buildActiveTraits', () => {
    it('counts a Lux form twice for its element', () => {
        const team = [
            { apiName: 'C1', traits: ['Coven'] },
            {
                apiName: 'LuxCoven',
                traits: ['Coven', 'Avatar'],
                traitAmounts: { Coven: 2 },
            },
        ];
        const covenActive = buildActiveTraits(team, [coven], []).find(
            (t: any) => t.apiName === 'Coven',
        );

        expect(covenActive?.count).toBe(3);
        expect(covenActive?.activeBreakpoint).toBe(3);
    });

    it('counts Elder Dragon as two Riftbeast', () => {
        const team = [
            {
                apiName: 'Elder',
                traits: ['Riftbeast'],
                traitAmounts: { Riftbeast: 2 },
            },
            { apiName: 'R1', traits: ['Riftbeast'] },
        ];

        expect(
            buildActiveTraits(team, [riftbeast], []).find(
                (t: any) => t.apiName === 'Riftbeast',
            )?.count,
        ).toBe(3);
    });

    it('caps emblems by champions that can hold them', () => {
        const team = [
            { apiName: 'C1', traits: ['Coven'] },
            { apiName: 'C2', traits: ['Coven'] },
            { apiName: 'X', traits: [] },
        ];
        // Two Coven emblems but only one non-Coven holder
        const covenActive = buildActiveTraits(
            team,
            [coven],
            ['Coven', 'Coven'],
        ).find((t: any) => t.apiName === 'Coven');

        expect(covenActive?.count).toBe(3);
    });

    it('skips traits below their first breakpoint', () => {
        expect(
            buildActiveTraits(
                [{ apiName: 'C1', traits: ['Coven'] }],
                [coven],
                [],
            ),
        ).toEqual([]);
    });
});

describe('team size rules', () => {
    const rules = buildTeamSizeRules([riftbeast, coven]);

    it('keeps only traits with a granting breakpoint', () => {
        expect(Object.keys(rules)).toEqual(['Riftbeast']);
    });

    it.each([
        [{ apiName: 'Riftbeast', count: 9 }, 0],
        [{ apiName: 'Riftbeast', count: 10 }, 2],
        [{ apiName: 'Riftbeast', minUnits: 11 }, 2],
        [{ apiName: 'Coven', count: 7 }, 0],
    ])('%o → +%i', (trait, bonus) => {
        expect(teamSizeBonus([trait], rules)).toBe(bonus);
    });

    it('treats missing input as no bonus', () => {
        expect(teamSizeBonus(null, rules)).toBe(0);
        expect(teamSizeBonus([], rules)).toBe(0);
    });
});
