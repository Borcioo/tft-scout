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

import { INSIGHTS_CONFIG } from './insights-config';
import { STRENGTH } from './strength';
import { findActiveBreakpointIdx } from './synergy-graph/shared/breakpoints';
import type {
    InsightItem,
    MetaCompEntry,
    ScoredTeam,
    ScoringContext,
    TeamInsights,
} from './types';

const CFG = INSIGHTS_CONFIG;

// ── Helpers ─────────────────────────────────────

/**
 * Champions with variants (Miss Fortune Conduit/Challenger, Galio
 * Enhanced) share a single MetaTFT row keyed by the base apiName.
 * The scorer uses exactly this pattern — mirror it so insights
 * talk about the same numbers the algorithm used.
 */
function lookupApi(champion: {
    apiName: string;
    baseApiName: string | null;
}): string {
    return champion.baseApiName || champion.apiName;
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

function pushMetaMatch(
    team: ScoredTeam,
    ctx: ScoringContext,
    out: InsightItem[],
): void {
    const teamApis = new Set(team.champions.map((c) => lookupApi(c)));
    let best: { meta: MetaCompEntry; overlap: number } | null = null;

    for (const meta of ctx.metaComps ?? []) {
        if (meta.avgPlace > CFG.metaMatch.maxAvgPlace) {
            continue;
        }

        const units = meta.units;

        if (units.length === 0) {
            continue;
        }

        const overlapCount = units.filter((u) => teamApis.has(u)).length;
        const overlapPct = overlapCount / units.length;

        if (overlapPct < CFG.metaMatch.minOverlapPct) {
            continue;
        }

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

function pushTopCarry(
    team: ScoredTeam,
    ctx: ScoringContext,
    out: InsightItem[],
): void {
    const seen = new Set<string>();

    for (const champ of team.champions) {
        const api = lookupApi(champ);

        if (seen.has(api)) {
            continue;
        }

        seen.add(api);
        const rating = ctx.unitRatings?.[api];

        if (!rating) {
            continue;
        }

        if (rating.games < CFG.topCarry.minGames) {
            continue;
        }

        if (rating.avgPlace > CFG.topCarry.maxAvgPlace) {
            continue;
        }

        out.push({
            kind: 'topCarry',
            championApiName: api,
            displayName: champ.name,
            avgPlace: rating.avgPlace,
            games: rating.games,
        });
    }
}

function pushStrongTrait(
    team: ScoredTeam,
    ctx: ScoringContext,
    out: InsightItem[],
): void {
    for (const trait of team.activeTraits) {
        if (trait.breakpoint == null) {
            continue;
        }

        const rating = ctx.traitRatings?.[trait.apiName]?.[trait.breakpoint];

        if (!rating) {
            continue;
        }

        if (rating.games < CFG.strongTrait.minGames) {
            continue;
        }

        if (rating.avgPlace > CFG.strongTrait.maxAvgPlace) {
            continue;
        }

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

function pushAffinityHit(
    team: ScoredTeam,
    ctx: ScoringContext,
    out: InsightItem[],
): void {
    const activeTraitsByApi = new Map(
        team.activeTraits.map((t) => [t.apiName, t]),
    );

    for (const champ of team.champions) {
        const api = lookupApi(champ);
        const rows = ctx.affinity?.[api];

        if (!rows || rows.length === 0) {
            continue;
        }

        // Filter BEFORE sort — otherwise a 2-game "1.00 avg" noise row
        // lands in top-3 and pushes real signal out. Hero variants are
        // especially noise-prone on MetaTFT because their sample pool
        // is a fraction of a normal champion's. Own traits only: rows
        // exist for every trait on the unit's boards, and "Azir with 3
        // Solar" only said that Solar boards win.
        const own = new Set(champ.traits ?? []);
        const eligible = rows.filter(
            (r) => r.games >= CFG.affinityHit.minGames && own.has(r.trait),
        );

        if (eligible.length === 0) {
            continue;
        }

        const topN = eligible
            .sort((a, b) => a.avgPlace - b.avgPlace)
            .slice(0, CFG.affinityHit.topN);

        for (const row of topN) {
            const active = activeTraitsByApi.get(row.trait);

            if (!active) {
                continue;
            }

            // The row's level must be the board's: Kayle's 2.09 at 4
            // Executioner said nothing about a board with 3
            const idx = findActiveBreakpointIdx(
                active.count,
                (active as unknown as { breakpoints: { minUnits: number }[] })
                    .breakpoints ?? [],
            );

            if (row.breakpoint !== idx + 1) {
                continue;
            }

            if (row.avgPlace > CFG.affinityHit.maxAvgPlace) {
                continue;
            }

            out.push({
                kind: 'affinityHit',
                championApiName: api,
                championName: champ.name,
                traitApiName: row.trait,
                traitName: active.name,
                count: active.count,
                avgPlace: row.avgPlace,
            });
            break; // one affinityHit per champion; best hit wins
        }
    }
}

/**
 * Duos: two units that share a trait active on this board and place
 * better together than each unit's own record says (the together average
 * against avg_a + avg_b − 4.5). The plain together average mostly
 * measured the partner — any unit next to a strong 4-cost passed — and
 * the strongest pairs without a shared trait are reroll units next to a
 * comp's carry (Kayle + Azir: Kayle is at 3★ in half her games), which
 * reads as "Kayle at 3★", not a duo. Best first, each unit in one duo at
 * most, so a unit that pairs well with everyone doesn't fill the list.
 */
function pushProvenPair(
    team: ScoredTeam,
    ctx: ScoringContext,
    out: InsightItem[],
): void {
    const names = new Map<string, string>();
    const activeOf = new Map<string, Set<string>>();
    const active = new Set(team.activeTraits.map((t) => t.apiName));

    for (const c of team.champions) {
        const api = lookupApi(c);

        if (!names.has(api)) {
            names.set(api, c.name);
            activeOf.set(
                api,
                new Set((c.traits ?? []).filter((t) => active.has(t))),
            );
        }
    }

    const shareActive = (a: string, b: string) =>
        [...(activeOf.get(a) ?? [])].some((t) => activeOf.get(b)?.has(t));

    const seen = new Set<string>();
    const pairs: Extract<InsightItem, { kind: 'provenPair' }>[] = [];

    for (const [aApi, aName] of names) {
        const aAvg = ctx.unitRatings?.[aApi]?.avgPlace;

        for (const row of ctx.companions?.[aApi] ?? []) {
            const bName = names.get(row.companion);
            const bAvg = ctx.unitRatings?.[row.companion]?.avgPlace;
            const key = pairKey(aApi, row.companion);

            if (
                bName === undefined ||
                row.companion === aApi ||
                aAvg === undefined ||
                bAvg === undefined ||
                row.games < CFG.provenPair.minGames ||
                seen.has(key) ||
                !shareActive(aApi, row.companion)
            ) {
                continue;
            }

            seen.add(key);
            const expected = aAvg + bAvg - STRENGTH.baseline;

            if (row.avgPlace - expected <= CFG.provenPair.maxInteraction) {
                pairs.push({
                    kind: 'provenPair',
                    aApi,
                    aName,
                    bApi: row.companion,
                    bName,
                    avgPlace: row.avgPlace,
                    expected,
                });
            }
        }
    }

    const used = new Set<string>();
    let shown = 0;

    for (const p of pairs.sort(
        (x, y) =>
            x.avgPlace - (x.expected ?? 0) - (y.avgPlace - (y.expected ?? 0)),
    )) {
        if (shown >= CFG.provenPair.maxShown) {
            break;
        }

        if (used.has(p.aApi) || used.has(p.bApi)) {
            continue;
        }

        used.add(p.aApi);
        used.add(p.bApi);
        out.push(p);
        shown++;
    }
}

function pushHighBreakpoint(
    team: ScoredTeam,
    ctx: ScoringContext,
    out: InsightItem[],
): void {
    const strongTraitApis = new Set(
        out
            .filter(
                (i): i is Extract<InsightItem, { kind: 'strongTrait' }> =>
                    i.kind === 'strongTrait',
            )
            .map((i) => i.traitApiName),
    );

    for (const trait of team.activeTraits) {
        if (strongTraitApis.has(trait.apiName)) {
            continue;
        }

        const idx = findActiveBreakpointIdx(
            trait.count,
            (trait as unknown as { breakpoints: { minUnits: number }[] })
                .breakpoints ?? [],
        );

        if (idx < 1) {
            continue;
        } // needs 2nd breakpoint or higher

        const rating = ctx.traitRatings?.[trait.apiName]?.[idx + 1];

        if (!rating) {
            continue;
        }

        if (rating.avgPlace > CFG.highBreakpoint.maxAvgPlace) {
            continue;
        }

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

function pushWeakChampion(
    team: ScoredTeam,
    ctx: ScoringContext,
    out: InsightItem[],
): void {
    const activeTraitSet = new Set(team.activeTraits.map((t) => t.apiName));
    const activeTraitNames = new Map(
        team.activeTraits.map((t) => [t.apiName, t.name]),
    );
    const seen = new Set<string>();

    for (const champ of team.champions) {
        const api = lookupApi(champ);

        if (seen.has(api)) {
            continue;
        }

        seen.add(api);

        if (champ.cost < CFG.weakChampion.minCost) {
            continue;
        }

        const rating = ctx.unitRatings?.[api];

        if (!rating) {
            continue;
        }

        if (rating.games < CFG.weakChampion.minGames) {
            continue;
        }

        if (rating.avgPlace < CFG.weakChampion.minAvgPlace) {
            continue;
        }

        const reasonTraitApi =
            champ.traits.find((t) => activeTraitSet.has(t)) ??
            champ.traits[0] ??
            '';
        const reasonTraitName =
            activeTraitNames.get(reasonTraitApi) ?? reasonTraitApi;

        out.push({
            kind: 'weakChampion',
            championApiName: api,
            championName: champ.name,
            avgPlace: rating.avgPlace,
            reasonTraitName,
        });
    }
}

function pushLowBreakpoint(
    team: ScoredTeam,
    ctx: ScoringContext,
    out: InsightItem[],
): void {
    for (const trait of team.activeTraits) {
        const bps =
            (trait as unknown as { breakpoints: { minUnits: number }[] })
                .breakpoints ?? [];
        const idx = findActiveBreakpointIdx(trait.count, bps);

        if (idx !== 0) {
            continue;
        } // only fires when the trait sits on its lowest active breakpoint

        const rating = ctx.traitRatings?.[trait.apiName]?.[1];

        if (!rating) {
            continue;
        }

        if (rating.avgPlace < CFG.lowBreakpoint.minAvgPlace) {
            continue;
        }

        out.push({
            kind: 'lowBreakpoint',
            traitApiName: trait.apiName,
            displayName: trait.name,
            count: trait.count,
            avgPlace: rating.avgPlace,
        });
    }
}

function pushUnprovenTrait(
    team: ScoredTeam,
    ctx: ScoringContext,
    out: InsightItem[],
): void {
    for (const trait of team.activeTraits) {
        if (trait.breakpoint == null) {
            continue;
        }

        const rating = ctx.traitRatings?.[trait.apiName]?.[trait.breakpoint];

        if (!rating) {
            continue;
        }

        if (rating.games >= CFG.unprovenTrait.maxGames) {
            continue;
        }

        out.push({
            kind: 'unprovenTrait',
            traitApiName: trait.apiName,
            displayName: trait.name,
            games: rating.games,
        });
    }
}

function pushSingleCore(team: ScoredTeam, out: InsightItem[]): void {
    const highBp = team.activeTraits.filter((t) => {
        const bps =
            (t as unknown as { breakpoints: { minUnits: number }[] })
                .breakpoints ?? [];
        const idx = findActiveBreakpointIdx(t.count, bps);

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
    if (team.score >= median) {
        return;
    } // only experimental-looking, below-median teams

    const teamApis = new Set(team.champions.map((c) => lookupApi(c)));

    for (const meta of ctx.metaComps ?? []) {
        const units = meta.units;

        if (units.length === 0) {
            continue;
        }

        const overlap =
            units.filter((u) => teamApis.has(u)).length / units.length;

        if (overlap >= CFG.noMetaMatch.minOverlapPctIgnore) {
            return;
        } // has some meta match, bail
    }

    out.push({ kind: 'noMetaMatch' });
}

function pushStaleData(ctx: ScoringContext, out: InsightItem[]): void {
    if ((ctx as unknown as { stale?: boolean }).stale === true) {
        out.push({ kind: 'staleData' });
    }
}
