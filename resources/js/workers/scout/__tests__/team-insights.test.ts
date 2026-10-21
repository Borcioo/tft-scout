import { describe, expect, it } from 'vitest';

import { buildTeamInsights } from '../team-insights';

const unit = (apiName: string, traits: string[]) => ({
    apiName,
    baseApiName: null,
    name: apiName,
    cost: 1,
    traits,
});
const active = (apiName: string, count: number, mins: number[]) => ({
    apiName,
    name: apiName,
    count,
    breakpoints: mins.map((minUnits) => ({ minUnits })),
});
const rating = (avgPlace: number) => ({ avgPlace, games: 1e5 });

// Azir, Soraka: Executioner. Kayle: Solar. Ezreal: Executioner.
const team = {
    champions: [
        unit('Azir', ['Executioner']),
        unit('Soraka', ['Executioner']),
        unit('Ezreal', ['Executioner']),
        unit('Kayle', ['Solar']),
    ],
    activeTraits: [active('Executioner', 3, [2, 3, 4])],
} as any;
const ctx = {
    unitRatings: {
        Azir: rating(4.3),
        Soraka: rating(4.1),
        Ezreal: rating(4.2),
        Kayle: rating(4.4),
    },
    companions: {
        // Kayle with Azir: far better than either alone, no shared trait
        Kayle: [{ companion: 'Azir', avgPlace: 3.0, games: 1e5 }],
        // Executioner mates: Azir + Soraka 3.2 vs ~3.9 expected beats
        // the others, which then can't reuse Azir or Soraka
        Azir: [
            { companion: 'Soraka', avgPlace: 3.2, games: 1e5 },
            { companion: 'Ezreal', avgPlace: 3.5, games: 1e5 },
        ],
        Soraka: [{ companion: 'Ezreal', avgPlace: 3.6, games: 1e5 }],
    },
    affinity: {
        Azir: [
            // Executioner 4 isn't on this board (3 Executioner = level 2)
            { trait: 'Executioner', breakpoint: 3, avgPlace: 2.1, games: 1e4 },
            { trait: 'Executioner', breakpoint: 2, avgPlace: 3.5, games: 1e4 },
        ],
        // Not Kayle's trait: says Executioner boards win, not Kayle
        Kayle: [
            { trait: 'Executioner', breakpoint: 2, avgPlace: 2.0, games: 1e4 },
        ],
    },
    traitRatings: {},
    metaComps: [],
} as any;
const strengths = buildTeamInsights(team, ctx, 0).strengths;
const of = (kind: string) => strengths.filter((s: any) => s.kind === kind);

describe('team insights', () => {
    it('lists duos that share an active trait, each unit once', () => {
        expect(
            of('provenPair').map((p: any) => [p.aApi, p.bApi].sort()),
        ).toEqual([['Azir', 'Soraka']]);
        expect(of('provenPair')[0]).toMatchObject({
            avgPlace: 3.2,
            expected: expect.closeTo(4.3 + 4.1 - 4.5, 6),
        });
    });

    it("quotes a unit's own trait at the board's level", () => {
        expect(of('affinityHit')).toEqual([
            expect.objectContaining({
                championApiName: 'Azir',
                traitApiName: 'Executioner',
                count: 3,
                avgPlace: 3.5,
            }),
        ]);
    });
});
