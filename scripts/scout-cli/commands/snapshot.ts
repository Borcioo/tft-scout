import { DEFAULT_SNAPSHOT_PATH, fetchLive, writeSnapshot } from '../context';
import type { ScoutContext } from '../../../resources/js/workers/scout/types';

export type SnapshotArgs = {
    inspect: boolean;
    snapshotPath: string;
};

export function parseSnapshotArgs(argv: string[]): SnapshotArgs {
    let inspect = false;
    let snapshotPath = DEFAULT_SNAPSHOT_PATH;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--inspect') inspect = true;
        else if (a === '--snapshot') snapshotPath = argv[++i];
        else throw new Error(`Unknown flag for snapshot: ${a}`);
    }
    return { inspect, snapshotPath };
}

export async function runSnapshot(args: SnapshotArgs): Promise<void> {
    const ctx = await fetchLive();
    if (args.inspect) {
        process.stdout.write(JSON.stringify(meta(ctx), null, 2) + '\n');
        return;
    }
    writeSnapshot(args.snapshotPath, ctx);
    process.stdout.write(
        JSON.stringify(
            {
                wrote: args.snapshotPath,
                ...meta(ctx),
            },
            null,
            2,
        ) + '\n',
    );
}

function meta(ctx: ScoutContext) {
    return {
        champions: ctx.champions.length,
        traits: ctx.traits.length,
        exclusionGroups: ctx.exclusionGroups?.length ?? 0,
        scoringCtx: {
            unitRatings: Object.keys(ctx.scoringCtx?.unitRatings ?? {}).length,
            traitRatings: Object.keys(ctx.scoringCtx?.traitRatings ?? {}).length,
            metaComps: ctx.scoringCtx?.metaComps?.length ?? 0,
        },
        syncedAt: ctx.syncedAt ?? null,
        stale: ctx.stale ?? false,
    };
}
