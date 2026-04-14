import { readFileSync } from 'node:fs';

import { DEFAULT_SNAPSHOT_PATH } from './context';
import type { ScoutParams } from '../../resources/js/workers/scout/types';

/**
 * Shared flag set understood by the `generate` and `phase` commands.
 * Per-team phases additionally accept `--team`.
 */
export type CommonArgs = {
    params: ScoutParams;
    team: string[] | null;
    full: boolean;
    live: boolean;
    snapshotPath: string;
    rawInputPath: string | null;
};

export function parseCommonArgs(argv: string[]): CommonArgs {
    const out: CommonArgs = {
        params: {},
        team: null,
        full: false,
        live: false,
        snapshotPath: DEFAULT_SNAPSHOT_PATH,
        rawInputPath: null,
    };

    let paramsFile: string | null = null;

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        switch (a) {
            case '--level':
                out.params.level = Number(argv[++i]);
                break;
            case '--top-n':
                out.params.topN = Number(argv[++i]);
                break;
            case '--max-5cost':
                out.params.max5Cost = Number(argv[++i]);
                break;
            case '--min-frontline':
                out.params.minFrontline = Number(argv[++i]);
                break;
            case '--min-dps':
                out.params.minDps = Number(argv[++i]);
                break;
            case '--locked':
                out.params.lockedChampions = csv(argv[++i]);
                break;
            case '--excluded':
                out.params.excludedChampions = csv(argv[++i]);
                break;
            case '--locked-trait':
                out.params.lockedTraits = parseTraitLocks(argv[++i]);
                break;
            case '--emblem':
                out.params.emblems = parseEmblems(argv[++i]);
                break;
            case '--seed':
                out.params.seed = Number(argv[++i]);
                break;
            case '--team':
                out.team = csv(argv[++i]);
                break;
            case '--params':
                paramsFile = argv[++i];
                break;
            case '--raw-input':
                out.rawInputPath = argv[++i];
                break;
            case '--full':
                out.full = true;
                break;
            case '--live':
                out.live = true;
                break;
            case '--snapshot':
                out.snapshotPath = argv[++i];
                break;
            default:
                throw new Error(`Unknown flag: ${a}`);
        }
    }

    // --params file wins for the keys it specifies; individual flags
    // fill in whatever the file did not set.
    if (paramsFile) {
        const fileParams = JSON.parse(readFileSync(paramsFile, 'utf8')) as ScoutParams;
        out.params = { ...out.params, ...fileParams };
    }

    return out;
}

function csv(value: string | undefined): string[] {
    if (!value) return [];
    return value
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}

function parseTraitLocks(value: string | undefined): { apiName: string; minUnits: number }[] {
    return csv(value).map((entry) => {
        const [apiName, minUnits] = entry.split(':');
        if (!apiName || !minUnits) {
            throw new Error(`--locked-trait expects "apiName:minUnits", got "${entry}"`);
        }
        return { apiName, minUnits: Number(minUnits) };
    });
}

function parseEmblems(value: string | undefined): { apiName: string; count: number }[] {
    return csv(value).map((entry) => {
        const [apiName, count] = entry.split(':');
        if (!apiName || !count) {
            throw new Error(`--emblem expects "apiName:count", got "${entry}"`);
        }
        return { apiName, count: Number(count) };
    });
}
