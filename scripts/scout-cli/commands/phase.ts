import { readFileSync } from 'node:fs';

// @ts-expect-error — worker modules use // @ts-nocheck
import { buildActiveTraits } from '../../../resources/js/workers/scout/active-traits';
import {
    buildExclusionLookup,
    filterCandidates,
    getLockedChampions,
} from '../../../resources/js/workers/scout/candidates';
// @ts-expect-error
import { buildHeroExclusionGroup } from '../../../resources/js/workers/scout/hero-exclusion';
import { teamRoleBalance, teamScore, teamScoreBreakdown } from '../../../resources/js/workers/scout/scorer';
import { buildGraph, findTeams } from '../../../resources/js/workers/scout/synergy-graph';
// @ts-expect-error
// @ts-expect-error
// @ts-expect-error
import { buildTeamInsights } from '../../../resources/js/workers/scout/team-insights';
// @ts-expect-error

import type { ScoutContext } from '../../../resources/js/workers/scout/types';
import { loadContext } from '../context';
import {
    summariseActiveTraits,
    summariseCandidates,
    summariseFindTeams,
    summariseGraph,
    summariseRoleBalance,
    summariseScore,
} from '../format';
import { assertLabEnabled, openDb } from '../lab/db';
import { currentGitSha } from '../lab/git';
import { recordRun } from '../lab/ingest';
import { findChampions } from '../lookup';
import { parseCommonArgs  } from '../params';
import type {CommonArgs} from '../params';

const PHASES = [
    'candidates',
    'graph',
    'find-teams',
    'score',
    'active-traits',
    'role-balance',
    'insights',
] as const;

type PhaseName = (typeof PHASES)[number];

export async function runPhase(argv: string[]): Promise<void> {
    const phase = argv[0] as PhaseName;

    if (!phase || !PHASES.includes(phase)) {
        throw new Error(`Phase command expects one of: ${PHASES.join(', ')}. Got: ${phase}`);
    }

    const args = parseCommonArgs(argv.slice(1));
    const ctx = await loadContext({ live: args.live, snapshotPath: args.snapshotPath });

    if (args.rawInputPath) {
        const raw = JSON.parse(readFileSync(args.rawInputPath, 'utf8'));
        const result = runPhaseRawInput(phase, raw);
        print(result);

        return;
    }

    const start = Date.now();
    const result = await runPhaseAutoBuild(phase, ctx, args);
    const durationMs = Date.now() - start;

    if (args.tag) {
        assertLabEnabled();
        const db = openDb();

        try {
            const gitSha = currentGitSha();
            recordRun(
                db,
                {
                    params: {
                        level: (args.params.level ?? 8) as number,
                        topN: (args.params.topN ?? 10) as number,
                        seed: (args.params.seed ?? 0) as number,
                        minFrontline: args.params.minFrontline ?? 0,
                        minDps: args.params.minDps ?? 0,
                        max5Cost: args.params.max5Cost ?? null,
                        lockedChampions: args.params.lockedChampions ?? [],
                        excludedChampions: args.params.excludedChampions ?? [],
                        lockedTraits: args.params.lockedTraits ?? [],
                        emblems: args.params.emblems ?? [],
                    },
                    results: Array.isArray(result) ? result : [result],
                    filtered: null,
                },
                {
                    source: 'phase',
                    command: `phase:${phase}`,
                    tag: args.tag,
                    gitSha,
                    durationMs,
                },
            );
        } finally {
            db.close();
        }
    }

    print(result, args.full);
}

function runPhaseRawInput(phase: PhaseName, raw: any): any {
    switch (phase) {
        case 'candidates':
            return filterCandidates(raw.champions, raw.constraints, raw.exclusionGroups);
        case 'graph':
            return buildGraph(raw.champions, raw.traits, raw.scoringCtx, raw.exclusionLookup);
        case 'find-teams':
            return findTeams(raw.graph, raw.options);
        case 'score':
            return teamScore(raw, raw.ctx ?? raw.scoringCtx);
        case 'active-traits':
            return buildActiveTraits(raw.champions, raw.traits, raw.emblems ?? []);
        case 'role-balance':
            return teamRoleBalance(raw.champions ?? raw);
        case 'insights':
            return buildTeamInsights(raw.team, raw.ctx, raw.batchMedianScore ?? 0);
    }
}

async function runPhaseAutoBuild(phase: PhaseName, ctx: ScoutContext, args: CommonArgs): Promise<any> {
    const constraints = constraintsFromArgs(args);
    const exclusionGroups = mergeHeroExclusion(ctx);

    if (phase === 'candidates') {
        const candidates = filterCandidates(ctx.champions, constraints, exclusionGroups);

        return args.full ? candidates : summariseCandidates(candidates);
    }

    const candidates = filterCandidates(ctx.champions, constraints, exclusionGroups);
    const locked = getLockedChampions(ctx.champions, constraints.lockedChampions ?? []);
    const eligible = [...locked, ...candidates];
    const exclusionLookup = buildExclusionLookup(exclusionGroups);

    if (phase === 'graph') {
        const graph = buildGraph(eligible, ctx.traits, ctx.scoringCtx, exclusionLookup);

        return args.full ? graph : summariseGraph(graph);
    }

    const graph = buildGraph(eligible, ctx.traits, ctx.scoringCtx, exclusionLookup);

    const level = (args.params.level ?? 8) as number;
    const teamSize = level - extraSlotsFromLocked(locked);
    const findOpts = {
        teamSize,
        startChamps: locked.map((c: any) => c.apiName),
        maxResults: ((args.params.topN ?? 10) as number) * 5,
        level,
        emblems: args.params.emblems ?? [],
        excludedTraits: args.params.excludedTraits ?? [],
        excludedChampions: args.params.excludedChampions ?? [],
        max5Cost: args.params.max5Cost ?? null,
        seed: args.params.seed ?? 0,
    };

    if (phase === 'find-teams') {
        const teams = findTeams(graph, findOpts);

        return args.full ? teams : summariseFindTeams(teams);
    }

    // The remaining phases all need a specific --team CSV.
    if (!args.team) {
        throw new Error(`Phase ${phase} requires --team A,B,C,... (champion apiNames).`);
    }

    const teamChamps = findChampions(ctx, args.team);

    if (phase === 'role-balance') {
        const balance = teamRoleBalance(teamChamps);

        return args.full ? balance : summariseRoleBalance(balance);
    }

    const activeTraits = buildActiveTraits(teamChamps, ctx.traits, args.params.emblems ?? []);

    if (phase === 'active-traits') {
        return args.full ? activeTraits : summariseActiveTraits(activeTraits);
    }

    if (phase === 'score') {
        const team = { champions: teamChamps, activeTraits, level };
        const score = teamScore(team, ctx.scoringCtx);
        const breakdown = teamScoreBreakdown(team, ctx.scoringCtx);
        const result = { score, breakdown };

        return args.full ? result : summariseScore(result);
    }

    if (phase === 'insights') {
        const team = {
            champions: teamChamps,
            activeTraits,
            level,
            score: teamScore({ champions: teamChamps, activeTraits, level }, ctx.scoringCtx),
            breakdown: teamScoreBreakdown({ champions: teamChamps, activeTraits, level }, ctx.scoringCtx),
            roles: teamRoleBalance(teamChamps),
            slotsUsed: teamChamps.reduce((s: number, c: any) => s + (c.slotsUsed ?? 1), 0),
        };

        return buildTeamInsights(team, { ...ctx.scoringCtx, stale: ctx.stale }, 0);
    }
}

function mergeHeroExclusion(ctx: ScoutContext): string[][] {
    const heroGroup = buildHeroExclusionGroup(ctx.champions);

    return heroGroup.length >= 2 ? [...(ctx.exclusionGroups ?? []), heroGroup] : ctx.exclusionGroups ?? [];
}

function extraSlotsFromLocked(locked: any[]): number {
    let extra = 0;

    for (const c of locked) {
if ((c.slotsUsed ?? 1) > 1) {
extra += (c.slotsUsed ?? 1) - 1;
}
}

    return extra;
}

function constraintsFromArgs(args: CommonArgs): any {
    return {
        lockedChampions: args.params.lockedChampions ?? [],
        excludedChampions: args.params.excludedChampions ?? [],
        lockedTraits: args.params.lockedTraits ?? [],
        excludedTraits: args.params.excludedTraits ?? [],
        emblems: args.params.emblems ?? [],
        max5Cost: args.params.max5Cost ?? null,
        roleBalance: args.params.roleBalance ?? null,
        minFrontline: args.params.minFrontline ?? 0,
        minDps: args.params.minDps ?? 0,
    };
}

function print(result: unknown): void {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
