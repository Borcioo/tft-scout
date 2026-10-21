import { describe, expect, it } from 'vitest';
import { buildActiveTraits } from '../active-traits';
import { buildExclusionLookup, filterCandidates } from '../candidates';
import {
    fillerCount,
    roleBalancePenalty,
    teamRoleBalance,
    teamScore,
    teamScoreBreakdown,
} from '../scorer';
import { buildGraph } from '../synergy-graph';
import { unscoredTraits } from '../trait-amount';
import * as mini from './fixtures/mini-set';

const byApi = Object.fromEntries(mini.champions.map((c) => [c.apiName, c]));
const pick = (...apis: string[]) => apis.map((a) => byApi[a]);
const withRoles = (...roles: string[]) =>
    roles.map((role, i) => ({ apiName: `U${i}`, role, traits: [] }));

describe('teamRoleBalance', () => {
    it('counts fighters as half frontline, half dps', () => {
        expect(
            teamRoleBalance(withRoles('ADTank', 'APCaster', 'ADFighter')),
        ).toEqual({
            frontline: 1,
            dps: 1,
            fighter: 1,
            effectiveFrontline: 1.5,
            effectiveDps: 1.5,
        });
    });

    it('treats unknown and Set 18 H* roles sensibly', () => {
        const { frontline, dps, fighter } = teamRoleBalance(
            withRoles('HTank', 'HCarry', 'HCaster', 'Mystery'),
        );

        expect([frontline, dps, fighter]).toEqual([1, 2, 1]);
    });
});

describe('roleBalancePenalty', () => {
    it.each([
        ['no frontline', ['APCaster', 'ADCarry', 'APCaster', 'ADCarry'], 30],
        ['one frontline', ['ADTank', 'ADCarry', 'APCaster', 'ADCarry'], 10],
        ['no dps', ['ADTank', 'APTank', 'HTank', 'ADTank'], 15],
        ['balanced', ['ADTank', 'APTank', 'ADCarry', 'ADFighter'], 0],
    ])('%s → %i', (_, roles, penalty) => {
        expect(roleBalancePenalty(withRoles(...roles))).toBe(penalty);
    });

    it('is zero for an empty board', () => {
        expect(roleBalancePenalty([])).toBe(0);
    });
});

describe('fillerCount', () => {
    const riftbeast = mini.traits.find((t) => t.apiName === 'Riftbeast');

    it('weighs Elder Dragon as two Riftbeast', () => {
        // Riftbeast 4 (Elder 2 + Rb1 + Rb2) holds the 3 breakpoint: only
        // Elder drops it below, so both 1-amount units are filler. Counted
        // as one, every unit would look critical (3 → 2).
        expect(
            fillerCount(pick('Elder', 'Rb1', 'Rb2'), { Riftbeast: riftbeast }),
        ).toBe(2);
    });

    it('treats overflow past a breakpoint as filler', () => {
        expect(
            fillerCount(pick('Rb1', 'Rb2', 'Rb3', 'Rb4'), {
                Riftbeast: riftbeast,
            }),
        ).toBe(4);
    });
});

describe('buildGraph companion edges', () => {
    const champs = pick('LuxCoven', 'LuxFae', 'Cv1', 'Fa1', 'Rb1');
    const graph = (companions: Record<string, unknown>) =>
        buildGraph(champs, mini.traits, { ...mini.scoringCtx, companions });
    const edge = (g: any, from: string, to: string) =>
        g.adjacency[from].find((e: any) => e.champ === to);

    it('expands a base id to every form of the champion', () => {
        // MetaTFT reports Lux under its base id, which is not a node
        const g = graph({
            Lux: [{ companion: 'Rb1', avgPlace: 3.5, games: 500 }],
        });

        for (const form of ['LuxCoven', 'LuxFae']) {
            expect(edge(g, form, 'Rb1')).toEqual(
                expect.objectContaining({
                    sharedTraits: 0,
                    companionScore: 3.5,
                }),
            );
            expect(edge(g, 'Rb1', form)).toBeTruthy();
        }
    });

    it('keeps trait edges as they are', () => {
        const g = graph({
            Lux: [{ companion: 'Fa1', avgPlace: 3.5, games: 500 }],
        });

        // Lux (Fae) and Fa1 already share Fae; Lux (Coven) gets the
        // companion edge only
        expect(edge(g, 'LuxFae', 'Fa1')).toEqual(
            expect.objectContaining({ sharedTraits: 1, traits: ['Fae'] }),
        );
        expect(edge(g, 'LuxFae', 'Fa1').companionScore).toBeUndefined();
        expect(edge(g, 'LuxCoven', 'Fa1').companionScore).toBe(3.5);
        expect(
            g.adjacency.Fa1.filter((e: any) => e.champ === 'LuxFae'),
        ).toHaveLength(1);
    });

    it('ignores companions below the games threshold', () => {
        const g = graph({
            Lux: [{ companion: 'Rb1', avgPlace: 2, games: 10 }],
        });

        expect(edge(g, 'LuxCoven', 'Rb1')).toBeUndefined();
    });

    it('never links a form to itself', () => {
        const g = graph({
            Lux: [{ companion: 'Lux', avgPlace: 3, games: 500 }],
        });

        expect(edge(g, 'LuxCoven', 'LuxCoven')).toBeUndefined();
    });
});

describe('candidates', () => {
    it('builds a symmetric exclusion lookup without self', () => {
        const lookup = buildExclusionLookup([['A', 'B', 'C']]);

        expect([...lookup.A].sort()).toEqual(['B', 'C']);
        expect([...lookup.C].sort()).toEqual(['A', 'B']);
    });

    it('drops locked, excluded and conflicting champions', () => {
        const apis = filterCandidates(
            mini.champions,
            { lockedChampions: ['LuxCoven'], excludedChampions: ['Rb1'] },
            mini.exclusionGroups,
        ).map((c: any) => c.apiName);

        expect(apis).not.toContain('LuxCoven');
        expect(apis).not.toContain('LuxFae');
        expect(apis).not.toContain('Rb1');
        expect(apis).toContain('Rb2');
    });

    it('drops lock-only units unless locked', () => {
        const kzAll = { ...byApi.Rb6, apiName: 'KzAll', lockOnly: true };
        const pool = (locked: string[]) =>
            filterCandidates([...mini.champions, kzAll], {
                lockedChampions: locked,
            }).map((c: any) => c.apiName);

        expect(pool([])).not.toContain('KzAll');
        // Locked units reach the team-builder via getLockedChampions
        expect(pool(['KzAll'])).not.toContain('KzAll');
    });

    it('drops hero variants from the pool', () => {
        const hero = { ...byApi.Cv3, apiName: 'Cv3_hero', variant: 'hero' };
        const apis = filterCandidates([...mini.champions, hero], {}).map(
            (c: any) => c.apiName,
        );

        expect(apis).not.toContain('Cv3_hero');
    });

    it('ranks champions of locked and emblem traits first', () => {
        const ranked = filterCandidates(mini.champions, {
            lockedTraits: [{ apiName: 'Sniper', minUnits: 2 }],
            emblems: ['Fae'],
        });
        const top = ranked.slice(0, 2).map((c: any) => c.apiName);

        // Fa1 is both Fae and Sniper; Big5 is Sniper only
        expect(top[0]).toBe('Fa1');
        expect(ranked[0].relevance).toBe(2);
        expect(
            ranked
                .filter((c: any) => c.relevance === 0)
                .every(
                    (c: any) =>
                        !c.traits.includes('Fae') &&
                        !c.traits.includes('Sniper'),
                ),
        ).toBe(true);
    });
});

describe("unscored traits (Set 18 Rival on Kha'Zix)", () => {
    const rival = {
        ...mini.traitOf('Avatar'),
        apiName: 'Rival',
        name: 'Rival',
    };
    const kz = {
        ...mini.championOf('Rb6'),
        apiName: 'Kz',
        traits: ['Rival', 'Sniper'],
        unscoredTraits: ['Rival'],
    };
    const rengar = {
        ...mini.championOf('Rb7'),
        apiName: 'Rengar',
        traits: ['Rival'],
    };
    const board = (...champs: any[]) => {
        const traits = [...mini.traits, rival];
        return {
            champions: champs,
            activeTraits: buildActiveTraits(champs, traits, []),
            level: 8,
        };
    };

    it('marks a trait unscored only while every holder unscores it', () => {
        expect([...unscoredTraits([kz, byApi.Rb3])]).toEqual(['Rival']);
        expect([...unscoredTraits([kz, rengar])]).toEqual([]);
        expect([...unscoredTraits([byApi.Rb3])]).toEqual([]);
    });

    it('keeps the trait active but adds no score for it', () => {
        const others = pick('Rb1', 'Rb3', 'Rb4', 'Cv2', 'Fa1', 'Rb5', 'Rb2');
        const team = board(kz, ...others);
        const scoredKz = { ...kz, unscoredTraits: [] };

        expect(team.activeTraits.map((t: any) => t.apiName)).toContain('Rival');
        expect(teamScore(team, mini.scoringCtx)).toBeLessThan(
            teamScore(board(scoredKz, ...others), mini.scoringCtx),
        );
        expect(teamScoreBreakdown(team, mini.scoringCtx).traits).toBe(
            teamScoreBreakdown(
                board({ ...kz, traits: ['Sniper'] }, ...others),
                mini.scoringCtx,
            ).traits,
        );
    });

    it('scores it again once Rengar is on the board', () => {
        const others = pick('Rb1', 'Rb3', 'Rb4', 'Cv2', 'Fa1', 'Rb5');
        const withRengar = board(kz, rengar, ...others);
        const allScored = board(
            { ...kz, unscoredTraits: [] },
            rengar,
            ...others,
        );

        expect(teamScore(withRengar, mini.scoringCtx)).toBe(
            teamScore(allScored, mini.scoringCtx),
        );
    });
});
