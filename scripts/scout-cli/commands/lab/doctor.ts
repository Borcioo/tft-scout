import { statSync } from 'node:fs';

import { currentGitSha } from '../../lab/git';
import { assertDbExists, assertLabEnabled, DEFAULT_DB_PATH, openDb } from '../../lab/db';

export async function runLabDoctor(argv: string[]): Promise<void> {
    assertLabEnabled();
    let dbPath = DEFAULT_DB_PATH;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--db') dbPath = argv[++i];
        else throw new Error(`Unknown flag for lab doctor: ${a}`);
    }
    assertDbExists(dbPath);
    const db = openDb(dbPath, true);

    const version = (
        db.prepare('SELECT version FROM schema_version LIMIT 1').get() as
            | { version: number }
            | undefined
    )?.version ?? null;

    const counts: Record<string, number> = {};
    for (const table of [
        'runs',
        'results',
        'champion_appearances',
        'trait_appearances',
        'breakdown_components',
    ]) {
        counts[table] = (
            db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }
        ).c;
    }

    const tsRow = db
        .prepare('SELECT MIN(ts) AS oldest, MAX(ts) AS newest FROM runs')
        .get() as { oldest: string | null; newest: string | null };

    const latestShaRow = db
        .prepare('SELECT git_sha FROM runs ORDER BY id DESC LIMIT 1')
        .get() as { git_sha: string | null } | undefined;
    const latestSha = latestShaRow?.git_sha ?? null;
    const workingSha = currentGitSha();

    const envEnabled = process.env.SCOUT_LAB_ENABLED === '1';
    const size = statSync(dbPath).size;

    const out: Record<string, unknown> = {
        dbPath,
        sizeBytes: size,
        schemaVersion: version,
        envEnabled,
        tableCounts: counts,
        oldestRun: tsRow.oldest,
        newestRun: tsRow.newest,
        latestRunSha: latestSha,
        workingTreeSha: workingSha,
        shaDrift:
            latestSha && workingSha !== 'unknown' && latestSha !== workingSha
                ? `WARNING: most recent recorded run was against ${latestSha}, current HEAD is ${workingSha}. Consider lab reset or lab prune --sha ${latestSha} before aggregating.`
                : null,
    };

    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    db.close();
}
