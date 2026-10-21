// @ts-nocheck — consumes the untyped worker modules, like eval.ts
/**
 * Model vs real outcomes of concrete boards (`scout-cli oracle` data).
 *
 * Every observation is "boards that contained exactly these units (at
 * least) → placement histogram". Grouped by the board-minus-one-unit
 * they were asked with, a group is a real choice: these units, which
 * one to add. That is the decision the search and polish make, so the
 * main metrics are per group:
 *   - Spearman of model vs real across the group's completions
 *   - regret: real place of the model's pick − real place of the best
 *     completion, in places
 * plus Spearman over all boards, the calibration fit, how the engine's
 * own boards did when people played them, and a grid over the model's
 * weights scored on held-out groups.
 */

import { readFileSync } from 'node:fs';

import { buildActiveTraits } from '../../../resources/js/workers/scout/active-traits';
import { teamScore } from '../../../resources/js/workers/scout/scorer';
import { STRENGTH } from '../../../resources/js/workers/scout/strength';
import { spearman } from './eval';

const MIN_GAMES = 300;
const MIN_GROUP = 5;

const games = (p: number[]) => p.reduce((a, b) => a + b, 0);
const avgPlace = (p: number[]) =>
    p.reduce((s, c, i) => s + (i + 1) * c, 0) / games(p);

type Board = {
    key: string;
    units: string[];
    team: any[];
    activeTraits: any[];
    level: number;
    games: number;
    real: number;
};

export function resolveBoards(oracle: any, ctx: any): Map<string, Board> {
    const byApi = new Map(
        ctx.champions.filter((c) => !c.lockOnly).map((c) => [c.apiName, c]),
    );
    const formsOf = new Map<string, any[]>();

    for (const c of ctx.champions) {
        if (c.baseApiName && !c.lockOnly && c.variant !== 'hero') {
            formsOf.set(c.baseApiName, [
                ...(formsOf.get(c.baseApiName) ?? []),
                c,
            ]);
        }
    }

    const boards = new Map<string, Board>();

    for (const [key, obs] of Object.entries<any>(oracle.observations)) {
        const n = games(obs.places);

        if (n < MIN_GAMES || obs.units.length < 7) {
            continue;
        }

        // A base MetaTFT lumps its forms under (Lux) is the form the
        // model likes best on this board
        let team = obs.units.map(
            (u) => byApi.get(u) ?? formsOf.get(u)?.[0] ?? null,
        );

        if (team.some((c) => c === null)) {
            continue;
        }

        const level = Math.min(10, obs.units.length);

        for (const [i, u] of obs.units.entries()) {
            const forms = byApi.has(u) ? [] : (formsOf.get(u) ?? []);
            let best = -Infinity;

            for (const form of forms) {
                const t = team.map((c, j) => (j === i ? form : c));
                const s = teamScore(
                    {
                        champions: t,
                        activeTraits: buildActiveTraits(t, ctx.traits, []),
                        level,
                    },
                    ctx.scoringCtx,
                );

                if (s > best) {
                    best = s;
                    team = t;
                }
            }
        }

        boards.set(key, {
            key,
            units: obs.units,
            team,
            activeTraits: buildActiveTraits(team, ctx.traits, []),
            level,
            games: n,
            real: avgPlace(obs.places),
        });
    }

    return boards;
}

/**
 * Groups: the asked-with board minus one unit → its completions. Each
 * keeps the index of the board it came from, so cross-validation can
 * hold out whole boards (their groups share most completions).
 */
export function groupBoards(oracle: any, boards: Map<string, Board>) {
    const groups: { subset: string; source: number; boards: Board[] }[] = [];
    const sources = Object.values<string[]>(oracle.boards);

    for (const subset of oracle.done) {
        const units = subset.split(',');
        const source = sources.findIndex((b) =>
            units.every((u) => b.includes(u)),
        );
        const members = [...boards.values()].filter(
            (b) =>
                b.units.length === units.length + 1 &&
                units.every((u) => b.units.includes(u)),
        );

        if (members.length >= MIN_GROUP) {
            groups.push({ subset, source, boards: members });
        }
    }

    return groups;
}

export const rawPlace = (b: Board, ctx: any) =>
    STRENGTH.baseline -
    teamScore(
        { champions: b.team, activeTraits: b.activeTraits, level: b.level },
        ctx.scoringCtx,
    ) /
        100;

/** Choice quality of any board ranking (lower value = picked first). */
export function choiceMetrics(groups, rank: (b: Board) => number) {
    let rhoSum = 0;
    let regretSum = 0;
    let hits = 0;

    for (const g of groups) {
        const model = g.boards.map(rank);
        const real = g.boards.map((b) => b.real);
        rhoSum += spearman(model, real);

        const pick = model.indexOf(Math.min(...model));
        const best = Math.min(...real);
        regretSum += real[pick] - best;
        hits += real[pick] === best ? 1 : 0;
    }

    const n = groups.length;

    return {
        groups: n,
        spearman: rhoSum / n,
        regret: regretSum / n,
        top1: hits / n,
    };
}

const groupMetrics = (groups, ctx) =>
    choiceMetrics(groups, (b) => rawPlace(b, ctx));

/**
 * Reference points for the choice metrics: a random pick (expected
 * regret), the unit players add most often (the crowd — a benchmark
 * only, never an engine input) and the model without any synergy.
 */
function baselines(groups, ctx) {
    const random =
        groups.reduce((s, g) => {
            const real = g.boards.map((b) => b.real);

            return (
                s +
                real.reduce((a, b) => a + b, 0) / real.length -
                Math.min(...real)
            );
        }, 0) / groups.length;

    return {
        randomRegret: random,
        crowd: choiceMetrics(groups, (b) => -b.games),
        unitsOnly: withWeights(0, 0, () => groupMetrics(groups, ctx)),
    };
}

/** Weighted least squares of real on raw place (weights = games). */
export function calibration(boards: Board[], ctx: any) {
    const xs = boards.map((b) => rawPlace(b, ctx));
    const w = boards.map((b) => b.games);
    const W = w.reduce((a, b) => a + b, 0);
    const mx = xs.reduce((s, x, i) => s + w[i] * x, 0) / W;
    const my = boards.reduce((s, b, i) => s + w[i] * b.real, 0) / W;
    let sxy = 0;
    let sxx = 0;

    for (let i = 0; i < xs.length; i++) {
        sxy += w[i] * (xs[i] - mx) * (boards[i].real - my);
        sxx += w[i] * (xs[i] - mx) ** 2;
    }

    const slope = sxy / sxx;

    return { intercept: my - slope * mx, slope };
}

/**
 * Same fit with one intercept per board size and a shared slope: bigger
 * boards place better at the same raw place (reaching level 9 is itself
 * a sign of winning), which the size-invariant model can't see.
 */
export function calibrationBySize(boards: Board[], ctx: any) {
    const bySize = new Map<number, { x: number; y: number; w: number }[]>();

    for (const b of boards) {
        const size = Math.min(b.units.length, 10);
        const rows = bySize.get(size) ?? [];
        rows.push({ x: rawPlace(b, ctx), y: b.real, w: b.games });
        bySize.set(size, rows);
    }

    const means = new Map<number, { mx: number; my: number }>();
    let sxy = 0;
    let sxx = 0;

    for (const [size, rows] of bySize) {
        const W = rows.reduce((a, r) => a + r.w, 0);
        const mx = rows.reduce((a, r) => a + r.w * r.x, 0) / W;
        const my = rows.reduce((a, r) => a + r.w * r.y, 0) / W;
        means.set(size, { mx, my });

        for (const r of rows) {
            sxy += r.w * (r.x - mx) * (r.y - my);
            sxx += r.w * (r.x - mx) ** 2;
        }
    }

    const slope = sxy / sxx;
    const intercepts: Record<number, number> = {};

    for (const [size, { mx, my }] of means) {
        intercepts[size] = my - slope * mx;
    }

    return { slope, intercepts };
}

/** Run fn with the model's weights temporarily replaced. */
function withWeights<T>(pairWeight: number, traitWeight: number, fn: () => T) {
    const s = STRENGTH as any;
    const saved = [s.pairWeight, s.traitWeight];
    s.pairWeight = pairWeight;
    s.traitWeight = traitWeight;

    try {
        return fn();
    } finally {
        [s.pairWeight, s.traitWeight] = saved;
    }
}

const PAIR_GRID = [0, 0.5, 1, 2, 3, 5];
const TRAIT_GRID = [0, 1, 2, 3, 4, 6];

/**
 * Weights picked on 4/5 of the source boards, scored on the rest — what
 * the model would gain from refitting, without grading it on its own
 * training data.
 */
function crossValidate(groups, ctx) {
    const folds = 5;
    const scored = [];

    for (let f = 0; f < folds; f++) {
        const test = groups.filter((g) => g.source % folds === f);
        const train = groups.filter((g) => g.source % folds !== f);
        let best = null;

        for (const pw of PAIR_GRID) {
            for (const tw of TRAIT_GRID) {
                const m = withWeights(pw, tw, () => groupMetrics(train, ctx));

                // Picked on Spearman: regret hangs on a few groups' top
                // completion and swings 0.01–0.29 between folds
                if (!best || m.spearman > best.spearman) {
                    best = { pw, tw, spearman: m.spearman };
                }
            }
        }

        scored.push({
            ...best,
            test: withWeights(best.pw, best.tw, () => groupMetrics(test, ctx)),
            current: groupMetrics(test, ctx),
        });
    }

    const mean = (part, k) =>
        scored.reduce((s, x) => s + x[part][k], 0) / scored.length;

    return {
        picks: scored.map((s) => `${s.pw}/${s.tw}`),
        spearman: mean('test', 'spearman'),
        regret: mean('test', 'regret'),
        top1: mean('test', 'top1'),
        // Current weights on the same held-out folds — the fair comparison
        currentSpearman: mean('current', 'spearman'),
        currentRegret: mean('current', 'regret'),
    };
}

export function evalOracle(ctx: any, path: string) {
    const oracle = JSON.parse(readFileSync(path, 'utf8'));
    const boards = resolveBoards(oracle, ctx);
    const all = [...boards.values()];
    const groups = groupBoards(oracle, boards);
    const current = groupMetrics(groups, ctx);
    const overall = spearman(
        all.map((b) => rawPlace(b, ctx)),
        all.map((b) => b.real),
    );

    const grid = [];
    for (const pw of PAIR_GRID) {
        for (const tw of TRAIT_GRID) {
            grid.push({
                pairWeight: pw,
                traitWeight: tw,
                ...withWeights(pw, tw, () => groupMetrics(groups, ctx)),
            });
        }
    }
    grid.sort((a, b) => b.spearman - a.spearman);

    // The engine's own boards, as people played them
    const engine = Object.entries<string[]>(oracle.boards)
        .filter(([label]) => label.startsWith('engine:'))
        .map(([label, units]) => {
            const obs = oracle.observations[units.join(',')];
            // Played boards one unit away (same size, all but one unit
            // shared): where the recommendation sits, even unplayed
            const near = Object.values<any>(oracle.observations).filter(
                (o) =>
                    o.units.length === units.length &&
                    o.units.filter((u) => units.includes(u)).length ===
                        units.length - 1 &&
                    games(o.places) >= MIN_GAMES,
            );
            const nearGames = near.reduce((s, o) => s + games(o.places), 0);

            return {
                label,
                games: obs ? games(obs.places) : 0,
                real: obs ? avgPlace(obs.places) : null,
                neighbours: near.length,
                neighbourReal: nearGames
                    ? near.reduce(
                          (s, o) => s + avgPlace(o.places) * games(o.places),
                          0,
                      ) / nearGames
                    : null,
                bestNeighbour: near.length
                    ? Math.min(...near.map((o) => avgPlace(o.places)))
                    : null,
            };
        });
    const meta = Object.entries<string[]>(oracle.boards)
        .filter(([label]) => label.startsWith('meta:'))
        .map(([, units]) => oracle.observations[units.join(',')])
        .filter(Boolean);

    return {
        boards: all.length,
        overallSpearman: overall,
        calibration: calibration(all, ctx),
        calibrationBySize: calibrationBySize(all, ctx),
        current,
        baselines: baselines(groups, ctx),
        grid: grid.slice(0, 5),
        cv: crossValidate(groups, ctx),
        engine,
        metaPlayed: {
            boards: meta.length,
            meanReal:
                meta.reduce((s, o) => s + avgPlace(o.places), 0) /
                (meta.length || 1),
        },
    };
}
