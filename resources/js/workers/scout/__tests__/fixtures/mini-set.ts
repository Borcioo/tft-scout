// Synthetic Set 18-shaped catalogue for engine tests: small enough to
// reason about by hand, but it carries every mechanic the worker models —
// a team-size breakpoint (Riftbeast 10 → +2), a 2-slot unit counting twice
// for its trait (Elder Dragon), elemental forms of one champion that count
// twice for their element and exclude each other (Lux), a unique trait,
// all five costs and all role categories.

import type { Champion, ScoringContext, Trait } from '../../types';

type ChampSpec = {
    cost: number;
    role: string;
    traits: string[];
    traitAmounts?: Record<string, number>;
    slotsUsed?: number;
    baseApiName?: string;
    variant?: string;
};

const SPECS: Record<string, ChampSpec> = {
    Rb1: { cost: 1, role: 'ADTank', traits: ['Riftbeast', 'Bruiser'] },
    Rb2: { cost: 1, role: 'APCaster', traits: ['Riftbeast', 'Arcanist'] },
    Rb3: { cost: 2, role: 'ADCarry', traits: ['Riftbeast', 'Sniper'] },
    Rb4: { cost: 2, role: 'HTank', traits: ['Riftbeast', 'Bruiser'] },
    Rb5: { cost: 3, role: 'APCaster', traits: ['Riftbeast', 'Arcanist'] },
    Rb6: { cost: 3, role: 'ADFighter', traits: ['Riftbeast'] },
    Rb7: { cost: 4, role: 'ADCarry', traits: ['Riftbeast', 'Sniper'] },
    Rb8: { cost: 4, role: 'APTank', traits: ['Riftbeast', 'Bruiser'] },
    Elder: {
        cost: 5,
        role: 'ADFighter',
        traits: ['Riftbeast'],
        traitAmounts: { Riftbeast: 2 },
        slotsUsed: 2,
    },
    Cv1: { cost: 1, role: 'APCaster', traits: ['Coven', 'Arcanist'] },
    Cv2: { cost: 2, role: 'ADTank', traits: ['Coven', 'Bruiser'] },
    Cv3: { cost: 3, role: 'APCarry', traits: ['Coven', 'Sniper'] },
    Cv4: { cost: 4, role: 'HTank', traits: ['Coven'] },
    Fa1: { cost: 1, role: 'ADCarry', traits: ['Fae', 'Sniper'] },
    Fa2: { cost: 2, role: 'APTank', traits: ['Fae', 'Bruiser'] },
    Fa3: { cost: 3, role: 'APCaster', traits: ['Fae', 'Arcanist'] },
    Fa4: { cost: 4, role: 'ADFighter', traits: ['Fae'] },
    LuxCoven: {
        cost: 5,
        role: 'APCaster',
        traits: ['Avatar', 'Coven'],
        traitAmounts: { Coven: 2 },
        baseApiName: 'Lux',
        variant: 'coven',
    },
    LuxFae: {
        cost: 5,
        role: 'APCaster',
        traits: ['Avatar', 'Fae'],
        traitAmounts: { Fae: 2 },
        baseApiName: 'Lux',
        variant: 'fae',
    },
    Big5: { cost: 5, role: 'ADCarry', traits: ['Sniper', 'Bruiser'] },
};

export const champions: Champion[] = Object.entries(SPECS).map(
    ([apiName, s]) => ({
        apiName,
        name: apiName,
        cost: s.cost,
        traits: s.traits,
        traitNames: s.traits,
        traitAmounts: s.traitAmounts,
        slotsUsed: s.slotsUsed ?? 1,
        baseApiName: s.baseApiName ?? null,
        variant: s.variant ?? null,
        role: s.role,
        damageType: s.role.slice(0, 2),
        roleCategory: null,
        icon: '',
        abilityIcon: null,
        plannerCode: null,
    }),
);

const STYLES = ['Bronze', 'Silver', 'Gold', 'Prismatic'] as const;

function trait(
    apiName: string,
    minUnits: number[],
    teamSizeBonus: Record<number, number> = {},
): Trait {
    return {
        apiName,
        name: apiName,
        category: 'public',
        icon: '',
        breakpoints: minUnits.map((min, i) => ({
            position: i + 1,
            minUnits: min,
            maxUnits: minUnits[i + 1] ? minUnits[i + 1] - 1 : null,
            style: STYLES[Math.min(i, STYLES.length - 1)],
            teamSizeBonus: teamSizeBonus[min] ?? 0,
        })),
    };
}

export const traits: Trait[] = [
    trait('Riftbeast', [3, 5, 7, 10], { 10: 2 }),
    trait('Coven', [2, 4, 6]),
    trait('Fae', [2, 4]),
    trait('Bruiser', [2, 4]),
    trait('Sniper', [2, 4]),
    trait('Arcanist', [2, 4]),
    {
        apiName: 'Avatar',
        name: 'Avatar',
        category: 'unique',
        icon: '',
        breakpoints: [
            {
                position: 1,
                minUnits: 1,
                maxUnits: null,
                style: 'Unique',
                teamSizeBonus: 0,
            },
        ],
    },
];

export const exclusionGroups: string[][] = [['LuxCoven', 'LuxFae']];

// Ratings rise with cost so the scorer has something to rank by; MetaTFT
// reports Lux under its base id, like the real feed.
const unitRatings: ScoringContext['unitRatings'] = {};

for (const c of champions) {
    const api = c.baseApiName ?? c.apiName;
    unitRatings[api] = {
        avgPlace: 4.6 - c.cost * 0.1,
        winRate: 0.1,
        top4Rate: 0.5,
        games: 10000,
        score: 0.45 + c.cost * 0.02,
    };
}

export const scoringCtx: ScoringContext = {
    unitRatings,
    traitRatings: {},
    affinity: {},
    companions: {},
    metaComps: [],
    styleScores: {
        Bronze: 0.22,
        Silver: 0.44,
        Unique: 0.67,
        Gold: 1.2,
        Prismatic: 1.5,
    },
};
