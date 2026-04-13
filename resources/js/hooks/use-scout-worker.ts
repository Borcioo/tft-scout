import { useCallback, useEffect, useRef } from 'react';
import type { ScoutParams, ScoredTeam, WorkerOutMsg } from '@/workers/scout/types';

// Singleton worker shared across all hook consumers on a page.
// Legacy pattern — one worker instance for the entire /scout session,
// terminated when every consumer unmounts.

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
        sharedWorker = new Worker(
            new URL('../workers/scout/index.ts', import.meta.url),
            { type: 'module' },
        );
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
