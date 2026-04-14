/**
 * Team insights — pure function that inspects a scored team and
 * produces player-facing strength/concern insight items sourced
 * from the same MetaTFT data the scorer used.
 *
 * See docs/superpowers/specs/2026-04-14-scout-why-this-comp-design.md
 * for the full rule table and thresholds. Each rule fires independently
 * and appends to its section; the entry point runs strength rules
 * before concern rules so precedence checks (highBreakpoint skips when
 * strongTrait already fired) can scan already-pushed items.
 */

import type {
  InsightItem,
  MetaCompEntry,
  ScoredTeam,
  ScoringContext,
  TeamInsights,
} from './types';
import { INSIGHTS_CONFIG } from './insights-config';

const CFG = INSIGHTS_CONFIG;

// ── Helpers ─────────────────────────────────────

/**
 * Champions with variants (Miss Fortune Conduit/Challenger, Galio
 * Enhanced) share a single MetaTFT row keyed by the base apiName.
 * The scorer uses exactly this pattern — mirror it so insights
 * talk about the same numbers the algorithm used.
 */
function lookupApi(champion: { apiName: string; baseApiName: string | null }): string {
  return champion.baseApiName || champion.apiName;
}

/**
 * Active breakpoint index for a trait given its count. Returns -1
 * if no breakpoint is reached (inactive). Iterates from the top
 * down so the highest satisfied breakpoint wins.
 */
function activeBreakpointIdx(count: number, breakpoints: { minUnits: number }[]): number {
  const sorted = [...breakpoints].sort((a, b) => a.minUnits - b.minUnits);
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (count >= sorted[i].minUnits) return i;
  }
  return -1;
}

/**
 * Pair key for dedupe — sort two apiNames so {A,B} and {B,A} collapse
 * to the same key.
 */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// ── Entry point ─────────────────────────────────

export function buildTeamInsights(
  team: ScoredTeam,
  ctx: ScoringContext,
  batchMedianScore: number,
): TeamInsights {
  const strengths: InsightItem[] = [];
  const concerns: InsightItem[] = [];

  pushMetaMatch(team, ctx, strengths);
  pushTopCarry(team, ctx, strengths);
  pushStrongTrait(team, ctx, strengths);
  pushAffinityHit(team, ctx, strengths);
  pushProvenPair(team, ctx, strengths);
  pushHighBreakpoint(team, ctx, strengths);

  pushWeakChampion(team, ctx, concerns);
  pushLowBreakpoint(team, ctx, concerns);
  pushUnprovenTrait(team, ctx, concerns);
  pushSingleCore(team, concerns);
  pushNoMetaMatch(team, ctx, batchMedianScore, concerns);
  pushStaleData(ctx, concerns);

  return { strengths, concerns };
}

// ── Strength rules ──────────────────────────────

function pushMetaMatch(team: ScoredTeam, ctx: ScoringContext, out: InsightItem[]): void {
  const teamApis = new Set(team.champions.map(c => lookupApi(c)));
  let best: { meta: MetaCompEntry; overlap: number } | null = null;

  for (const meta of ctx.metaComps ?? []) {
    if (meta.avgPlace > CFG.metaMatch.maxAvgPlace) continue;
    const units = meta.units;
    if (units.length === 0) continue;
    const overlapCount = units.filter(u => teamApis.has(u)).length;
    const overlapPct = overlapCount / units.length;
    if (overlapPct < CFG.metaMatch.minOverlapPct) continue;
    if (!best || overlapCount > best.overlap) {
      best = { meta, overlap: overlapCount };
    }
  }

  if (best) {
    out.push({
      kind: 'metaMatch',
      compName: best.meta.name,
      avgPlace: best.meta.avgPlace,
      games: best.meta.games,
    });
  }
}

function pushTopCarry(team: ScoredTeam, ctx: ScoringContext, out: InsightItem[]): void {
  const seen = new Set<string>();
  for (const champ of team.champions) {
    const api = lookupApi(champ);
    if (seen.has(api)) continue;
    seen.add(api);
    const rating = ctx.unitRatings?.[api];
    if (!rating) continue;
    if (rating.games < CFG.topCarry.minGames) continue;
    if (rating.avgPlace > CFG.topCarry.maxAvgPlace) continue;
    out.push({
      kind: 'topCarry',
      championApiName: api,
      displayName: champ.name,
      avgPlace: rating.avgPlace,
      games: rating.games,
    });
  }
}

function pushStrongTrait(team: ScoredTeam, ctx: ScoringContext, out: InsightItem[]): void {
  for (const trait of team.activeTraits) {
    if (trait.breakpoint == null) continue;
    const rating = ctx.traitRatings?.[trait.apiName]?.[trait.breakpoint];
    if (!rating) continue;
    if (rating.games < CFG.strongTrait.minGames) continue;
    if (rating.avgPlace > CFG.strongTrait.maxAvgPlace) continue;
    out.push({
      kind: 'strongTrait',
      traitApiName: trait.apiName,
      displayName: trait.name,
      count: trait.count,
      avgPlace: rating.avgPlace,
      games: rating.games,
    });
  }
}

function pushAffinityHit(team: ScoredTeam, ctx: ScoringContext, out: InsightItem[]): void {
  const activeTraitsByApi = new Map(team.activeTraits.map(t => [t.apiName, t]));

  for (const champ of team.champions) {
    const api = lookupApi(champ);
    const rows = ctx.affinity?.[api];
    if (!rows || rows.length === 0) continue;
    // Filter BEFORE sort — otherwise a 2-game "1.00 avg" noise row
    // lands in top-3 and pushes real signal out. Hero variants are
    // especially noise-prone on MetaTFT because their sample pool
    // is a fraction of a normal champion's.
    const eligible = rows.filter(r => r.games >= CFG.affinityHit.minGames);
    if (eligible.length === 0) continue;
    const topN = eligible
      .sort((a, b) => a.avgPlace - b.avgPlace)
      .slice(0, CFG.affinityHit.topN);
    for (const row of topN) {
      const active = activeTraitsByApi.get(row.trait);
      if (!active) continue;
      if (row.avgPlace > CFG.affinityHit.maxAvgPlace) continue;
      out.push({
        kind: 'affinityHit',
        championApiName: api,
        championName: champ.name,
        traitApiName: row.trait,
        traitName: active.name,
        avgPlace: row.avgPlace,
      });
      break; // one affinityHit per champion; best hit wins
    }
  }
}

function pushProvenPair(team: ScoredTeam, ctx: ScoringContext, out: InsightItem[]): void {
  const teamByApi = new Map<string, { api: string; name: string }>();
  for (const c of team.champions) {
    const api = lookupApi(c);
    if (!teamByApi.has(api)) teamByApi.set(api, { api, name: c.name });
  }

  const firedPairs = new Set<string>();

  for (const { api: aApi, name: aName } of teamByApi.values()) {
    const rows = ctx.companions?.[aApi];
    if (!rows) continue;
    const topN = [...rows]
      .sort((x, y) => x.avgPlace - y.avgPlace)
      .slice(0, CFG.provenPair.topN);
    for (const row of topN) {
      const B = teamByApi.get(row.companion);
      if (!B) continue;
      if (B.api === aApi) continue;
      if (row.games < CFG.provenPair.minGames) continue;
      if (row.avgPlace > CFG.provenPair.maxAvgPlace) continue;
      const key = pairKey(aApi, B.api);
      if (firedPairs.has(key)) continue;
      firedPairs.add(key);
      out.push({
        kind: 'provenPair',
        aApi,
        aName,
        bApi: B.api,
        bName: B.name,
        avgPlace: row.avgPlace,
      });
    }
  }
}

function pushHighBreakpoint(team: ScoredTeam, ctx: ScoringContext, out: InsightItem[]): void {
  const strongTraitApis = new Set(
    out
      .filter((i): i is Extract<InsightItem, { kind: 'strongTrait' }> => i.kind === 'strongTrait')
      .map(i => i.traitApiName),
  );

  for (const trait of team.activeTraits) {
    if (strongTraitApis.has(trait.apiName)) continue;
    const idx = activeBreakpointIdx(trait.count, (trait as unknown as { breakpoints: { minUnits: number }[] }).breakpoints ?? []);
    if (idx < 1) continue; // needs 2nd breakpoint or higher
    const rating = ctx.traitRatings?.[trait.apiName]?.[idx + 1];
    if (!rating) continue;
    if (rating.avgPlace > CFG.highBreakpoint.maxAvgPlace) continue;
    out.push({
      kind: 'highBreakpoint',
      traitApiName: trait.apiName,
      displayName: trait.name,
      count: trait.count,
      avgPlace: rating.avgPlace,
    });
  }
}

// ── Concern rules ───────────────────────────────

function pushWeakChampion(team: ScoredTeam, ctx: ScoringContext, out: InsightItem[]): void {
  const activeTraitSet = new Set(team.activeTraits.map(t => t.apiName));
  const activeTraitNames = new Map(team.activeTraits.map(t => [t.apiName, t.name]));
  const seen = new Set<string>();

  for (const champ of team.champions) {
    const api = lookupApi(champ);
    if (seen.has(api)) continue;
    seen.add(api);
    if (champ.cost < CFG.weakChampion.minCost) continue;
    const rating = ctx.unitRatings?.[api];
    if (!rating) continue;
    if (rating.games < CFG.weakChampion.minGames) continue;
    if (rating.avgPlace < CFG.weakChampion.minAvgPlace) continue;

    const reasonTraitApi = champ.traits.find(t => activeTraitSet.has(t)) ?? champ.traits[0] ?? '';
    const reasonTraitName = activeTraitNames.get(reasonTraitApi) ?? reasonTraitApi;

    out.push({
      kind: 'weakChampion',
      championApiName: api,
      championName: champ.name,
      avgPlace: rating.avgPlace,
      reasonTraitName,
    });
  }
}

function pushLowBreakpoint(team: ScoredTeam, ctx: ScoringContext, out: InsightItem[]): void {
  for (const trait of team.activeTraits) {
    const bps = (trait as unknown as { breakpoints: { minUnits: number }[] }).breakpoints ?? [];
    const idx = activeBreakpointIdx(trait.count, bps);
    if (idx !== 0) continue; // only fires when the trait sits on its lowest active breakpoint
    const rating = ctx.traitRatings?.[trait.apiName]?.[1];
    if (!rating) continue;
    if (rating.avgPlace < CFG.lowBreakpoint.minAvgPlace) continue;
    out.push({
      kind: 'lowBreakpoint',
      traitApiName: trait.apiName,
      displayName: trait.name,
      count: trait.count,
      avgPlace: rating.avgPlace,
    });
  }
}

function pushUnprovenTrait(team: ScoredTeam, ctx: ScoringContext, out: InsightItem[]): void {
  for (const trait of team.activeTraits) {
    if (trait.breakpoint == null) continue;
    const rating = ctx.traitRatings?.[trait.apiName]?.[trait.breakpoint];
    if (!rating) continue;
    if (rating.games >= CFG.unprovenTrait.maxGames) continue;
    out.push({
      kind: 'unprovenTrait',
      traitApiName: trait.apiName,
      displayName: trait.name,
      games: rating.games,
    });
  }
}

function pushSingleCore(team: ScoredTeam, out: InsightItem[]): void {
  const highBp = team.activeTraits.filter(t => {
    const bps = (t as unknown as { breakpoints: { minUnits: number }[] }).breakpoints ?? [];
    const idx = activeBreakpointIdx(t.count, bps);
    return idx >= 1;
  });
  if (highBp.length === 1) {
    const only = highBp[0];
    out.push({
      kind: 'singleCore',
      traitApiName: only.apiName,
      displayName: only.name,
    });
  }
}

function pushNoMetaMatch(
  team: ScoredTeam,
  ctx: ScoringContext,
  median: number,
  out: InsightItem[],
): void {
  if (team.score >= median) return; // only experimental-looking, below-median teams

  const teamApis = new Set(team.champions.map(c => lookupApi(c)));
  for (const meta of ctx.metaComps ?? []) {
    const units = meta.units;
    if (units.length === 0) continue;
    const overlap = units.filter(u => teamApis.has(u)).length / units.length;
    if (overlap >= CFG.noMetaMatch.minOverlapPctIgnore) return; // has some meta match, bail
  }

  out.push({ kind: 'noMetaMatch' });
}

function pushStaleData(ctx: ScoringContext, out: InsightItem[]): void {
  if ((ctx as unknown as { stale?: boolean }).stale === true) {
    out.push({ kind: 'staleData' });
  }
}
