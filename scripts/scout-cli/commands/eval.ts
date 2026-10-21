// @ts-nocheck — consumes the untyped worker modules, like generate.ts
/**
 * `scout-cli eval` — quality report for the scout engine, offline.
 *
 * Reads a context snapshot only (no API calls) and measures:
 *   - strength: how well the scorer ranks real boards — MetaTFT meta
 *     comps with their actual avgPlace — as Spearman with a bootstrap
 *     90% interval. Meta comps are the test set here, never a target:
 *     the engine must not score boards by resemblance to them.
 *   - oracle (when `scout oracle` data exists): the model against ~4k
 *     boards people actually played — see eval-oracle.ts. Its per-size
 *     fit is where STRENGTH.calibration (the shown avgPlace) comes from.
 *   - search: per level and seed, runtime, how many results a single
 *     unit swap would still improve under the engine's own scorer, and
 *     the spread of the top-1 score across seeds.
 *   - sanity: game-logic checks the test set can't see — units with no
 *     active trait, traits one unit short of a breakpoint.
 *   - novelty: share of results that match a meta comp (metaMatch).
 *
 * Usage:
 *   npm run scout -- eval [--snapshot tmp/scout-eval/context-18.4b-stars.json]
 *                         [--levels 8,9] [--seeds 1,2,3] [--json]
 */

import { existsSync } from 'node:fs';

import { buildActiveTraits } from '../../../resources/js/workers/scout/active-traits';
import {
    MIN_LEVEL_BY_COST,
    SCORING_CONFIG,
} from '../../../resources/js/workers/scout/config';
import { generate } from '../../../resources/js/workers/scout/engine';
import { teamScore } from '../../../resources/js/workers/scout/scorer';
import { STRENGTH } from '../../../resources/js/workers/scout/strength';
import { findActiveBreakpointIdx } from '../../../resources/js/workers/scout/synergy-graph/shared/breakpoints';
import {
    buildTeamSizeRules,
    teamSizeBonus,
} from '../../../resources/js/workers/scout/trait-rules';
import { loadContext } from '../context';
import { evalOracle } from './eval-oracle';

const DEFAULT_EVAL_SNAPSHOT = 'tmp/scout-eval/context-18.4b-stars.json';
const DEFAULT_ORACLE = 'tmp/scout-eval/oracle-18.4b.json';

type EvalArgs = {
    snapshotPath: string;
    oraclePath: string;
    levels: number[];
    seeds: number[];
    json: boolean;
};

function parseArgs(argv: string[]): EvalArgs {
    const args: EvalArgs = {
        snapshotPath: DEFAULT_EVAL_SNAPSHOT,
        oraclePath: DEFAULT_ORACLE,
        levels: [8, 9],
        seeds: [1, 2, 3],
        json: false,
    };

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];

        if (a === '--snapshot') {
            args.snapshotPath = argv[++i];
        } else if (a === '--oracle') {
            args.oraclePath = argv[++i];
        } else if (a === '--levels') {
            args.levels = argv[++i].split(',').map(Number);
        } else if (a === '--seeds') {
            args.seeds = argv[++i].split(',').map(Number);
        } else if (a === '--json') {
            args.json = true;
        } else {
            throw new Error(`Unknown flag for eval: ${a}`);
        }
    }

    return args;
}

// ── statistics ──────────────────────────────────────────────

function ranks(xs: number[]): number[] {
    const order = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
    const r = new Array(xs.length);

    for (let i = 0; i < order.length; ) {
        let j = i;
        while (j + 1 < order.length && order[j + 1][0] === order[i][0]) {
            j++;
        }
        for (let k = i; k <= j; k++) {
            r[order[k][1]] = (i + j) / 2;
        }
        i = j + 1;
    }

    return r;
}

function pearson(a: number[], b: number[]): number {
    const n = a.length;
    const ma = a.reduce((s, x) => s + x, 0) / n;
    const mb = b.reduce((s, x) => s + x, 0) / n;
    let num = 0;
    let da = 0;
    let db = 0;

    for (let i = 0; i < n; i++) {
        num += (a[i] - ma) * (b[i] - mb);
        da += (a[i] - ma) ** 2;
        db += (b[i] - mb) ** 2;
    }

    return num / Math.sqrt(da * db);
}

export function spearman(a: number[], b: number[]): number {
    return pearson(ranks(a), ranks(b));
}

/** Deterministic bootstrap — same snapshot, same interval. */
function bootstrapInterval(a: number[], b: number[], samples = 4000) {
    let state = 12345;
    const rnd = () => {
        state = (state * 1103515245 + 12345) % 2147483648;
        return state / 2147483648;
    };
    const values: number[] = [];

    for (let s = 0; s < samples; s++) {
        const idx = a.map(() => Math.floor(rnd() * a.length));
        const v = spearman(
            idx.map((i) => a[i]),
            idx.map((i) => b[i]),
        );
        if (Number.isFinite(v)) {
            values.push(v);
        }
    }

    values.sort((x, y) => x - y);

    return [
        values[Math.floor(values.length * 0.05)],
        values[Math.floor(values.length * 0.95)],
    ];
}

// ── evaluation parts ────────────────────────────────────────

function scoreTeam(team: any[], level: number, ctx: any): number {
    const activeTraits = buildActiveTraits(team, ctx.traits, []);

    return teamScore({ champions: team, activeTraits, level }, ctx.scoringCtx);
}

/**
 * Meta comps list base ids; a base the player can't field (Lux) stands
 * for whichever form the scorer likes best.
 */
function evalStrength(ctx: any) {
    const byApi = new Map(ctx.champions.map((c) => [c.apiName, c]));
    const formsOf = new Map<string, any[]>();

    for (const c of ctx.champions) {
        if (c.baseApiName && !c.lockOnly) {
            formsOf.set(c.baseApiName, [
                ...(formsOf.get(c.baseApiName) ?? []),
                c,
            ]);
        }
    }

    const predicted: number[] = [];
    const actual: number[] = [];
    const sanity = [];

    for (const comp of ctx.scoringCtx.metaComps ?? []) {
        const fixed = [];
        let options: any[] = [null];

        for (const u of comp.units) {
            if (byApi.has(u)) {
                fixed.push(byApi.get(u));
            } else if (formsOf.has(u)) {
                options = formsOf.get(u);
            }
        }

        const teams = options.map((f) => (f ? [...fixed, f] : fixed));
        const scores = teams.map((t) => scoreTeam(t, comp.level, ctx));
        const best = Math.max(...scores);
        sanity.push(boardSanity(teams[scores.indexOf(best)], ctx));
        predicted.push(best);
        actual.push(-comp.avgPlace);
    }

    const [lo, hi] = bootstrapInterval(predicted, actual);
    return {
        comps: predicted.length,
        spearman: spearman(predicted, actual),
        interval: [lo, hi],
        // What real boards look like — the reference for the sanity checks
        deadUnitsPerBoard:
            sanity.reduce((s, x) => s + x.deadUnits, 0) / sanity.length,
        oneShortPerBoard:
            sanity.reduce((s, x) => s + x.oneShort, 0) / sanity.length,
    };
}

function boardSanity(team: any[], ctx: any) {
    const activeTraits = buildActiveTraits(team, ctx.traits, []);
    const active = new Set(activeTraits.map((t) => t.apiName));
    const traitByApi = new Map(ctx.traits.map((t) => [t.apiName, t]));
    const counts: Record<string, number> = {};

    for (const c of team) {
        for (const t of c.traits) {
            counts[t] = (counts[t] ?? 0) + (c.traitAmounts?.[t] ?? 1);
        }
    }

    // A unit with traits, none of them active (unique traits are always on)
    const deadUnits = team.filter(
        (c) => c.traits.length > 0 && !c.traits.some((t) => active.has(t)),
    ).length;

    // A trait one unit short of its next breakpoint
    let oneShort = 0;
    for (const [t, n] of Object.entries(counts)) {
        const bps = [...(traitByApi.get(t)?.breakpoints ?? [])]
            .map((b) => b.minUnits)
            .sort((a, b) => a - b);
        const idx = findActiveBreakpointIdx(
            n,
            bps.map((m) => ({ minUnits: m })),
        );
        const next = bps[idx + 1];
        if (next !== undefined && next - n === 1 && n > 1) {
            oneShort++;
        }
    }

    return { deadUnits, oneShort };
}

/**
 * Best score gain from one legal swap. A swap that turns the team into a
 * near-copy of another team in the slate (the engine's dedupe rule)
 * doesn't count: the engine is meant to return different boards.
 */
function onesSwapImprovable(
    result: any,
    level: number,
    ctx: any,
    slate: any[],
): number {
    const byApi = new Map(ctx.champions.map((c) => [c.apiName, c]));
    const groupOf = new Map<string, number>();
    ctx.exclusionGroups.forEach((g, i) => {
        for (const a of g) {
            groupOf.set(a, i);
        }
    });
    const key = (c) => groupOf.get(c.apiName) ?? c.apiName;
    const rules = buildTeamSizeRules(ctx.traits);
    const pool = ctx.champions.filter(
        (c) =>
            !c.lockOnly &&
            c.variant !== 'hero' &&
            level >= (MIN_LEVEL_BY_COST[c.cost] ?? 1),
    );
    const team = result.champions.map((c) => byApi.get(c.apiName));
    const valid = (t) => {
        const activeTraits = buildActiveTraits(t, ctx.traits, []);
        const slots = t.reduce((s, c) => s + (c.slotsUsed ?? 1), 0);
        const fives = t.filter((c) => c.cost === 5).length;

        return (
            slots <= level + teamSizeBonus(activeTraits, rules) &&
            (level !== 9 || fives <= 2) &&
            (level < 10 || fives <= 3)
        );
    };
    const coreOf = (t) =>
        new Set<string>(t.map((c) => c.baseApiName || c.apiName));
    const otherCores = slate
        .filter((r) => r !== result)
        .map((r) => coreOf(r.champions));
    const isDup = (t) => {
        const core = coreOf(t);

        return otherCores.some((other) => {
            const shared = [...core].filter((a) => other.has(a)).length;

            return (
                shared / Math.max(core.size, other.size) >=
                SCORING_CONFIG.dedupeOverlapPct
            );
        });
    };
    const base = scoreTeam(team, level, ctx);
    let best = base;

    for (let i = 0; i < team.length; i++) {
        const others = team.filter((_, j) => j !== i);
        const used = new Set(others.map(key));

        for (const cand of pool) {
            if (
                used.has(key(cand)) ||
                (cand.slotsUsed ?? 1) !== (team[i].slotsUsed ?? 1)
            ) {
                continue;
            }
            const next = [...others, cand];
            if (!valid(next) || isDup(next)) {
                continue;
            }
            best = Math.max(best, scoreTeam(next, level, ctx));
        }
    }

    return best - base;
}

function evalSearch(ctx: any, levels: number[], seeds: number[]) {
    const out = [];

    for (const level of levels) {
        const runs = [];

        for (const seed of seeds) {
            const started = Date.now();
            const results = generate({
                champions: ctx.champions,
                traits: ctx.traits,
                scoringCtx: ctx.scoringCtx,
                exclusionGroups: ctx.exclusionGroups,
                level,
                topN: 10,
                seed,
                constraints: {},
            });
            runs.push({ ms: Date.now() - started, results });
        }

        const all = runs.flatMap((r) => r.results);
        const byApi = new Map(ctx.champions.map((c) => [c.apiName, c]));
        const sanity = all.map((r) =>
            boardSanity(
                r.champions.map((c) => byApi.get(c.apiName)),
                ctx,
            ),
        );
        const gains = runs[0].results.map((r) =>
            onesSwapImprovable(r, level, ctx, runs[0].results),
        );
        const top1 = runs.map((r) => r.results[0]?.score ?? 0);

        out.push({
            level,
            msPerRun: Math.round(
                runs.reduce((s, r) => s + r.ms, 0) / runs.length,
            ),
            improvableBySwap: gains.filter((g) => g > 1e-9).length,
            checked: gains.length,
            meanSwapGain:
                gains.reduce((s, g) => s + g, 0) / Math.max(gains.length, 1),
            top1Spread: Math.max(...top1) - Math.min(...top1),
            deadUnitsPerBoard:
                sanity.reduce((s, x) => s + x.deadUnits, 0) / sanity.length,
            oneShortPerBoard:
                sanity.reduce((s, x) => s + x.oneShort, 0) / sanity.length,
            metaMatchShare:
                all.filter((r) => r.metaMatch).length / Math.max(all.length, 1),
        });
    }

    return out;
}

export async function runEval(argv: string[]): Promise<void> {
    const args = parseArgs(argv);
    const ctx = await loadContext({
        live: false,
        snapshotPath: args.snapshotPath,
    });
    const report = {
        snapshot: args.snapshotPath,
        syncedAt: ctx.syncedAt,
        strength: evalStrength(ctx),
        oracle: existsSync(args.oraclePath)
            ? evalOracle(ctx, args.oraclePath)
            : null,
        search: evalSearch(ctx, args.levels, args.seeds),
    };

    if (args.json) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

        return;
    }

    const s = report.strength;
    const lines = [
        `snapshot ${report.snapshot} (synced ${report.syncedAt})`,
        `strength  Spearman vs real placement of ${s.comps} meta comps: ${s.spearman.toFixed(3)}  90% [${s.interval[0].toFixed(2)}, ${s.interval[1].toFixed(2)}]`,
        `real boards (meta comps, no emblems): dead units ${s.deadUnitsPerBoard.toFixed(2)}/board | traits one short ${s.oneShortPerBoard.toFixed(2)}/board`,
    ];

    const o = report.oracle;

    if (o) {
        const played = o.engine.filter((e) => e.games > 0);
        lines.push(
            `oracle    ${o.boards} real boards (≥300 games): Spearman ${o.overallSpearman.toFixed(3)} | fit real = ${o.calibration.intercept.toFixed(2)} + ${o.calibration.slope.toFixed(3)}·raw`,
            `  fit/size (STRENGTH.calibration: slope ${STRENGTH.calibration.slope}, intercepts ${JSON.stringify(STRENGTH.calibration.intercepts)}) slope ${o.calibrationBySize.slope.toFixed(3)}, intercepts ${Object.entries(
                o.calibrationBySize.intercepts,
            )
                .map(([k, v]) => `${k}: ${v.toFixed(2)}`)
                .join(', ')}`,
            `  choice  ${o.current.groups} "which unit to add" groups: Spearman ${o.current.spearman.toFixed(3)} | regret ${o.current.regret.toFixed(3)} places | top-1 ${(o.current.top1 * 100).toFixed(0)}%`,
            `  vs      random pick regret ${o.baselines.randomRegret.toFixed(3)} | units only (no synergy) regret ${o.baselines.unitsOnly.regret.toFixed(3)} | the crowd's most-played pick regret ${o.baselines.crowd.regret.toFixed(3)}, top-1 ${(o.baselines.crowd.top1 * 100).toFixed(0)}%`,
            `  cv      refit on held-out boards (pair/trait picks ${o.cv.picks.join(' ')}): Spearman ${o.cv.spearman.toFixed(3)} vs current ${o.cv.currentSpearman.toFixed(3)} | regret ${o.cv.regret.toFixed(3)} vs ${o.cv.currentRegret.toFixed(3)}`,
            `  grid    best on all groups: ${o.grid.map((g) => `${g.pairWeight}/${g.traitWeight} ρ ${g.spearman.toFixed(3)}`).join(', ')}`,
            `  engine  boards people played: ${played.length}/${o.engine.length}${played.length ? `, real avg ${(played.reduce((s, e) => s + e.real, 0) / played.length).toFixed(2)}` : ''} | meta comps played as listed: ${o.metaPlayed.boards}, real avg ${o.metaPlayed.meanReal.toFixed(2)}`,
            ...o.engine
                .filter((e) => e.games > 0 || e.neighbours > 0)
                .map(
                    (e) =>
                        `    ${e.label.padEnd(12)} ${e.games ? `played ${e.games}× avg ${e.real.toFixed(2)}` : 'never played'} | ${e.neighbours} played boards one unit away: avg ${e.neighbourReal?.toFixed(2) ?? '–'}, best ${e.bestNeighbour?.toFixed(2) ?? '–'}`,
                ),
            `    (other ${o.engine.filter((e) => !e.games && !e.neighbours).length} engine boards: nothing played within one unit)`,
        );
    }

    for (const r of report.search) {
        lines.push(
            `level ${r.level}  ${r.msPerRun} ms/run | 1-swap improvable ${r.improvableBySwap}/${r.checked} (mean +${r.meanSwapGain.toFixed(1)}) | top1 spread ${r.top1Spread.toFixed(1)} | dead units ${r.deadUnitsPerBoard.toFixed(2)}/board | traits one short ${r.oneShortPerBoard.toFixed(2)}/board | meta matches ${(r.metaMatchShare * 100).toFixed(0)}%`,
        );
    }

    process.stdout.write(`${lines.join('\n')}\n`);
}
