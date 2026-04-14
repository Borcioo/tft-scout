/// <reference lib="webworker" />
// Scout Web Worker. Ported from
// legacy/tft-generator/client/src/workers/scout.worker.js.
// Fetches /api/scout/context on first message, then runs the generate
// / roadTo pipelines from the ported algorithm modules.

import { generate } from './engine';
import { generateInsights } from './insights';
import type { ScoutContext, ScoutParams, ScoredTeam, WorkerInMsg, WorkerOutMsg } from './types';

declare const self: DedicatedWorkerGlobalScope;

let cachedContext: ScoutContext | null = null;

async function fetchContext(): Promise<ScoutContext> {
    if (cachedContext) return cachedContext;
    // In dev the worker runs under a `blob:` origin injected by
    // use-scout-worker.ts, which can't resolve root-relative URLs.
    // The hook sets `self.__API_BASE__` so we can build absolutes.
    // Empty string falls through to normal same-origin behavior in
    // prod where the worker inherits the page origin directly.
    const base = (self as unknown as { __API_BASE__?: string }).__API_BASE__ ?? '';
    const res = await fetch(`${base}/api/scout/context`, {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
    });
    if (!res.ok) throw new Error(`Context fetch failed: ${res.status}`);
    cachedContext = (await res.json()) as ScoutContext;
    return cachedContext;
}

function mapResult(r: any): ScoredTeam {
    return {
        champions: (r.champions ?? []).map((c: any) => ({
            apiName: c.apiName,
            baseApiName: c.baseApiName ?? null,
            name: c.name,
            cost: c.cost,
            role: c.role ?? null,
            traits: c.traits ?? [],
            traitNames: c.traitNames ?? c.traits ?? [],
            variant: c.variant ?? null,
            slotsUsed: c.slotsUsed ?? 1,
            icon: c.icon ?? '',
            plannerCode: c.plannerCode ?? null,
        })),
        activeTraits: (r.activeTraits ?? []).map((t: any) => ({
            apiName: t.apiName,
            name: t.name,
            icon: t.icon ?? null,
            count: t.count,
            style: t.activeStyle ?? null,
            breakpoint: t.activeBreakpoint ?? null,
        })),
        score: Math.round(r.score * 100) / 100,
        breakdown: r.breakdown ?? null,
        level: r.level,
        slotsUsed: r.slotsUsed,
        roles: r.roles ?? null,
        metaMatch: r.metaMatch ?? null,
        insights: r.insights ?? null,
    };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function runGenerate(ctx: ScoutContext, params: ScoutParams) {
    const p = params as any;
    const {
        lockedChampions = [],
        excludedChampions = [],
        lockedTraits = [],
        excludedTraits = [],
        emblems = [],
        level = 8,
        topN = 10,
        max5Cost = null,
        roleBalance = null,
        seed = 0,
    } = p;

    const constraints: any = {
        lockedChampions,
        excludedChampions,
        lockedTraits,
        excludedTraits,
        emblems,
        max5Cost,
        roleBalance,
    };

    const results = generate({
        champions: ctx.champions,
        traits: ctx.traits,
        scoringCtx: ctx.scoringCtx,
        constraints,
        exclusionGroups: ctx.exclusionGroups,
        level,
        topN,
        seed,
        stale: ctx.stale,
    });

    const insights = generateInsights({
        champions: ctx.champions,
        traits: ctx.traits,
        lockedChampions,
        emblems,
        level,
        scoringCtx: ctx.scoringCtx,
    });

    return { results: results.map(mapResult), insights };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

self.onmessage = async (e: MessageEvent<WorkerInMsg>) => {
    const msg = e.data;

    try {
        const ctx = await fetchContext();

        if (msg.type === 'generate') {
            const result = await runGenerate(ctx, msg.params);
            const out: WorkerOutMsg = { id: msg.id, result };
            self.postMessage(out);
        } else {
            // roadTo deferred to post-MVP per spec
            throw new Error(`Unknown or deferred message type: ${msg.type}`);
        }
    } catch (err) {
        const out: WorkerOutMsg = {
            id: msg.id,
            error: err instanceof Error ? err.message : String(err),
        };
        self.postMessage(out);
    }
};
