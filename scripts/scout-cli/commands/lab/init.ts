import { assertLabEnabled, DEFAULT_DB_PATH, initSchema, openDb } from '../../lab/db';

export async function runLabInit(argv: string[]): Promise<void> {
    assertLabEnabled();
    let dbPath = DEFAULT_DB_PATH;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--db') dbPath = argv[++i];
        else throw new Error(`Unknown flag for lab init: ${a}`);
    }
    const db = openDb(dbPath);
    initSchema(db);
    process.stdout.write(
        JSON.stringify({ initialised: dbPath, schemaVersion: 1 }, null, 2) + '\n',
    );
    db.close();
}
