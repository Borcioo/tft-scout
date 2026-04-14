import { assertDbExists, DEFAULT_DB_PATH, openDb } from '../../lab/db';
import { rowsToMarkdown, STATS, type Scope } from '../../lab/queries';

export async function runLabStats(argv: string[]): Promise<void> {
    let name: string | null = null;
    const scope: Scope = {
        experimentId: null,
        tag: null,
        lastN: 500,
        since: null,
        all: false,
    };
    let asJson = false;
    let dbPath = DEFAULT_DB_PATH;

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith('--') && name === null) {
            name = a;
            continue;
        }
        switch (a) {
            case '--experiment':
                scope.experimentId = argv[++i];
                break;
            case '--tag':
                scope.tag = argv[++i];
                break;
            case '--last':
                scope.lastN = Number(argv[++i]);
                break;
            case '--since':
                scope.since = argv[++i];
                break;
            case '--all':
                scope.all = true;
                break;
            case '--json':
                asJson = true;
                break;
            case '--db':
                dbPath = argv[++i];
                break;
            default:
                throw new Error(`Unknown flag for lab stats: ${a}`);
        }
    }

    if (!name) {
        const lines = ['Available stats:', ''];
        for (const [key, def] of Object.entries(STATS)) {
            lines.push(`  ${key}  -  ${def.description}`);
        }
        lines.push('');
        lines.push(
            'Scope flags: --experiment <id> --tag <label> --last <N> (default 500) --since <iso> --all',
        );
        process.stdout.write(lines.join('\n') + '\n');
        return;
    }

    const def = STATS[name];
    if (!def) {
        throw new Error(`Unknown stat: ${name}. Run 'lab stats' for the list.`);
    }

    assertDbExists(dbPath);
    const db = openDb(dbPath, true);
    db.pragma('query_only = ON');
    try {
        const { sql, params } = def.build(scope);
        const stmt = db.prepare(sql);
        const rows = stmt.all(params) as Record<string, unknown>[];
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
        if (asJson) {
            process.stdout.write(
                JSON.stringify({ name, scope, columns, rows }, null, 2) + '\n',
            );
        } else {
            process.stdout.write(`# ${name}\n\n${def.description}\n\n`);
            process.stdout.write(rowsToMarkdown(columns, rows));
        }
    } finally {
        db.close();
    }
}
