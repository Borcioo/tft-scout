import { loadContext } from '../context';
import { assertLabEnabled, DEFAULT_DB_PATH, initSchema, openDb } from '../lab/db';
import { runExperiment, type ExperimentArgs } from '../lab/experiment';

type ExperimentCliArgs = ExperimentArgs & { live: boolean; snapshotPath: string };

function parseArgs(argv: string[]): ExperimentCliArgs {
    const out: ExperimentCliArgs = {
        preset: null,
        matrixJson: null,
        repeat: null,
        seedRange: null,
        tag: null,
        dedupe: false,
        baseLevel: 8,
        baseTopN: 10,
        live: false,
        snapshotPath: 'tmp/scout-context.json',
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        switch (a) {
            case '--preset':
                out.preset = argv[++i];
                break;
            case '--matrix':
                out.matrixJson = argv[++i];
                break;
            case '--repeat':
                out.repeat = Number(argv[++i]);
                break;
            case '--seed-range': {
                const [lo, hi] = argv[++i].split('-').map(Number);
                out.seedRange = [lo, hi];
                break;
            }
            case '--tag':
                out.tag = argv[++i];
                break;
            case '--dedupe':
                out.dedupe = true;
                break;
            case '--level':
                out.baseLevel = Number(argv[++i]);
                break;
            case '--top-n':
                out.baseTopN = Number(argv[++i]);
                break;
            case '--live':
                out.live = true;
                break;
            case '--snapshot':
                out.snapshotPath = argv[++i];
                break;
            default:
                throw new Error(`Unknown flag for experiment: ${a}`);
        }
    }
    return out;
}

export async function runExperimentCommand(argv: string[]): Promise<void> {
    assertLabEnabled();
    const args = parseArgs(argv);
    const ctx = await loadContext({ live: args.live, snapshotPath: args.snapshotPath });
    const db = openDb(DEFAULT_DB_PATH);
    initSchema(db);
    try {
        const result = await runExperiment(db, ctx, args, (done, total, combo) => {
            process.stderr.write(`[${done}/${total}] ${JSON.stringify(combo)}\n`);
        });
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } finally {
        db.close();
    }
}
