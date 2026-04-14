import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import type { ScoutContext } from '../../resources/js/workers/scout/types';

export const DEFAULT_SNAPSHOT_PATH = 'tmp/scout-context.json';

export type LoadOptions = {
    live: boolean;
    snapshotPath: string;
};

/**
 * Load the ScoutContext.
 *
 * - --live                  Always fetches /api/scout/context.
 * - default + snapshot      Reads the snapshot file from disk.
 * - default + no snapshot   Throws with a hint to run `snapshot` or pass --live.
 */
export async function loadContext(opts: LoadOptions): Promise<ScoutContext> {
    if (opts.live) {
        return await fetchLive();
    }
    if (!existsSync(opts.snapshotPath)) {
        throw new Error(
            `No snapshot at ${opts.snapshotPath}. Run \`npm run scout -- snapshot\` first or pass --live.`,
        );
    }
    const raw = readFileSync(opts.snapshotPath, 'utf8');
    try {
        return JSON.parse(raw) as ScoutContext;
    } catch (err) {
        throw new Error(
            `Snapshot at ${opts.snapshotPath} is malformed JSON: ${(err as Error).message}. Re-run \`npm run scout -- snapshot\`.`,
        );
    }
}

export async function fetchLive(): Promise<ScoutContext> {
    const base = process.env.SCOUT_API_BASE ?? 'http://localhost';
    const url = `${base}/api/scout/context`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
        throw new Error(`Live fetch ${url} failed: HTTP ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as ScoutContext;
}

export function writeSnapshot(path: string, ctx: ScoutContext): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(ctx, null, 2), 'utf8');
}
