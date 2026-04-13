// client/src/workers/scout.worker.js
import { generate } from '../algorithm/engine.js';
import { generateInsights } from '../algorithm/insights.js';

function mapResult(r) {
  return {
    champions: r.champions.map(c => ({
      apiName: c.apiName,
      baseApiName: c.baseApiName || null,
      name: c.name,
      cost: c.cost,
      role: c.role,
      traits: c.traits,
      traitNames: c.traitNames || c.traits,
      variant: c.variant || null,
      slotsUsed: c.slotsUsed || 1,
      icon: c.icon || '',
      plannerCode: c.plannerCode ?? null,
    })),
    activeTraits: r.activeTraits.map(t => ({
      apiName: t.apiName,
      name: t.name,
      icon: t.icon || null,
      count: t.count,
      style: t.activeStyle || null,
      breakpoint: t.activeBreakpoint || null,
    })),
    score: Math.round(r.score * 100) / 100,
    breakdown: r.breakdown || null,
    itemBuilds: r.itemBuilds || null,
    level: r.level,
    slotsUsed: r.slotsUsed,
    roles: r.roles || null,
    metaMatch: r.metaMatch || null,
  };
}

let cachedContext = null;

async function fetchContext() {
  if (cachedContext) return cachedContext;
  const res = await fetch('/api/scout/context');
  if (!res.ok) throw new Error(`Context fetch failed: ${res.status}`);
  cachedContext = await res.json();
  return cachedContext;
}

function runGenerate(ctx, params) {
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
  } = params;

  const results = generate({
    champions: ctx.champions,
    traits: ctx.traits,
    scoringCtx: ctx.scoringCtx,
    constraints: {
      lockedChampions,
      excludedChampions,
      lockedTraits,
      excludedTraits,
      emblems,
      max5Cost,
      roleBalance,
    },
    exclusionGroups: ctx.exclusionGroups,
    level,
    topN,
    seed,
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

function runRoadTo(ctx, params) {
  const {
    baseTeam = [],
    emblems = [],
    excludedChampions = [],
    targetLevel = 10,
    topN = 5,
  } = params;

  const costOf = (api) => ctx.champions.find(c => c.apiName === api)?.cost || 3;
  const byCost = [...baseTeam].sort((a, b) => costOf(a) - costOf(b));

  const subsets = new Set();
  const addSubset = (arr) => subsets.add(JSON.stringify([...arr].sort()));

  addSubset(baseTeam);
  for (let i = 0; i < baseTeam.length; i++) {
    addSubset(baseTeam.filter((_, j) => j !== i));
  }
  if (byCost.length >= 3) addSubset(byCost.slice(1));
  if (byCost.length >= 4) addSubset(byCost.slice(2));

  const allResults = new Map();
  for (const subsetJson of subsets) {
    const subset = JSON.parse(subsetJson);
    const results = generate({
      champions: ctx.champions,
      traits: ctx.traits,
      scoringCtx: ctx.scoringCtx,
      exclusionGroups: ctx.exclusionGroups,
      constraints: {
        lockedChampions: subset,
        excludedChampions,
        lockedTraits: [],
        excludedTraits: [],
        emblems,
        max5Cost: null,
      },
      level: targetLevel,
      topN: 3,
      seed: Math.floor(Math.random() * 1000000),
    });
    for (const r of results) {
      const key = r.champions.map(c => c.apiName).sort().join(',');
      if (!allResults.has(key) || allResults.get(key).score < r.score) {
        allResults.set(key, r);
      }
    }
  }

  return [...allResults.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map(mapResult);
}

self.onmessage = async (e) => {
  const { type, id, params } = e.data;

  try {
    const ctx = await fetchContext();

    let result;
    if (type === 'generate') {
      result = runGenerate(ctx, params);
    } else if (type === 'roadTo') {
      result = runRoadTo(ctx, params);
    } else {
      throw new Error(`Unknown message type: ${type}`);
    }

    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};

self.postMessage({ type: 'ready' });
