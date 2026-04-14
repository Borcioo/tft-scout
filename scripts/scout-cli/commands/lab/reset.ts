import { existsSync, unlinkSync } from 'node:fs';

import { assertLabEnabled, DEFAULT_DB_PATH, initSchema, openDb } from '../../lab/db';

export async function runLabReset(argv: string[]): Promise<void> {
    assertLabEnabled();
    let dbPath = DEFAULT_DB_PATH;
    let yes = false;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--db') dbPath = argv[++i];
        else if (a === '--yes') yes = true;
        else throw new Error(`Unknown flag for lab reset: ${a}`);
    }

    if (!yes) {
        throw new Error('lab reset wipes all recorded runs. Pass --yes to confirm.');
    }

    if (existsSync(dbPath)) {
        unlinkSync(dbPath);
    }
    const db = openDb(dbPath);
    initSchema(db);
    db.close();

    process.stdout.write(
        JSON.stringify({ reset: dbPath, schemaVersion: 1 }, null, 2) + '\n',
    );
}
