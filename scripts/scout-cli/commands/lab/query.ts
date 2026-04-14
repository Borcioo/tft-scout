import { assertDbExists, assertLabEnabled, DEFAULT_DB_PATH, openDb } from '../../lab/db';

export async function runLabQuery(argv: string[]): Promise<void> {
    assertLabEnabled();
    let sql: string | null = null;
    let limit = 1000;
    let asCsv = false;
    let dbPath = DEFAULT_DB_PATH;

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith('--') && sql === null) {
            sql = a;
            continue;
        }
        switch (a) {
            case '--limit':
                limit = Number(argv[++i]);
                break;
            case '--csv':
                asCsv = true;
                break;
            case '--db':
                dbPath = argv[++i];
                break;
            default:
                throw new Error(`Unknown flag for lab query: ${a}`);
        }
    }

    if (!sql) {
        throw new Error(
            'lab query requires a SQL string as the first positional argument.',
        );
    }

    assertDbExists(dbPath);
    const db = openDb(dbPath, true);
    db.pragma('query_only = ON');

    try {
        const stmt = db.prepare(sql);
        const rows = stmt.all() as Record<string, unknown>[];
        const sliced = rows.slice(0, limit);
        const columns = sliced.length > 0 ? Object.keys(sliced[0]) : [];

        if (asCsv) {
            const lines = [columns.join(',')];
            for (const r of sliced) {
                lines.push(columns.map((c) => csvField(r[c])).join(','));
            }
            process.stdout.write(lines.join('\n') + '\n');
        } else {
            process.stdout.write(
                JSON.stringify(
                    {
                        columns,
                        rows: sliced,
                        truncated: rows.length > limit ? rows.length - limit : 0,
                    },
                    null,
                    2,
                ) + '\n',
            );
        }
    } finally {
        db.close();
    }
}

function csvField(value: unknown): string {
    if (value === null || value === undefined) return '';
    const s = String(value);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}
