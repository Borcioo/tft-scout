import { useCallback, useEffect, useRef } from 'react';
import ScoutWorker from '@/workers/scout/index?worker&inline';
import type { ScoutParams, ScoredTeam, WorkerOutMsg } from '@/workers/scout/types';

// Singleton worker shared across all hook consumers on a page.
// Legacy pattern — one worker instance for the entire /scout session,
// terminated when every consumer unmounts.
//
// The `?worker&inline` import tells Vite to embed the worker script as
// a base64 blob inside the main bundle. Two reasons it matters:
//
// 1. In dev with Laravel Herd, the page is served from
//    https://tft-scout.test (port 443) while Vite serves assets from
//    :5173. `new Worker(new URL('./worker.ts', import.meta.url))`
//    resolves to :5173, which the browser rejects with SecurityError
//    because `new Worker` requires a same-origin script URL.
// 2. `&inline` sidesteps the whole origin check by handing the worker
//    a `blob:` URL generated client-side from the embedded base64
//    script. Same origin as the page, always.
//
// Bundle size cost: the worker + all its imports (scout algorithm,
// ~30 KB gzipped) are inlined into the main chunk. Acceptable for a
// single-page app where users hit /scout deliberately.

let sharedWorker: Worker | null = null;
let refCount = 0;
let msgId = 0;

type Pending = {
    resolve: (value: { results: ScoredTeam[]; insights: unknown }) => void;
    reject: (reason: Error) => void;
};

const pending = new Map<number, Pending>();

function getWorker(): Worker {
    if (!sharedWorker) {
        sharedWorker = new ScoutWorker();
        sharedWorker.onmessage = (e: MessageEvent<WorkerOutMsg>) => {
            const msg = e.data;
            const handler = pending.get(msg.id);
            if (!handler) return;
            pending.delete(msg.id);

            if ('error' in msg) {
                handler.reject(new Error(msg.error));
            } else {
                handler.resolve(msg.result);
            }
        };
    }
    refCount++;
    return sharedWorker;
}

function releaseWorker() {
    refCount--;
    if (refCount <= 0 && sharedWorker) {
        sharedWorker.terminate();
        sharedWorker = null;
        refCount = 0;
        pending.clear();
    }
}

function sendMessage(type: 'generate', params: ScoutParams) {
    const id = ++msgId;
    return new Promise<{ results: ScoredTeam[]; insights: unknown }>(
        (resolve, reject) => {
            pending.set(id, { resolve, reject });
            sharedWorker!.postMessage({ type, id, params });
        },
    );
}

export function useScoutWorker() {
    const workerRef = useRef<Worker | null>(null);

    useEffect(() => {
        workerRef.current = getWorker();
        return () => releaseWorker();
    }, []);

    const generate = useCallback((params: ScoutParams) => {
        return sendMessage('generate', params);
    }, []);

    return { generate };
}
