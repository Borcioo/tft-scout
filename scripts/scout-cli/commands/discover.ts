// @ts-nocheck — consumes the untyped worker modules, like eval.ts
/**
 * `scout-cli discover` — boards worth trying that few people play.
 *
 * For each board, an estimate of its placement among strong players
 * (Master+) from three sources, each weighted by how much it knows:
 *
 *   model    calibrated board strength — what the stats predict, even for
 *            a board nobody played; its error on played boards (τ) is
 *            measured, not assumed
 *   Gold+    the board's real placements in the broad sample, mapped to
 *            the Master+ scale (the two agree at ρ ≈ 0.94)
 *   Master+  its real placements among strong players — few games, but
 *            each counts: ~8–10 of them weigh as much as the model
 *
 * Normal–normal Bayes: posterior precision is the sum of the sources'
 * precisions, the mean their precision-weighted average. A handful of
 * Master+ games moves a board a lot; 10 lucky games still get pulled back.
 *
 * Ranking is expected improvement over the best proven board (Bayesian
 * optimisation): E[max(0, best − θ)]. It rewards a good mean and an
 * uncertain upside, so it surfaces boards that could beat the meta
 * rather than the meta itself. Labels say how much evidence there is.
 *
 * Reads frozen data only: the snapshot and `scout oracle` files (Gold+
 * and --rank MASTER,GRANDMASTER,CHALLENGER). Prints a summary.
 *
 * Usage:
 *   npm run scout -- discover [--snapshot …] [--gold …] [--master …]
 *                             [--top 25] [--json]
 */

import { readFileSync } from 'node:fs';

import { generate } from '../../../resources/js/workers/scout/engine';
import { loadContext } from '../context';
import { rawPlace, resolveBoards } from './eval-oracle';

const PROVEN_GAMES = 300;
const RISING_GAMES = 10;

const games = (p: number[]) => p.reduce((a, b) => a + b, 0);
const mean = (p: number[]) =>
    p.reduce((s, c, i) => s + (i + 1) * c, 0) / games(p);
const variance = (p: number[]) => {
    const m = mean(p);

    return p.reduce((s, c, i) => s + c * (i + 1 - m) ** 2, 0) / games(p);
};

function parseArgs(argv: string[]) {
    const args = {
        snapshotPath: 'tmp/scout-eval/context-18.4b.json',
        gold: 'tmp/scout-eval/oracle-18.4b.json',
        master: 'tmp/scout-eval/oracle-18.4b-master.json',
        top: 25,
        json: false,
    };

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];

        if (a === '--snapshot') {
            args.snapshotPath = argv[++i];
        } else if (a === '--gold') {
            args.gold = argv[++i];
        } else if (a === '--master') {
            args.master = argv[++i];
        } else if (a === '--top') {
            args.top = Number(argv[++i]);
        } else if (a === '--json') {
            args.json = true;
        } else {
            throw new Error(`Unknown flag for discover: ${a}`);
        }
    }

    return args;
}

/** Weighted least squares y ~ a + b·x; returns fit and residual variance. */
function fitLine(xs: number[], ys: number[], ws: number[]) {
    const W = ws.reduce((a, b) => a + b, 0);
    const mx = xs.reduce((s, x, i) => s + ws[i] * x, 0) / W;
    const my = ys.reduce((s, y, i) => s + ws[i] * y, 0) / W;
    let sxy = 0;
    let sxx = 0;

    for (let i = 0; i < xs.length; i++) {
        sxy += ws[i] * (xs[i] - mx) * (ys[i] - my);
        sxx += ws[i] * (xs[i] - mx) ** 2;
    }

    const b = sxy / sxx;
    const a = my - b * mx;
    const resid =
        xs.reduce((s, x, i) => s + (ys[i] - a - b * x) ** 2, 0) / xs.length;

    return { a, b, resid };
}

const phi = (z: number) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
// Abramowitz–Stegun 7.1.26 via erf, plenty for a ranking
function Phi(z: number) {
    const t = 1 / (1 + 0.3275911 * (Math.abs(z) / Math.SQRT2));
    const y =
        1 -
        ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t -
            0.284496736) *
            t +
            0.254829592) *
            t *
            Math.exp(-(z * z) / 2);

    return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** Expected improvement below `best` (lower place = better). */
function expectedImprovement(mu: number, sd: number, best: number) {
    const z = (best - mu) / sd;

    return (best - mu) * Phi(z) + sd * phi(z);
}

export async function runDiscover(argv: string[]): Promise<void> {
    const args = parseArgs(argv);
    const ctx = await loadContext({
        live: false,
        snapshotPath: args.snapshotPath,
    });
    const gold = JSON.parse(readFileSync(args.gold, 'utf8'));
    const master = JSON.parse(readFileSync(args.master, 'utf8'));

    // Boards to judge: everything either sample saw (resolved to our
    // champions; ≥1 game) plus the engine's own top boards
    const all = new Map([
        ...resolveBoards(gold, ctx, 1),
        ...resolveBoards(master, ctx, 1),
    ]);

    for (const level of [8, 9]) {
        const results = generate({
            champions: ctx.champions,
            traits: ctx.traits,
            scoringCtx: ctx.scoringCtx,
            exclusionGroups: ctx.exclusionGroups,
            level,
            topN: 10,
            seed: 1,
            constraints: {},
        });

        for (const r of results) {
            const units = [
                ...new Set<string>(
                    r.champions.map((c) => c.baseApiName || c.apiName),
                ),
            ].sort();
            const key = units.join(',');

            if (!all.has(key)) {
                all.set(key, {
                    key,
                    units,
                    team: r.champions,
                    activeTraits: r.activeTraits,
                    level,
                    games: 0,
                    real: Number.NaN,
                });
            }
        }
    }

    // Calibrate the three sources on the boards where they can be checked
    const hiObs = (k) => master.observations[k]?.places;
    const loObs = (k) => gold.observations[k]?.places;
    const checkable = [...all.values()].filter(
        (b) => hiObs(b.key) && games(hiObs(b.key)) >= 50,
    );
    const sigma2 =
        checkable.reduce((s, b) => s + variance(hiObs(b.key)), 0) /
        checkable.length;
    // Fitted on well-played boards only; rarely played ones are where the
    // model gets used, and there it is optimistic (+0.2 places) and less
    // sure — measured on them below and corrected in the prior
    const provenCheck = checkable.filter(
        (b) => games(hiObs(b.key)) >= PROVEN_GAMES,
    );
    const model = fitLine(
        provenCheck.map((b) => rawPlace(b, ctx)),
        provenCheck.map((b) => mean(hiObs(b.key))),
        provenCheck.map(() => 1),
    );
    const sampling =
        provenCheck.reduce((s, b) => s + sigma2 / games(hiObs(b.key)), 0) /
        provenCheck.length;
    const rare = checkable.filter((b) => games(hiObs(b.key)) < PROVEN_GAMES);
    const rareResid = rare.map(
        (b) => mean(hiObs(b.key)) - (model.a + model.b * rawPlace(b, ctx)),
    );
    const optimism =
        rareResid.reduce((a, r) => a + r, 0) / Math.max(rareResid.length, 1);
    const tauModel2 = Math.max(
        rareResid.reduce((a, r) => a + (r - optimism) ** 2, 0) /
            Math.max(rareResid.length, 1) -
            rare.reduce((a, b) => a + sigma2 / games(hiObs(b.key)), 0) /
                Math.max(rare.length, 1),
        model.resid - sampling,
        0.01,
    );
    const both = checkable.filter(
        (b) => loObs(b.key) && games(loObs(b.key)) >= 300,
    );
    const cross = fitLine(
        both.map((b) => mean(loObs(b.key))),
        both.map((b) => mean(hiObs(b.key))),
        both.map(() => 1),
    );
    const tauCross2 = Math.max(
        cross.resid -
            both.reduce((s, b) => s + sigma2 / games(hiObs(b.key)), 0) /
                both.length,
        0.005,
    );

    // Boards compete within a stratum: same size (level) and number of
    // 5-costs. Across strata the comparison mostly measures who got rich
    // — winners reach level 9 and buy 5-costs — not which board is better
    const stratumOf = (b) =>
        `${b.units.length}|${b.team.filter((c) => c.cost === 5).length}`;
    // The model is trusted inside the raw range of the boards it was
    // checked on, per stratum; beyond it, its estimate stops at the edge
    const rawEdge = new Map<string, number>();

    for (const b of checkable) {
        const k = stratumOf(b);
        rawEdge.set(k, Math.min(rawEdge.get(k) ?? Infinity, rawPlace(b, ctx)));
    }

    const rows = [...all.values()]
        .filter((b) => b.units.length >= 8)
        .map((b) => {
            const stratum = stratumOf(b);
            const raw = Math.max(
                rawPlace(b, ctx),
                rawEdge.get(stratum) ?? -Infinity,
            );
            const muM = model.a + model.b * raw + optimism;
            let precision = 1 / tauModel2;
            let weighted = muM / tauModel2;
            const lo = loObs(b.key);
            const hi = hiObs(b.key);
            const nLo = lo ? games(lo) : 0;
            const nHi = hi ? games(hi) : 0;

            if (nLo > 0) {
                const v = tauCross2 + (cross.b ** 2 * sigma2) / nLo;
                precision += 1 / v;
                weighted += (cross.a + cross.b * mean(lo)) / v;
            }

            if (nHi > 0) {
                precision += nHi / sigma2;
                weighted += (nHi * mean(hi)) / sigma2;
            }

            return {
                units: b.units,
                stratum,
                model: muM,
                extrapolated: raw !== rawPlace(b, ctx),
                nLo,
                nHi,
                realHi: nHi ? mean(hi) : null,
                post: weighted / precision,
                sd: Math.sqrt(1 / precision),
                ei: 0,
                label:
                    nHi >= PROVEN_GAMES
                        ? 'proven'
                        : nHi >= RISING_GAMES
                          ? 'rising'
                          : 'experimental',
            };
        });

    const strata = [...new Set(rows.map((r) => r.stratum))]
        .map((stratum) => {
            const members = rows.filter((r) => r.stratum === stratum);
            const proven = members.filter((r) => r.label === 'proven');

            if (proven.length === 0) {
                return null;
            }

            const best = Math.min(...proven.map((r) => r.post));

            for (const r of members) {
                r.ei = expectedImprovement(r.post, r.sd, best);
            }

            members.sort((a, b) => b.ei - a.ei);
            const [size, fives] = stratum.split('|').map(Number);

            return {
                size,
                fives,
                boards: members.length,
                proven: proven.length,
                best,
                rising: members
                    .filter((r) => r.label === 'rising')
                    .slice(0, args.top),
                experimental: members
                    .filter((r) => r.label === 'experimental')
                    .slice(0, args.top),
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.size - b.size || a.fives - b.fives);

    const report = {
        sources: {
            boards: rows.length,
            checkable: checkable.length,
            tauModel: Math.sqrt(tauModel2),
            optimism,
            tauCross: Math.sqrt(tauCross2),
            sigma2,
            modelFit: { a: model.a, b: model.b },
            crossFit: { a: cross.a, b: cross.b },
        },
        strata,
    };

    if (args.json) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

        return;
    }

    const short = (u: string) => u.replace(/^DA_?(18_)?|18(?=_|$)/g, '');
    const s = report.sources;
    const line = (r) =>
        `    ${r.ei.toFixed(3)}  ${r.post.toFixed(2)}±${r.sd.toFixed(2)}  ${String(r.nHi).padStart(5)}${r.realHi == null ? '       ' : ` (${r.realHi.toFixed(2)})`} ${String(r.nLo).padStart(6)}${r.extrapolated ? ' edge' : '     '}  ${r.units.map(short).join(' ')}`;
    const lines = [
        `discover: ${s.boards} boards of 8+ units | model τ ${s.tauModel.toFixed(2)} (optimism on rare boards ${s.optimism >= 0 ? '+' : ''}${s.optimism.toFixed(2)}, corrected), Gold+→Master+ τ ${s.tauCross.toFixed(2)}, per-game var ${s.sigma2.toFixed(2)}`,
        '    EI     est±sd     Master+ (real)  Gold+         board   (edge = model capped at the best checked raw place)',
    ];

    for (const st of report.strata) {
        lines.push(
            `${st.size} units, ${st.fives}× 5-cost: ${st.boards} boards, ${st.proven} proven, best proven ${st.best.toFixed(2)}`,
        );

        if (st.rising.length) {
            lines.push(
                `  rising (${RISING_GAMES}–${PROVEN_GAMES - 1} Master+ games):`,
            );
            lines.push(...st.rising.map(line));
        }

        if (st.experimental.length) {
            lines.push(`  experimental (<${RISING_GAMES} Master+ games):`);
            lines.push(...st.experimental.map(line));
        }
    }

    process.stdout.write(`${lines.join('\n')}\n`);
}
