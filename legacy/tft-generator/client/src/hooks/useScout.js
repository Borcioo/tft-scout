import { useState, useCallback, useRef, useEffect } from 'react';
import { useScoutWorker } from './useScoutWorker';

const INITIAL_COUNT = 8;
const LOAD_MORE_COUNT = 8;

export function useScout() {
  const { generate } = useScoutWorker();
  const [locked, setLocked] = useState([]);
  const [excluded, setExcluded] = useState([]);
  const [emblems, setEmblems] = useState([]);
  const [level, setLevel] = useState(9);
  const [max5Cost, setMax5Cost] = useState(null);  // null = auto (scales with level)
  const [results, setResults] = useState([]);
  const [insights, setInsights] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [topN, setTopN] = useState(INITIAL_COUNT);
  const debounceRef = useRef(null);

  const addEmblem = useCallback((traitApiName) => {
    setEmblems(prev => [...prev, traitApiName]);
  }, []);

  const removeEmblem = useCallback((index) => {
    setEmblems(prev => prev.filter((_, i) => i !== index));
  }, []);

  const toggleLock = useCallback((apiName) => {
    setLocked(prev => {
      if (prev.includes(apiName)) return prev.filter(a => a !== apiName);
      return [...prev, apiName];
    });
    setExcluded(prev => prev.filter(a => a !== apiName));
    setTopN(INITIAL_COUNT); // reset on new lock
  }, []);

  const toggleExclude = useCallback((apiName) => {
    setExcluded(prev => {
      if (prev.includes(apiName)) return prev.filter(a => a !== apiName);
      return [...prev, apiName];
    });
    setLocked(prev => prev.filter(a => a !== apiName));
    setTopN(INITIAL_COUNT);
  }, []);

  const clearAll = useCallback(() => {
    setLocked([]);
    setExcluded([]);
    setEmblems([]);
    setLevel(9);
    setMax5Cost(null);
    setResults([]);
    setInsights([]);
    setTopN(INITIAL_COUNT);
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore) return;
    const newTopN = topN + LOAD_MORE_COUNT;
    setLoadingMore(true);
    try {
      const data = await generate({
        lockedChampions: locked,
        excludedChampions: excluded,
        emblems, level, max5Cost,
        topN: newTopN,
      });
      setResults(data.results || []);
      setInsights(data.insights || []);
      setTopN(newTopN);
    } catch (err) {
      console.error('Load more failed:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [locked, excluded, emblems, level, max5Cost, topN, loadingMore, generate]);

  const seedRef = useRef(0);

  const fetchScout = useCallback(async (randomize = false) => {
    if (randomize) seedRef.current = Math.floor(Math.random() * 1000000);
    setLoading(true);
    try {
      const data = await generate({
        lockedChampions: locked,
        excludedChampions: excluded,
        emblems, level, max5Cost,
        topN,
        seed: seedRef.current,
      });
      setResults(data.results || []);
      setInsights(data.insights || []);
    } catch (err) {
      console.error('Scout failed:', err);
      setResults([]);
      setInsights([]);
    } finally {
      setLoading(false);
    }
  }, [locked, excluded, emblems, level, max5Cost, topN, generate]);

  // Auto-scout with debounce when inputs change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchScout, 300);
    return () => clearTimeout(debounceRef.current);
  }, [locked, excluded, emblems, level, max5Cost]);

  return {
    locked, excluded, emblems, level, max5Cost, results, insights, loading, loadingMore,
    toggleLock, toggleExclude, addEmblem, removeEmblem, setLevel, setMax5Cost, clearAll, loadMore,
    regenerate: () => fetchScout(true),
  };
}
