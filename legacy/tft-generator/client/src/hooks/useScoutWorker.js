// client/src/hooks/useScoutWorker.js
import { useRef, useEffect, useCallback } from 'react';

let sharedWorker = null;
let refCount = 0;
const pending = new Map();
let msgId = 0;

function getWorker() {
  if (!sharedWorker) {
    sharedWorker = new Worker(
      new URL('../workers/scout.worker.js', import.meta.url),
      { type: 'module' }
    );
    sharedWorker.onmessage = (e) => {
      const { id, result, error } = e.data;
      if (id == null) return; // ignore 'ready' signal
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (error) p.reject(new Error(error));
      else p.resolve(result);
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

function sendMessage(type, params) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    sharedWorker.postMessage({ type, id, params });
  });
}

export function useScoutWorker() {
  const workerRef = useRef(null);

  useEffect(() => {
    workerRef.current = getWorker();
    return () => releaseWorker();
  }, []);

  const generate = useCallback((params) => {
    return sendMessage('generate', params);
  }, []);

  const roadTo = useCallback((params) => {
    return sendMessage('roadTo', params);
  }, []);

  return { generate, roadTo };
}
