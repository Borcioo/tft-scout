import { describe, expect, it } from 'vitest';

import { SCORING_CONFIG } from '../config';
import { generate } from '../engine';
import { teamRoleBalance } from '../scorer';
import type { ScoredTeam } from '../types';
import * as mini from './fixtures/mini-set';

type Constraints = Record<string, unknown>;

// engine.ts is untyped (@ts-nocheck); its public contract is ScoredTeam
function run(
    level: number,
    constraints: Constraints = {},
    extra = {},
): ScoredTeam[] {
    return generate({
        champions: mini.champions,
        traits: mini.traits,
        scoringCtx: mini.scoringCtx,
        exclusionGroups: mini.exclusionGroups,
        level,
        topN: 5,
        constraints,
        ...extra,
    }) as unknown as ScoredTeam[];
}

const apis = (team: any): string[] => team.champions.map((c: any) => c.apiName);
const traitCount = (team: any, api: string): number =>
    team.activeTraits.find((t: any) => t.apiName === api)?.count ?? 0;
const costOf = (api: string): number =>
    mini.champions.find((c) => c.apiName === api)?.cost ?? 0;
const fiveCosts = (team: any): number =>
    apis(team).filter((a) => costOf(a) === 5).length;

describe('engine.generate — slate shape', () => {
    const teams = run(8);

    it('returns topN teams sorted by score', () => {
        expect(teams).toHaveLength(5);

        const scores = teams.map((t: any) => t.score);
        expect(scores).toEqual([...scores].sort((a, b) => b - a));
    });

    it('fills exactly the level slot budget', () => {
        for (const team of teams) {
            expect(team.slotsUsed).toBe(8);
            expect(team.level).toBe(8);
        }
    });

    it('attaches breakdown, roles and insights', () => {
        for (const team of teams) {
            expect(team.breakdown).toBeTypeOf('object');
            expect(team.roles).toEqual(
                expect.objectContaining({
                    frontline: expect.any(Number),
                    dps: expect.any(Number),
                    fighter: expect.any(Number),
                }),
            );
            expect(team.insights).toBeTruthy();
        }
    });

    it('never returns near-duplicates', () => {
        const threshold = SCORING_CONFIG.dedupeOverlapPct;

        for (let i = 0; i < teams.length; i++) {
            for (let j = i + 1; j < teams.length; j++) {
                const a = new Set(apis(teams[i]));
                const b = apis(teams[j]);
                const shared = b.filter((x) => a.has(x)).length;

                expect(shared / Math.max(a.size, b.length)).toBeLessThan(
                    threshold,
                );
            }
        }
    });

    it('is deterministic for a seed', () => {
        const again = run(8);

        expect(again.map(apis)).toEqual(teams.map(apis));
        expect(again.map((t: any) => t.score)).toEqual(
            teams.map((t: any) => t.score),
        );
    });

    it('keeps rank order independent of topN', () => {
        const top2 = run(8, {}, { topN: 2 });

        expect(top2.map(apis)).toEqual(teams.slice(0, 2).map(apis));
    });
});

describe('engine.generate — level gating', () => {
    it('keeps 5-costs off the board below level 9', () => {
        for (const team of run(8)) {
            expect(fiveCosts(team)).toBe(0);
        }
    });

    it('caps 5-costs at two on level 9 by default', () => {
        const teams = run(9);

        expect(teams.some((t: any) => fiveCosts(t) > 0)).toBe(true);
        for (const team of teams) {
            expect(fiveCosts(team)).toBeLessThanOrEqual(2);
        }
    });

    it('honours an explicit max5Cost', () => {
        for (const team of run(9, { max5Cost: 0 })) {
            expect(fiveCosts(team)).toBe(0);
        }
    });

    it('lets the player lock a 5-cost below level 9', () => {
        const teams = run(8, { lockedChampions: ['Big5'] });

        expect(teams.length).toBeGreaterThan(0);
        for (const team of teams) {
            expect(apis(team)).toContain('Big5');
            expect(fiveCosts(team)).toBe(1);
        }
    });

    it('does not let a trait lock pull in a gated unit by itself', () => {
        // Coven 6 needs Lux (Coven) worth 2 — a 5-cost, not offered on 8
        expect(
            run(8, { lockedTraits: [{ apiName: 'Coven', minUnits: 6 }] }),
        ).toEqual([]);
        expect(
            run(8, {
                lockedChampions: ['LuxCoven'],
                lockedTraits: [{ apiName: 'Coven', minUnits: 6 }],
            }).length,
        ).toBeGreaterThan(0);
    });
});

describe('engine.generate — champion locks', () => {
    it('puts a locked champion in every team', () => {
        const teams = run(8, { lockedChampions: ['Fa4'] });

        expect(teams.length).toBeGreaterThan(0);
        for (const team of teams) {
            expect(apis(team)).toContain('Fa4');
        }
    });

    it('returns a full slate when most of the board is locked', () => {
        // Locked units are on every team, so they don't make two teams
        // duplicates: two free slots still leave room for alternatives
        const six = apis(run(8)[0]).slice(0, 6);
        const teams = run(8, { lockedChampions: six });

        expect(teams.length).toBe(5);
        for (const team of teams) {
            expect(apis(team)).toEqual(expect.arrayContaining(six));
        }
    });

    it('shows the board score, ranked for the locked unit', () => {
        for (const team of run(8, { lockedChampions: ['Fa4'] })) {
            expect(team.score).toBe(team.breakdown?.total);
        }
    });

    it('never fields an excluded champion', () => {
        const banned = ['Rb7', 'Rb8', 'Rb4'];

        for (const team of run(8, { excludedChampions: banned })) {
            for (const api of banned) {
                expect(apis(team)).not.toContain(api);
            }
        }
    });

    it('lets a ban win over a lock of the same champion', () => {
        for (const team of run(8, {
            lockedChampions: ['Rb7'],
            excludedChampions: ['Rb7'],
        })) {
            expect(apis(team)).not.toContain('Rb7');
        }
    });
});

describe('engine.generate — variant forms (Lux)', () => {
    it('never fields two forms of the same champion', () => {
        for (const level of [9, 10]) {
            for (const team of run(level)) {
                const forms = apis(team).filter((a) => a.startsWith('Lux'));

                expect(forms.length).toBeLessThanOrEqual(1);
            }
        }
    });

    it('locking one form keeps its siblings out', () => {
        const teams = run(9, { lockedChampions: ['LuxCoven'] });

        expect(teams.length).toBeGreaterThan(0);
        for (const team of teams) {
            expect(apis(team)).toContain('LuxCoven');
            expect(apis(team)).not.toContain('LuxFae');
        }
    });

    it('counts a form twice toward its element', () => {
        const teams = run(9, {
            lockedTraits: [{ apiName: 'Coven', minUnits: 6 }],
        });

        // 4 Coven units + Lux (Coven) worth 2 is the only way to reach 6
        expect(teams.length).toBeGreaterThan(0);
        for (const team of teams) {
            expect(apis(team)).toEqual(
                expect.arrayContaining([
                    'Cv1',
                    'Cv2',
                    'Cv3',
                    'Cv4',
                    'LuxCoven',
                ]),
            );
            expect(traitCount(team, 'Coven')).toBe(6);
        }
    });
});

describe('engine.generate — trait locks', () => {
    it('is a hard filter, backfill included', () => {
        const teams = run(8, {
            lockedTraits: [{ apiName: 'Bruiser', minUnits: 4 }],
        });

        expect(teams.length).toBeGreaterThan(0);
        for (const team of teams) {
            expect(traitCount(team, 'Bruiser')).toBeGreaterThanOrEqual(4);
        }
    });

    it('returns nothing for a lock the pool cannot reach', () => {
        expect(
            run(8, { lockedTraits: [{ apiName: 'Fae', minUnits: 10 }] }),
        ).toEqual([]);
    });

    it('counts emblems toward the lock', () => {
        const teams = run(8, {
            lockedTraits: [{ apiName: 'Fae', minUnits: 5 }],
            emblems: [{ apiName: 'Fae', count: 1 }],
        });

        expect(teams.length).toBeGreaterThan(0);
        for (const team of teams) {
            expect(traitCount(team, 'Fae')).toBeGreaterThanOrEqual(5);
            // The emblem needs a non-Fae holder
            expect(
                team.champions.some((c: any) => !c.traits.includes('Fae')),
            ).toBe(true);
        }
    });

    it('accepts legacy string emblems', () => {
        const a = run(8, { emblems: ['Fae'] });
        const b = run(8, { emblems: [{ apiName: 'Fae', count: 1 }] });

        expect(a.map(apis)).toEqual(b.map(apis));
    });
});

describe('engine.generate — team size breakpoint (Riftbeast 10)', () => {
    const teams = run(9, {
        lockedTraits: [{ apiName: 'Riftbeast', minUnits: 10 }],
    });

    it('grows the slot budget by the breakpoint bonus', () => {
        expect(teams.length).toBeGreaterThan(0);
        for (const team of teams) {
            expect(team.slotsUsed).toBe(11);
            expect(traitCount(team, 'Riftbeast')).toBe(10);
        }
    });

    it('uses the 2-slot Elder Dragon worth two Riftbeast', () => {
        for (const team of teams) {
            expect(apis(team)).toContain('Elder');
            // 8 regular Riftbeast + Elder (2) = 10 → all of them are needed
            expect(apis(team)).toEqual(
                expect.arrayContaining(
                    mini.champions
                        .filter((c) => c.traits.includes('Riftbeast'))
                        .map((c) => c.apiName),
                ),
            );
        }
    });

    it('is out of reach on level 8 where Elder Dragon is not offered', () => {
        // 8 one-slot Riftbeast reach 8 < 10; the only way past is Elder,
        // and a trait lock must not pull in a level-gated unit by itself
        expect(
            run(8, { lockedTraits: [{ apiName: 'Riftbeast', minUnits: 10 }] }),
        ).toEqual([]);
    });

    it('opens on level 8 when the player locks Elder Dragon', () => {
        const teams = run(8, {
            lockedChampions: ['Elder'],
            lockedTraits: [{ apiName: 'Riftbeast', minUnits: 10 }],
        });

        expect(teams.length).toBeGreaterThan(0);
        for (const team of teams) {
            expect(apis(team)).toContain('Elder');
            expect(team.slotsUsed).toBe(10);
            expect(traitCount(team, 'Riftbeast')).toBe(10);
        }
    });
});

describe('engine.generate — role minimums', () => {
    it('meets minFrontline or marks the team as relaxed', () => {
        const teams = run(8, { minFrontline: 5 });

        expect(teams.length).toBeGreaterThan(0);
        for (const team of teams) {
            const { effectiveFrontline } = teamRoleBalance(team.champions);

            if (team.breakdown?.relaxed !== 1) {
                expect(effectiveFrontline).toBeGreaterThanOrEqual(5);
            }
        }
    });
});

describe('engine.generate — meta comp match', () => {
    it('badges a team within one unit of a winning meta comp', () => {
        const [best] = run(8);
        const units = apis(best);
        const teams = run(
            8,
            {},
            {
                scoringCtx: {
                    ...mini.scoringCtx,
                    metaComps: [
                        {
                            id: 'm1',
                            name: 'Rift Snipers',
                            units: [...units.slice(0, 7), 'Fa1'],
                            avgPlace: 4.1,
                            games: 900,
                            level: 8,
                        },
                        {
                            id: 'm2',
                            name: 'Losing copy',
                            units,
                            avgPlace: 4.8,
                            games: 900,
                            level: 8,
                        },
                    ],
                },
            },
        );
        const match = teams.find(
            (t: any) => apis(t).join() === units.join(),
        )?.metaMatch;

        // m2 overlaps fully but averages worse than 4.5 → not meta
        expect(match).toEqual(
            expect.objectContaining({
                name: 'Rift Snipers',
                overlap: 7,
                total: 8,
            }),
        );
    });
});

describe('engine.generate — lock-only forms', () => {
    // An evolving unit: the base, a one-trait form the scout may field on
    // its own, and a fully evolved form it may only field when locked
    // (Set 18 Kha'Zix with all four evolutions).
    const kz = (apiName: string, traits: string[], lockOnly = false) => ({
        ...mini.championOf('Rb6'),
        apiName,
        name: apiName,
        cost: 3,
        role: 'ADFighter',
        traits: ['Rival', ...traits],
        traitNames: ['Rival', ...traits],
        baseApiName: apiName === 'Kz' ? null : 'Kz',
        variant: apiName === 'Kz' ? null : 'evolved',
        lockOnly,
    });
    const champions = [
        ...mini.champions,
        kz('Kz', []),
        kz('KzSniper', ['Sniper']),
        kz('KzAll', ['Sniper', 'Arcanist', 'Bruiser'], true),
    ];
    const traits = [
        ...mini.traits,
        {
            ...mini.traitOf('Avatar'),
            apiName: 'Rival',
            name: 'Rival',
        },
    ];
    const exclusionGroups = [
        ...mini.exclusionGroups,
        ['Kz', 'KzSniper', 'KzAll'],
    ];
    const runKz = (level: number, constraints: Constraints = {}) =>
        generate({
            champions,
            traits,
            scoringCtx: mini.scoringCtx,
            exclusionGroups,
            level,
            topN: 10,
            constraints,
        }) as unknown as ScoredTeam[];

    it('never fields a lock-only form on its own', () => {
        for (const level of [8, 9, 10]) {
            for (const team of runKz(level)) {
                expect(apis(team)).not.toContain('KzAll');
            }
        }
    });

    it('fields it when the player locks it', () => {
        const teams = runKz(8, { lockedChampions: ['KzAll'] });

        expect(teams.length).toBeGreaterThan(0);
        for (const team of teams) {
            expect(apis(team)).toContain('KzAll');
            expect(apis(team)).not.toContain('KzSniper');
        }
    });

    it('does not let a trait lock pull it in by itself', () => {
        // Bruiser units on level 9: Rb1 Rb4 Rb8 Cv2 Fa2 Big5 = 6; the
        // 7th Bruiser exists only on the lock-only form
        const lock = { lockedTraits: [{ apiName: 'Bruiser', minUnits: 7 }] };

        expect(runKz(9, lock)).toEqual([]);
        expect(
            runKz(9, { ...lock, lockedChampions: ['KzAll'] }).length,
        ).toBeGreaterThan(0);
    });
});
