/**
 * Smart-summary formatters. Each takes a raw worker return value and
 * collapses it into a token-efficient shape for the assistant. Pass
 * `--full` at the command layer to skip these and print raw output.
 */

export function summariseGenerate(rawResults: any[], filtered: GenerateFilteredCounts): unknown {
    return {
        topN: rawResults.length,
        results: rawResults.map((r, i) => ({
            rank: i + 1,
            score: round1(r.score),
            champions: r.champions.map((c: any) => c.apiName),
            activeTraits: formatActiveTraits(r.activeTraits),
            roles: formatRoles(r.roles),
            slotsUsed: r.slotsUsed,
            metaMatch: r.metaMatch
                ? `${r.metaMatch.name}(${Math.round((r.metaMatch.overlap / r.metaMatch.total) * 100)}%)`
                : null,
            breakdown: roundBreakdown(r.breakdown),
        })),
        filtered,
    };
}

export type GenerateFilteredCounts = {
    rawTeams: number;
    enriched: number;
    afterValidComps: number;
    afterTopN: number;
};

export function summariseCandidates(candidates: any[]): unknown {
    const byCost: Record<number, number> = {};
    const byTrait: Record<string, number> = {};
    for (const c of candidates) {
        byCost[c.cost] = (byCost[c.cost] ?? 0) + 1;
        for (const t of c.traits ?? []) byTrait[t] = (byTrait[t] ?? 0) + 1;
    }
    return {
        count: candidates.length,
        byCost,
        byTrait,
        sample: candidates.slice(0, 8).map((c) => c.apiName),
    };
}

export function summariseGraph(graph: any): unknown {
    const nodes = Object.keys(graph?.nodes ?? {}).length;
    const edges: Array<[string, string]> = [];
    // adjacency shape: { championApiName: [{ champ, sharedTraits, traits }, ...] }
    // Each undirected edge is stored on BOTH endpoints, so dedupe by ordering.
    for (const [from, neighbourList] of Object.entries(graph?.adjacency ?? {})) {
        if (!Array.isArray(neighbourList)) continue;
        for (const edge of neighbourList) {
            const to = edge?.champ;
            if (typeof to === 'string' && from < to) edges.push([from, to]);
        }
    }
    return {
        nodes,
        edges: edges.length,
        avgDegree: nodes === 0 ? 0 : round1((edges.length * 2) / nodes),
        sampleEdges: edges.slice(0, 5),
    };
}

export function summariseFindTeams(teams: any[]): unknown {
    return teams.map((t) => ({
        champions: t.champions.map((c: any) => c.apiName),
        teamSize: t.champions.length,
        slotsUsed: t.champions.reduce((s: number, c: any) => s + (c.slotsUsed ?? 1), 0),
    }));
}

export function summariseScore(scored: { score: number; breakdown: Record<string, number> }): unknown {
    return {
        score: round1(scored.score),
        breakdown: roundBreakdown(scored.breakdown),
    };
}

export function summariseActiveTraits(traits: any[]): unknown {
    return traits.map((t) => ({
        apiName: t.apiName,
        count: t.count,
        style: t.activeStyle ?? null,
        breakpoint: t.activeBreakpoint ?? null,
    }));
}

export function summariseRoleBalance(roles: any): unknown {
    return {
        frontline: roles.frontline,
        dps: roles.dps,
        fighter: roles.fighter,
        effectiveFrontline: roles.effectiveFrontline,
        effectiveDps: roles.effectiveDps,
    };
}

export function formatActiveTraits(traits: any[]): string {
    return traits
        .map((t) => `${t.apiName ?? t.name}:${t.count}(${t.style ?? t.activeStyle ?? '-'})`)
        .join(' ');
}

export function formatRoles(roles: any): string {
    if (!roles) return '';
    const parts = [`fl:${roles.frontline}`, `dps:${roles.dps}`];
    if (roles.fighter > 0) parts.push(`fighter:${roles.fighter}`);
    return parts.join(' ');
}

function round1(n: number): number {
    return Math.round(n * 10) / 10;
}

function roundBreakdown(b: Record<string, number> | null | undefined): Record<string, number> {
    if (!b) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(b)) out[k] = round1(v);
    return out;
}
