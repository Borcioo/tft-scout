import { describe, expect, it } from 'vitest';

import {
    findLockIssues,
    normalizeEmblems,
    normalizeTraitLocks,
    traitReach,
} from '../lock-reach';
import * as mini from './fixtures/mini-set';

const reach = (
    trait: string,
    level: number | null,
    { locked = [] as string[], excluded = [] as string[] } = {},
) =>
    traitReach(mini.champions, trait, {
        excluded: new Set(excluded),
        locked: new Set(locked),
        exclusionGroups: mini.exclusionGroups,
        level,
    });

const issues = (level: number, constraints: Record<string, unknown>) =>
    findLockIssues({
        champions: mini.champions,
        traits: mini.traits,
        exclusionGroups: mini.exclusionGroups,
        constraints,
        level,
    });

describe('normalizers', () => {
    it('flattens emblems of either shape', () => {
        expect(
            normalizeEmblems([
                'Fae',
                { apiName: 'Coven', count: 2 },
                { apiName: 'Sniper' },
            ]),
        ).toEqual(['Fae', 'Coven', 'Coven', 'Sniper']);
        expect(normalizeEmblems()).toEqual([]);
    });

    it('reads a bare trait lock as "active at all"', () => {
        expect(
            normalizeTraitLocks(['Fae', { apiName: 'Coven', minUnits: 4 }]),
        ).toEqual([
            { apiName: 'Fae', minUnits: 1 },
            { apiName: 'Coven', minUnits: 4 },
        ]);
    });
});

describe('traitReach', () => {
    it('counts one form per exclusion group, weighted by amount', () => {
        // 4 Fae units + Lux (Fae) worth 2; Lux (Coven) is the same Lux
        expect(reach('Fae', null).count).toBe(6);
    });

    it('leaves units the level does not offer out', () => {
        expect(reach('Coven', 9).count).toBe(6);
        expect(reach('Coven', 8).count).toBe(4);
        expect(reach('Riftbeast', 8).count).toBe(8);
    });

    it('lets a player lock lift the level gate', () => {
        expect(reach('Coven', 8, { locked: ['LuxCoven'] }).count).toBe(6);
    });

    it('skips banned units', () => {
        expect(reach('Coven', 9, { excluded: ['LuxCoven'] }).count).toBe(4);
    });
});

describe('findLockIssues', () => {
    it('names the gated unit a level 8 lock needs', () => {
        expect(
            issues(8, { lockedTraits: [{ apiName: 'Coven', minUnits: 6 }] }),
        ).toEqual([
            {
                traitApiName: 'Coven',
                traitName: 'Coven',
                minUnits: 6,
                reach: 4,
                reachIgnoringLevel: 6,
                gatedUnits: [
                    {
                        apiName: 'LuxCoven',
                        name: 'LuxCoven',
                        cost: 5,
                        amount: 2,
                        fromLevel: 9,
                        reason: 'level',
                    },
                ],
            },
        ]);
    });

    it('stays quiet once the player locks that unit', () => {
        expect(
            issues(8, {
                lockedChampions: ['LuxCoven'],
                lockedTraits: [{ apiName: 'Coven', minUnits: 6 }],
            }),
        ).toEqual([]);
    });

    it('reports a lock no unit can close', () => {
        const [issue] = issues(9, {
            lockedTraits: [{ apiName: 'Fae', minUnits: 10 }],
        });

        expect(issue).toEqual(
            expect.objectContaining({ reach: 6, reachIgnoringLevel: 6 }),
        );
        expect(issue.gatedUnits).toEqual([]);
    });

    it('counts emblems and ignores reachable locks', () => {
        expect(
            issues(8, {
                lockedTraits: [
                    { apiName: 'Coven', minUnits: 5 },
                    { apiName: 'Sniper', minUnits: 2 },
                ],
                emblems: [{ apiName: 'Coven', count: 1 }],
            }),
        ).toEqual([]);
    });

    it('does not suggest a banned unit', () => {
        const [issue] = issues(8, {
            excludedChampions: ['LuxCoven'],
            lockedTraits: [{ apiName: 'Coven', minUnits: 6 }],
        });

        expect(issue.gatedUnits).toEqual([]);
        expect(issue.reachIgnoringLevel).toBe(4);
    });
});

describe('findLockIssues — lock-only units', () => {
    const kzAll = {
        ...mini.championOf('Rb6'),
        apiName: 'KzAll',
        name: 'KzAll',
        cost: 3,
        traits: ['Bruiser', 'Sniper'],
        lockOnly: true,
    };

    it('offers a lock-only unit with its reason', () => {
        const [issue] = findLockIssues({
            champions: [...mini.champions, kzAll],
            traits: mini.traits,
            exclusionGroups: mini.exclusionGroups,
            constraints: {
                lockedTraits: [{ apiName: 'Bruiser', minUnits: 7 }],
            },
            level: 9,
        });

        expect(issue.reach).toBe(6);
        expect(issue.reachIgnoringLevel).toBe(7);
        expect(issue.gatedUnits).toEqual([
            expect.objectContaining({ apiName: 'KzAll', reason: 'lockOnly' }),
        ]);
    });

    it('tells level-gated and lock-only units apart', () => {
        const [issue] = findLockIssues({
            champions: [...mini.champions, kzAll],
            traits: mini.traits,
            exclusionGroups: mini.exclusionGroups,
            constraints: {
                lockedTraits: [{ apiName: 'Bruiser', minUnits: 7 }],
            },
            level: 8,
        });

        expect(
            Object.fromEntries(
                issue.gatedUnits.map((u) => [u.apiName, u.reason]),
            ),
        ).toEqual({ Big5: 'level', KzAll: 'lockOnly' });
    });
});
