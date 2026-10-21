import { describe, expect, it } from 'vitest';

import {
    pickRandomCarry,
    pickRandomFromTeams,
    pickRandomTrait,
} from '@/lib/random-picker';
import type { Champion, ScoredTeam, Trait } from '@/workers/scout/types';

function champ(partial: Partial<Champion> & { apiName: string }): Champion {
    return {
        apiName: partial.apiName,
        name: partial.apiName,
        cost: partial.cost ?? 1,
        traits: partial.traits ?? [],
        traitNames: partial.traitNames ?? [],
        traitAmounts: partial.traitAmounts,
        slotsUsed: partial.slotsUsed ?? 1,
        baseApiName: partial.baseApiName ?? null,
        variant: partial.variant ?? null,
        role: partial.role ?? null,
        damageType: partial.damageType ?? null,
        roleCategory: partial.roleCategory ?? null,
        icon: '',
        abilityIcon: null,
        plannerCode: null,
    };
}

function trait(
    apiName: string,
    minUnits: number[],
    category: Trait['category'] = 'public',
): Trait {
    return {
        apiName,
        name: apiName,
        category,
        breakpoints: minUnits.map((m, i) => ({
            position: i + 1,
            minUnits: m,
            maxUnits: null,
            style: 'Bronze',
        })),
        icon: '',
    };
}

// Deterministic RNG: returns values from a fixed queue (wraps around).
function fixedRng(values: number[]): () => number {
    let i = 0;

    return () => values[i++ % values.length];
}

function team(score: number): ScoredTeam {
    return {
        champions: [],
        activeTraits: [],
        score,
        breakdown: null,
        level: 9,
        slotsUsed: 8,
        roles: null,
        metaMatch: null,
        insights: null,
    };
}

describe('pickRandomCarry', () => {
    const pool = [
        champ({ apiName: 'Aatrox', cost: 4, roleCategory: 'frontline' }),
        champ({ apiName: 'Jinx', cost: 4, roleCategory: 'dps' }),
        champ({ apiName: 'Kayn', cost: 4, roleCategory: 'fighter' }),
        champ({ apiName: 'Sona', cost: 3, roleCategory: 'dps' }),
    ];

    it('drops frontline and filters by cost tier', () => {
        expect(pickRandomCarry(pool, 4, fixedRng([0]))?.apiName).toBe('Jinx');
    });

    it('samples the full non-frontline pool for the random tier', () => {
        // Jinx, Kayn, Sona → floor(0.99 * 3) = 2
        expect(pickRandomCarry(pool, 'random', fixedRng([0.99]))?.apiName).toBe(
            'Sona',
        );
    });

    it('returns null when nothing qualifies', () => {
        expect(pickRandomCarry([], 4, fixedRng([0]))).toBeNull();
        expect(pickRandomCarry([pool[0]], 4, fixedRng([0]))).toBeNull();
    });
});

describe('pickRandomTrait', () => {
    const traits = [
        trait('Stargazer', [1], 'unique'),
        trait('Vanguard', [2, 4]),
        trait('Sniper', [2]),
        trait('Rare', [6]),
    ];
    const champsFull = [
        champ({ apiName: 'V1', traits: ['Vanguard'] }),
        champ({ apiName: 'V2', traits: ['Vanguard'] }),
        champ({ apiName: 'V3', traits: ['Vanguard'] }),
        champ({ apiName: 'V4', traits: ['Vanguard'] }),
        champ({ apiName: 'S1', traits: ['Sniper'] }),
        champ({ apiName: 'S2', traits: ['Sniper'] }),
        champ({ apiName: 'R1', traits: ['Rare'] }),
    ];

    it('locks the max breakpoint reachable without emblems', () => {
        // Candidates: Vanguard (bp 4), Sniper (bp 2); Rare needs emblems, unique is skipped
        expect(pickRandomTrait(traits, champsFull, fixedRng([0]))).toEqual({
            apiName: 'Vanguard',
            minUnits: 4,
        });
        expect(pickRandomTrait(traits, champsFull, fixedRng([0.99]))).toEqual({
            apiName: 'Sniper',
            minUnits: 2,
        });
    });

    it('shrinks the breakpoint with the pool', () => {
        const thin = [
            champ({ apiName: 'V1', traits: ['Vanguard'] }),
            champ({ apiName: 'V2', traits: ['Vanguard'] }),
        ];

        expect(pickRandomTrait(traits, thin, fixedRng([0]))).toEqual({
            apiName: 'Vanguard',
            minUnits: 2,
        });
    });

    it('counts Mecha Enhanced twice, one form per base', () => {
        const champs = [1, 2, 3].flatMap((i) => [
            champ({
                apiName: `M${i}`,
                baseApiName: `M${i}`,
                traits: ['Mecha'],
            }),
            champ({
                apiName: `M${i}_enh`,
                baseApiName: `M${i}`,
                traits: ['Mecha'],
                traitAmounts: { Mecha: 2 },
                slotsUsed: 2,
            }),
        ]);

        expect(
            pickRandomTrait([trait('Mecha', [3, 6])], champs, fixedRng([0])),
        ).toEqual({ apiName: 'Mecha', minUnits: 6 });
    });

    it('counts a Lux form twice for its element only', () => {
        const champs = [
            champ({ apiName: 'C1', traits: ['Coven'] }),
            champ({ apiName: 'C2', traits: ['Coven'] }),
            champ({
                apiName: 'LuxCoven',
                baseApiName: 'Lux',
                variant: 'coven',
                traits: ['Coven', 'Avatar'],
                traitAmounts: { Coven: 2 },
            }),
            champ({
                apiName: 'LuxFae',
                baseApiName: 'Lux',
                variant: 'fae',
                traits: ['Fae', 'Avatar'],
                traitAmounts: { Fae: 2 },
            }),
        ];

        expect(
            pickRandomTrait([trait('Coven', [3, 4])], champs, fixedRng([0])),
        ).toEqual({ apiName: 'Coven', minUnits: 4 });
    });

    it('ignores hero variants and unique-only pools', () => {
        expect(
            pickRandomTrait(
                [trait('Lone', [1])],
                [
                    champ({
                        apiName: 'HeroA',
                        variant: 'hero',
                        traits: ['Lone'],
                    }),
                ],
                fixedRng([0]),
            ),
        ).toBeNull();
        expect(
            pickRandomTrait([traits[0]], champsFull, fixedRng([0])),
        ).toBeNull();
    });
});

describe('pickRandomFromTeams', () => {
    it('picks uniformly', () => {
        const teams = [team(10), team(5), team(1)];

        expect(pickRandomFromTeams(teams, fixedRng([0]))?.score).toBe(10);
        expect(pickRandomFromTeams(teams, fixedRng([0.99]))?.score).toBe(1);
        expect(pickRandomFromTeams([], fixedRng([0]))).toBeNull();
    });
});
