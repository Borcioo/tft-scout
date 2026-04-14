import { useCallback, useEffect, useRef } from 'react';
import ScoutWorker from '@/workers/scout/index?worker&inline';
import type { ScoutParams, ScoredTeam, WorkerOutMsg } from '@/workers/scout/types';

// Singleton worker shared across all hook consumers on a page.
// Legacy pattern — one worker instance for the entire /scout session,
// terminated when every consumer unmounts.
//
// Cross-origin worker problem (dev only):
//
// Herd serves the page on https://tft-scout.test (:443). Vite's dev
// server runs on :5173. `new Worker(crossOriginUrl, {type:'module'})`
// throws SecurityError regardless of CORS headers — the HTML spec
// requires module worker script URLs to be same-origin with the page.
//
// `?worker&inline` is a BUILD-time transform — in dev, Vite still
// serves the worker from :5173, so the inline import alone doesn't
// help. Workaround: in dev, build a tiny same-origin blob stub that
// does `import "<vite-url>"`. The blob inherits the page origin so
// `new Worker` accepts it, and the dynamic ES import inside the worker
// goes through CORS (server.cors: true in vite.config.ts). In prod,
// `?worker&inline` produces a real inlined blob at build time, so we
// use it directly — same file, two code paths.

let sharedWorker: Worker | null = null;
let refCount = 0;
let msgId = 0;

type Pending = {
    resolve: (value: { results: ScoredTeam[]; insights: unknown }) => void;
    reject: (reason: Error) => void;
};

const pending = new Map<number, Pending>();

function createWorker(): Worker {
    if (import.meta.env.DEV) {
        // Vite rewrites `new URL(..., import.meta.url)` at transform
        // time to the dev server URL for the entry file. We don't
        // pass it to `new Worker` directly (that's the cross-origin
        // error) — instead we wrap it in a same-origin blob that
        // dynamically imports it. Vite's CORS headers allow the
        // import; the blob's origin satisfies the Worker SOP check.
        const workerUrl = new URL(
            '../workers/scout/index.ts',
            import.meta.url,
        ).href;
        // Blob workers run under a `blob:` origin with no host, so
        // `fetch('/api/...')` inside the worker throws "Failed to parse
        // URL". Inject the page origin as a global so the worker can
        // build absolute URLs. In prod (`?worker&inline`) the page
        // origin is inherited automatically, so this only matters here.
        const stub =
            `self.__API_BASE__=${JSON.stringify(location.origin)};` +
            `import ${JSON.stringify(workerUrl)};`;
        const blobUrl = URL.createObjectURL(
            new Blob([stub], { type: 'application/javascript' }),
        );

        return new Worker(blobUrl, { type: 'module' });
    }

    return new ScoutWorker();
}

function getWorker(): Worker {
    if (!sharedWorker) {
        sharedWorker = createWorker();
        sharedWorker.onmessage = (e: MessageEvent<WorkerOutMsg>) => {
            const msg = e.data;
            const handler = pending.get(msg.id);

            if (!handler) {
return;
}

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
