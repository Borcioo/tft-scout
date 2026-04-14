import { randomUUID } from 'node:crypto';

// @ts-expect-error engine.ts uses // @ts-nocheck
import { generate } from '../../../resources/js/workers/scout/engine';
import type { ScoutContext } from '../../../resources/js/workers/scout/types';

import type { Db } from './db';
import { currentGitSha } from './git';
import { recordRun } from './ingest';
import { PRESETS, type Preset } from './presets';

export type ExperimentArgs = {
    preset: string | null;
    matrixJson: string | null;
    repeat: number | null;
    seedRange: [number, number] | null;
    tag: string | null;
    dedupe: boolean;
    baseLevel: number;
    baseTopN: number;
};

export type ExperimentResult = {
    experimentId: string;
    runs: number;
    totalMs: number;
    dedupSkipped: number;
};

/** Cartesian product over a matrix object. */
export function expandMatrix(
    matrix: Record<string, (string | number | null)[]>,
): Record<string, string | number | null>[] {
    const keys = Object.keys(matrix);
    if (keys.length === 0) return [{}];
    const combos: Record<string, string | number | null>[] = [{}];
    for (const k of keys) {
        const values = matrix[k];
        const next: Record<string, string | number | null>[] = [];
        for (const partial of combos) {
            for (const v of values) {
                next.push({ ...partial, [k]: v });
            }
        }
        combos.length = 0;
        combos.push(...next);
    }
    return combos;
}

export async function runExperiment(
    db: Db,
    ctx: ScoutContext,
    args: ExperimentArgs,
    onProgress: (done: number, total: number, combo: Record<string, unknown>) => void,
): Promise<ExperimentResult> {
    const experimentId = randomUUID();
    const gitSha = currentGitSha();

    let combos: Record<string, string | number | null>[] = [];

    if (args.preset) {
        const preset: Preset | undefined = PRESETS[args.preset];
        if (!preset)
            throw new Error(
                `Unknown preset: ${args.preset}. Available: ${Object.keys(PRESETS).join(', ')}`,
            );
        combos = expandMatrix(preset.matrix);
    } else if (args.matrixJson) {
        const parsed = JSON.parse(args.matrixJson) as Record<
            string,
            (string | number | null)[]
        >;
        combos = expandMatrix(parsed);
    } else if (args.repeat && args.seedRange) {
        const [lo, hi] = args.seedRange;
        combos = [];
        for (let s = lo; s <= hi; s++) combos.push({ seed: s });
    } else {
        throw new Error(
            'experiment requires one of: --preset, --matrix, or --repeat + --seed-range',
        );
    }

    const start = Date.now();
    let dedupSkipped = 0;
    const seenHashes = new Set<string>();

    for (let i = 0; i < combos.length; i++) {
        const combo = combos[i];
        onProgress(i + 1, combos.length, combo);

        const level = typeof combo.level === 'number' ? combo.level : args.baseLevel;
        const topN = typeof combo.topN === 'number' ? combo.topN : args.baseTopN;
        const seed = typeof combo.seed === 'number' ? combo.seed : 0;
        const minFrontline =
            typeof combo.minFrontline === 'number' ? combo.minFrontline : 0;
        const minDps = typeof combo.minDps === 'number' ? combo.minDps : 0;
        const max5Cost =
            typeof combo.max5Cost === 'number' ? combo.max5Cost : null;

        if (args.dedupe) {
            const key = JSON.stringify({
                level,
                topN,
                seed,
                minFrontline,
                minDps,
                max5Cost,
            });
            if (seenHashes.has(key)) {
                dedupSkipped++;
                continue;
            }
            seenHashes.add(key);
        }

        const runStart = Date.now();
        const out = generate({
            champions: ctx.champions,
            traits: ctx.traits,
            scoringCtx: ctx.scoringCtx,
            constraints: {
                lockedChampions: [],
                excludedChampions: [],
                lockedTraits: [],
                excludedTraits: [],
                emblems: [],
                max5Cost,
                roleBalance: null,
                minFrontline,
                minDps,
            },
            exclusionGroups: ctx.exclusionGroups,
            level,
            topN,
            seed,
            stale: ctx.stale,
        });
        const durationMs = Date.now() - runStart;

        try {
            recordRun(
                db,
                {
                    params: {
                        level,
                        topN,
                        seed,
                        minFrontline,
                        minDps,
                        max5Cost,
                        lockedChampions: [],
                        excludedChampions: [],
                        lockedTraits: [],
                        emblems: [],
                    },
                    results: out,
                    filtered: null,
                },
                {
                    source: 'experiment',
                    command: 'generate',
                    tag: args.tag,
                    experimentId,
                    gitSha,
                    durationMs,
                },
            );
        } catch (err) {
            process.stderr.write(
                `[experiment] run ${i + 1}/${combos.length} failed: ${(err as Error).message}\n`,
            );
        }
    }

    return {
        experimentId,
        runs: combos.length - dedupSkipped,
        totalMs: Date.now() - start,
        dedupSkipped,
    };
}
