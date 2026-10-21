// @ts-nocheck — consumes the untyped worker modules, like eval.ts
/**
 * `scout-cli oracle` — real outcomes of concrete boards, frozen to disk.
 *
 * MetaTFT's explorer answers "boards that contained all of these units →
 * placements", and /units_unique under such a filter lists every unit
 * that completed those boards with its own placement histogram. So one
 * request on a board minus one unit gives the real outcome of that board
 * and of every played alternative for the missing slot.
 *
 * Boards asked about: the snapshot's meta comps and the engine's own top
 * results per level. Each becomes one request per unit left out. The
 * result is a test and training set for `scout eval` (model vs reality,
 * which unit to add) — never an input to the engine.
 *
 * Fetches once, through metatft-http (cached, one request per 2 s,
 * budgeted per run and per day): progress lives in the output file, a
 * rerun only asks what is missing, and past the budget the run saves and
 * stops. A full run is ~650 requests — over two days' budget; that is
 * the point. Prints a summary, not the data.
 *
 * Usage:
 *   npm run scout -- oracle [--snapshot tmp/scout-eval/context-18.4b.json]
 *                           [--out tmp/scout-eval/oracle-18.4b.json]
 *                           [--patch 18.4b] [--levels 8,9] [--min-games 30]
 *                           [--rank MASTER,GRANDMASTER,CHALLENGER]
 *                           [--budget 300]
 *
 * --rank narrows the sample to those tiers. Lobbies are matched by rank,
 * so placements within a tier average 4.5 — a board that places well
 * there beats players of that skill, not just weaker ones.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { generate } from '../../../resources/js/workers/scout/engine';
import { loadContext } from '../context';
import {
    METATFT_BUDGET,
    MetaTftBudgetError,
    metatftGet,
    metatftRequestsThisRun,
} from '../metatft-http';

const EXPLORER = 'https://api-hc.metatft.com/tft-explorer-api/units_unique';
// Same sample as the sync (MetaTftClient): ranked, Gold+, 2 days, one
// patch, no rank widening
const DEFAULT_RANK =
    'GOLD,PLATINUM,EMERALD,DIAMOND,MASTER,GRANDMASTER,CHALLENGER';

type Observation = {
    /** MetaTFT unit names, sorted. */
    units: string[];
    /** Placement histogram, 1st..8th. */
    places: number[];
};

type OracleFile = {
    patch: string;
    /** Rank tiers sampled (absent in files from before --rank: Gold+). */
    rank?: string;
    fetchedAt: string;
    /** Sorted unit sets already asked about, joined by ','. */
    done: string[];
    /** Boards asked about: source label → units. */
    boards: Record<string, string[]>;
    observations: Record<string, Observation>;
};

function parseArgs(argv: string[]) {
    const args = {
        snapshotPath: 'tmp/scout-eval/context-18.4b.json',
        out: 'tmp/scout-eval/oracle-18.4b.json',
        patch: '18.4b',
        levels: [8, 9],
        minGames: 30,
        budget: METATFT_BUDGET.perRun,
        rank: DEFAULT_RANK,
    };

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];

        if (a === '--snapshot') {
            args.snapshotPath = argv[++i];
        } else if (a === '--out') {
            args.out = argv[++i];
        } else if (a === '--patch') {
            args.patch = argv[++i];
        } else if (a === '--levels') {
            args.levels = argv[++i].split(',').map(Number);
        } else if (a === '--budget') {
            args.budget = Number(argv[++i]);
        } else if (a === '--rank') {
            args.rank = argv[++i];
        } else if (a === '--min-games') {
            args.minGames = Number(argv[++i]);
        } else {
            throw new Error(`Unknown flag for oracle: ${a}`);
        }
    }

    return args;
}

/** "18.4b" → patch=18.4&b_patch=b */
function patchQuery(label: string): string {
    const m = /^(\d+\.\d+)([a-z]?)$/.exec(label);

    if (!m) {
        throw new Error(`--patch expects e.g. 18.4 or 18.4b, got ${label}`);
    }

    return `patch=${m[1]}${m[2] ? `&b_patch=${m[2]}` : ''}`;
}

async function fetchCompletions(units: string[], patch: string, rank: string) {
    const filters = units
        .map((u) => `unit_tier_numitems_unique=${u}-1_.*_.*`)
        .join('&');
    const url = `${EXPLORER}?queue=1100&${patchQuery(patch)}&days=2&rank=${rank}&permit_filter_adjustment=false&formatnoarray=true&compact=true&${filters}`;

    return (await metatftGet(url))?.data ?? [];
}

const games = (places: number[]) => places.reduce((a, b) => a + b, 0);

export async function runOracle(argv: string[]): Promise<void> {
    const args = parseArgs(argv);
    METATFT_BUDGET.perRun = args.budget;
    const ctx = await loadContext({
        live: false,
        snapshotPath: args.snapshotPath,
    });
    const known = new Set(Object.keys(ctx.scoringCtx.unitRatings ?? {}));
    const file: OracleFile = existsSync(args.out)
        ? JSON.parse(readFileSync(args.out, 'utf8'))
        : {
              patch: args.patch,
              rank: args.rank,
              fetchedAt: new Date().toISOString(),
              done: [],
              boards: {},
              observations: {},
          };

    if (file.patch !== args.patch) {
        throw new Error(
            `${args.out} holds patch ${file.patch}, not ${args.patch}`,
        );
    }

    if ((file.rank ?? DEFAULT_RANK) !== args.rank) {
        throw new Error(
            `${args.out} holds ranks ${file.rank ?? DEFAULT_RANK}, not ${args.rank}`,
        );
    }

    // Boards: meta comps as listed, engine results in MetaTFT names
    for (const comp of ctx.scoringCtx.metaComps ?? []) {
        file.boards[`meta:${comp.name}`] = [...new Set(comp.units)]
            .filter((u: string) => known.has(u))
            .sort();
    }

    for (const level of args.levels) {
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

        results.forEach((r, i) => {
            file.boards[`engine:${level}:${i + 1}`] = [
                ...new Set<string>(
                    r.champions.map((c) => c.baseApiName || c.apiName),
                ),
            ]
                .filter((u) => known.has(u))
                .sort();
        });
    }

    const done = new Set(file.done);
    const todo: string[][] = [];

    for (const units of Object.values(file.boards)) {
        for (const left of units) {
            const subset = units.filter((u) => u !== left);
            const key = subset.join(',');

            if (!done.has(key) && !todo.some((t) => t.join(',') === key)) {
                todo.push(subset);
            }
        }
    }

    process.stderr.write(
        `oracle: ${Object.keys(file.boards).length} boards, ${todo.length} requests to make (${done.size} done)\n`,
    );

    let stopped = '';

    for (const [i, subset] of todo.entries()) {
        let rows: any[];

        try {
            rows = await fetchCompletions(subset, args.patch, args.rank);
        } catch (e) {
            if (!(e instanceof MetaTftBudgetError)) {
                throw e;
            }

            stopped = e.message;
            break;
        }

        for (const row of rows) {
            const unit = /^(.*)-1$/.exec(row.units_unique ?? '')?.[1];

            if (
                !unit ||
                subset.includes(unit) ||
                games(row.placement_count) < args.minGames
            ) {
                continue;
            }

            const units = [...subset, unit].sort();
            file.observations[units.join(',')] = {
                units,
                places: row.placement_count,
            };
        }

        file.done.push(subset.join(','));

        // Save as we go: an interrupted run resumes where it stopped
        if (i % 10 === 9 || i === todo.length - 1) {
            writeFileSync(args.out, JSON.stringify(file));
            process.stderr.write(`  ${i + 1}/${todo.length}\n`);
        }
    }

    writeFileSync(args.out, JSON.stringify(file));

    const obs = Object.values(file.observations);
    const counts = obs.map((o) => games(o.places)).sort((a, b) => a - b);
    const exact = Object.entries(file.boards).filter(
        ([, units]) => file.observations[units.join(',')],
    ).length;

    process.stdout.write(
        `${args.out}: ${obs.length} boards with ≥${args.minGames} games (median ${counts[Math.floor(counts.length / 2)] ?? 0}), ${exact}/${Object.keys(file.boards).length} asked-about boards played as such | MetaTFT requests this run: ${metatftRequestsThisRun()}${stopped ? `\nstopped: ${stopped}` : ''}\n`,
    );
}
