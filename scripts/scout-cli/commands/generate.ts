import { readFileSync } from 'node:fs';

// @ts-expect-error — engine.ts uses `// @ts-nocheck`, no public types
import { generate } from '../../../resources/js/workers/scout/engine';
import { loadContext } from '../context';
import { summariseGenerate, type GenerateFilteredCounts } from '../format';
import { parseCommonArgs } from '../params';
import { assertLabEnabled, openDb } from '../lab/db';
import { currentGitSha } from '../lab/git';
import { recordRun } from '../lab/ingest';

export async function runGenerate(argv: string[]): Promise<void> {
    const args = parseCommonArgs(argv);
    const ctx = await loadContext({ live: args.live, snapshotPath: args.snapshotPath });

    if (args.rawInputPath) {
        const raw = JSON.parse(readFileSync(args.rawInputPath, 'utf8'));
        const out = generate(raw);
        printResults(out, args.full);
        return;
    }

    const {
        level = 8,
        topN = 10,
        max5Cost = null,
        roleBalance = null,
        minFrontline = 0,
        minDps = 0,
        lockedChampions = [],
        excludedChampions = [],
        lockedTraits = [],
        excludedTraits = [],
        emblems = [],
        seed = 0,
    } = args.params;

    const start = Date.now();
    const out = generate({
        champions: ctx.champions,
        traits: ctx.traits,
        scoringCtx: ctx.scoringCtx,
        constraints: {
            lockedChampions,
            excludedChampions,
            lockedTraits,
            excludedTraits,
            emblems,
            max5Cost,
            roleBalance,
            minFrontline,
            minDps,
        },
        exclusionGroups: ctx.exclusionGroups,
        level,
        topN,
        seed,
        stale: ctx.stale,
    });
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
                        level,
                        topN,
                        seed,
                        minFrontline,
                        minDps,
                        max5Cost,
                        lockedChampions,
                        excludedChampions,
                        lockedTraits,
                        emblems,
                    },
                    results: out,
                    filtered: null,
                },
                {
                    source: 'cli',
                    command: 'generate',
                    tag: args.tag,
                    gitSha,
                    durationMs,
                },
            );
        } finally {
            db.close();
        }
    }

    printResults(out, args.full);
}

function printResults(results: any[], full: boolean): void {
    if (full) {
        process.stdout.write(JSON.stringify(results, null, 2) + '\n');
        return;
    }
    // We do not have the intermediate raw / enriched / valid counts
    // because `generate` does not expose them. Report the final length
    // for both `afterValidComps` and `afterTopN` and surface raw / enriched
    // as unknown via -1 so the assistant can tell they were not measured.
    const filtered: GenerateFilteredCounts = {
        rawTeams: -1,
        enriched: -1,
        afterValidComps: results.length,
        afterTopN: results.length,
    };
    process.stdout.write(JSON.stringify(summariseGenerate(results, filtered), null, 2) + '\n');
}
