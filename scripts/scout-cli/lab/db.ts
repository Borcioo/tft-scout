import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

export const DEFAULT_DB_PATH = 'tmp/scout-lab/runs.db';
export const CURRENT_SCHEMA_VERSION = 1;

const SCHEMA_PATH = resolve(
    dirname(fileURLToPath(import.meta.url)),
    'schema.sql',
);

export type Db = Database.Database;

export function assertLabEnabled(): void {
    if (process.env.SCOUT_LAB_ENABLED !== '1') {
        throw new Error(
            'Scout lab disabled. Set SCOUT_LAB_ENABLED=1 to use lab/experiment/record commands.',
        );
    }
}

/** Opens (and creates if missing) the DB file. Applies WAL pragmas. */
export function openDb(path: string = DEFAULT_DB_PATH, readonly = false): Db {
    mkdirSync(dirname(path), { recursive: true });
    const db = new Database(path, { readonly });
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');

    return db;
}

/** Applies schema.sql. Idempotent — safe on existing DBs. */
export function initSchema(db: Db): void {
    const sql = readFileSync(SCHEMA_PATH, 'utf8');
    db.exec(sql);
    const row = db
        .prepare('SELECT version FROM schema_version LIMIT 1')
        .get() as { version: number } | undefined;

    if (!row) {
        db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(
            CURRENT_SCHEMA_VERSION,
        );
    } else if (row.version !== CURRENT_SCHEMA_VERSION) {
        throw new Error(
            `Schema version mismatch: DB is v${row.version}, code expects v${CURRENT_SCHEMA_VERSION}. Migration not yet implemented — run \`npm run scout -- lab reset --yes\` to start fresh.`,
        );
    }
}

/** Assert the DB exists at the given path. Throws with init hint if not. */
export function assertDbExists(path: string = DEFAULT_DB_PATH): void {
    if (!existsSync(path)) {
        throw new Error(
            `DB not initialised at ${path}. Run: npm run scout -- lab init`,
        );
    }
}
