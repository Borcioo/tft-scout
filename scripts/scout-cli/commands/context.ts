import type { ScoutContext } from '../../../resources/js/workers/scout/types';
import { DEFAULT_SNAPSHOT_PATH, loadContext } from '../context';
import { findChampion, findTrait } from '../lookup';

export type ContextArgs = {
    champion: string | null;
    trait: string | null;
    snapshotPath: string;
    live: boolean;
};

export function parseContextArgs(argv: string[]): ContextArgs {
    let champion: string | null = null;
    let trait: string | null = null;
    let snapshotPath = DEFAULT_SNAPSHOT_PATH;
    let live = false;

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];

        if (a === '--champion') {
champion = argv[++i];
} else if (a === '--trait') {
trait = argv[++i];
} else if (a === '--snapshot') {
snapshotPath = argv[++i];
} else if (a === '--live') {
live = true;
} else {
throw new Error(`Unknown flag for context: ${a}`);
}
    }

    return { champion, trait, snapshotPath, live };
}

export async function runContext(args: ContextArgs): Promise<void> {
    const ctx = await loadContext({ live: args.live, snapshotPath: args.snapshotPath });

    if (args.champion) {
        process.stdout.write(JSON.stringify(findChampion(ctx, args.champion), null, 2) + '\n');

        return;
    }

    if (args.trait) {
        process.stdout.write(JSON.stringify(findTrait(ctx, args.trait), null, 2) + '\n');

        return;
    }

    process.stdout.write(JSON.stringify(meta(ctx), null, 2) + '\n');
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
