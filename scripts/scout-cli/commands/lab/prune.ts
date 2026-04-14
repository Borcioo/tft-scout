import { assertDbExists, assertLabEnabled, DEFAULT_DB_PATH, openDb } from '../../lab/db';

type PruneArgs = {
    olderThan: string | null;
    experimentId: string | null;
    tag: string | null;
    sha: string | null;
    all: boolean;
    yes: boolean;
    dbPath: string;
};

function parseDuration(s: string): number {
    const m = /^(\d+)([hdw])$/.exec(s);

    if (!m) {
throw new Error(`Bad duration "${s}". Use e.g. 6h, 7d, 2w.`);
}

    const n = Number(m[1]);
    const mult: Record<string, number> = { h: 3600, d: 86400, w: 604800 };

    return n * mult[m[2]] * 1000;
}

export async function runLabPrune(argv: string[]): Promise<void> {
    assertLabEnabled();
    const args: PruneArgs = {
        olderThan: null,
        experimentId: null,
        tag: null,
        sha: null,
        all: false,
        yes: false,
        dbPath: DEFAULT_DB_PATH,
    };

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];

        switch (a) {
            case '--older-than':
                args.olderThan = argv[++i];
                break;
            case '--experiment':
                args.experimentId = argv[++i];
                break;
            case '--tag':
                args.tag = argv[++i];
                break;
            case '--sha':
                args.sha = argv[++i];
                break;
            case '--all':
                args.all = true;
                break;
            case '--yes':
                args.yes = true;
                break;
            case '--db':
                args.dbPath = argv[++i];
                break;
            default:
                throw new Error(`Unknown flag for lab prune: ${a}`);
        }
    }

    if (args.all && !args.yes) {
        throw new Error('lab prune --all requires --yes to confirm');
    }

    assertDbExists(args.dbPath);
    const db = openDb(args.dbPath);

    try {
        let whereSql = '';
        const params: Record<string, unknown> = {};

        if (args.all) {
            whereSql = '';
        } else if (args.experimentId) {
            whereSql = 'WHERE experiment_id = @experimentId';
            params.experimentId = args.experimentId;
        } else if (args.tag) {
            whereSql = 'WHERE tag = @tag';
            params.tag = args.tag;
        } else if (args.sha) {
            whereSql = 'WHERE git_sha = @sha';
            params.sha = args.sha;
        } else if (args.olderThan) {
            const cutoff = new Date(
                Date.now() - parseDuration(args.olderThan),
            ).toISOString();
            whereSql = 'WHERE ts < @cutoff';
            params.cutoff = cutoff;
        } else {
            throw new Error(
                'lab prune requires one of: --older-than, --experiment, --tag, --sha, --all --yes',
            );
        }

        const del = db.prepare(`DELETE FROM runs ${whereSql}`);
        const tx = db.transaction(() => del.run(params));
        const info = tx();
        process.stdout.write(
            JSON.stringify({ deleted: Number(info.changes) }, null, 2) + '\n',
        );
    } finally {
        db.close();
    }
}
