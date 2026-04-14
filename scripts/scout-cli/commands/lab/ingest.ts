import { openDb } from '../../lab/db';
import { currentGitSha } from '../../lab/git';
import { recordRun } from '../../lab/ingest';
import type { RecordRunInput, RecordRunMeta } from '../../lab/ingest';

type IngestBody = {
    params?: RecordRunInput['params'];
    results?: unknown[];
    filtered?: Record<string, number> | null;
    source?: RecordRunMeta['source'];
    command?: string;
    tag?: string | null;
    durationMs?: number;
    notes?: string | null;
};

async function readStdinJson(): Promise<IngestBody> {
    const chunks: Buffer[] = [];

    for await (const chunk of process.stdin) {
        chunks.push(chunk as Buffer);
    }

    const raw = Buffer.concat(chunks).toString('utf8').trim();

    if (!raw) {
        throw new Error('lab ingest: no JSON body on stdin');
    }

    try {
        return JSON.parse(raw) as IngestBody;
    } catch (err) {
        throw new Error(`lab ingest: invalid JSON on stdin — ${(err as Error).message}`);
    }
}

/**
 * `scout-cli lab ingest` — reads a JSON run payload from stdin and
 * records it into tmp/scout-lab/runs.db using the same recordRun
 * helper the experiment / --record paths use. Exists so the Laravel
 * backend can pipe a UI-originated generate call into the lab DB
 * without re-implementing the SQLite schema in PHP.
 */
export async function runLabIngest(): Promise<void> {
    // openDb() below throws with a clear message when SCOUT_LAB_ENABLED
    // isn't set, so no dedicated guard is needed here.
    const body = await readStdinJson();

    if (!body.params || !Array.isArray(body.results)) {
        throw new Error('lab ingest: body must include `params` and `results[]`');
    }

    const meta: RecordRunMeta = {
        source: body.source ?? 'ui',
        command: body.command ?? 'generate',
        tag: body.tag ?? null,
        experimentId: null,
        gitSha: currentGitSha(),
        durationMs: typeof body.durationMs === 'number' ? body.durationMs : 0,
        notes: body.notes ?? null,
    };

    const db = openDb();
    const runId = recordRun(
        db,
        {
            params: body.params,
            results: body.results as RecordRunInput['results'],
            filtered: body.filtered ?? null,
        },
        meta,
    );

    process.stdout.write(JSON.stringify({ runId, source: meta.source, gitSha: meta.gitSha }) + '\n');
}
