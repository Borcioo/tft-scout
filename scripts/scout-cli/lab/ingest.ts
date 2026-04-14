import type { Db } from './db';
import { paramsHash } from './hash';

export type RecordRunInput = {
    params: {
        level?: number;
        topN?: number;
        seed?: number;
        minFrontline?: number;
        minDps?: number;
        max5Cost?: number | null;
        lockedChampions?: string[];
        excludedChampions?: string[];
        lockedTraits?: { apiName: string; minUnits: number }[];
        emblems?: { apiName: string; count: number }[];
    };
    results: any[];
    filtered?: Record<string, number> | null;
};

export type RecordRunMeta = {
    source: 'cli' | 'experiment' | 'phase';
    command: string;
    tag?: string | null;
    experimentId?: string | null;
    gitSha: string;
    durationMs: number;
    notes?: string | null;
};

/**
 * Record one scout run into the lab DB. Writes to all five tables
 * inside a single transaction. Returns the inserted run_id.
 */
export function recordRun(
    db: Db,
    input: RecordRunInput,
    meta: RecordRunMeta,
): number {
    const p = input.params;

    const insertRun = db.prepare(`
        INSERT INTO runs (
            ts, source, command, tag, experiment_id, git_sha, duration_ms,
            level, top_n, seed, min_frontline, min_dps, max_5cost,
            locked_json, excluded_json, locked_traits_json, emblems_json,
            params_hash, result_count, filtered_json, notes
        ) VALUES (
            @ts, @source, @command, @tag, @experiment_id, @git_sha, @duration_ms,
            @level, @top_n, @seed, @min_frontline, @min_dps, @max_5cost,
            @locked_json, @excluded_json, @locked_traits_json, @emblems_json,
            @params_hash, @result_count, @filtered_json, @notes
        )
    `);

    const insertResult = db.prepare(`
        INSERT INTO results (
            run_id, rank, score, slots_used,
            champions_json, active_traits_json, roles_json,
            breakdown_json, meta_match_json
        ) VALUES (
            @run_id, @rank, @score, @slots_used,
            @champions_json, @active_traits_json, @roles_json,
            @breakdown_json, @meta_match_json
        )
    `);

    const insertChamp = db.prepare(`
        INSERT INTO champion_appearances (run_id, result_id, rank, api_name, cost)
        VALUES (@run_id, @result_id, @rank, @api_name, @cost)
    `);

    const insertTrait = db.prepare(`
        INSERT INTO trait_appearances (run_id, result_id, rank, api_name, count, style)
        VALUES (@run_id, @result_id, @rank, @api_name, @count, @style)
    `);

    const insertBreakdown = db.prepare(`
        INSERT INTO breakdown_components (run_id, result_id, rank, component, value)
        VALUES (@run_id, @result_id, @rank, @component, @value)
    `);

    const tx = db.transaction(() => {
        const runRow = {
            ts: new Date().toISOString(),
            source: meta.source,
            command: meta.command,
            tag: meta.tag ?? null,
            experiment_id: meta.experimentId ?? null,
            git_sha: meta.gitSha,
            duration_ms: meta.durationMs,
            level: p.level ?? null,
            top_n: p.topN ?? null,
            seed: p.seed ?? null,
            min_frontline: p.minFrontline ?? 0,
            min_dps: p.minDps ?? 0,
            max_5cost: p.max5Cost ?? null,
            locked_json: JSON.stringify(p.lockedChampions ?? []),
            excluded_json: JSON.stringify(p.excludedChampions ?? []),
            locked_traits_json: JSON.stringify(p.lockedTraits ?? []),
            emblems_json: JSON.stringify(p.emblems ?? []),
            params_hash: paramsHash(p as Record<string, unknown>),
            result_count: input.results.length,
            filtered_json: input.filtered ? JSON.stringify(input.filtered) : null,
            notes: meta.notes ?? null,
        };
        const runInfo = insertRun.run(runRow);
        const runId = Number(runInfo.lastInsertRowid);

        input.results.forEach((r, idx) => {
            const rank = idx + 1;
            const resultInfo = insertResult.run({
                run_id: runId,
                rank,
                score: Number(r.score) || 0,
                slots_used: r.slotsUsed ?? null,
                champions_json: JSON.stringify(
                    (r.champions ?? []).map((c: any) => ({ apiName: c.apiName, cost: c.cost })),
                ),
                active_traits_json: JSON.stringify(r.activeTraits ?? []),
                roles_json: r.roles ? JSON.stringify(r.roles) : null,
                breakdown_json: r.breakdown ? JSON.stringify(r.breakdown) : null,
                meta_match_json: r.metaMatch ? JSON.stringify(r.metaMatch) : null,
            });
            const resultId = Number(resultInfo.lastInsertRowid);

            for (const c of r.champions ?? []) {
                insertChamp.run({
                    run_id: runId,
                    result_id: resultId,
                    rank,
                    api_name: c.apiName,
                    cost: c.cost ?? 0,
                });
            }

            for (const t of r.activeTraits ?? []) {
                insertTrait.run({
                    run_id: runId,
                    result_id: resultId,
                    rank,
                    api_name: t.apiName ?? t.name ?? 'unknown',
                    count: t.count ?? 0,
                    style: t.activeStyle ?? t.style ?? null,
                });
            }

            if (r.breakdown && typeof r.breakdown === 'object') {
                for (const [k, v] of Object.entries(r.breakdown)) {
                    if (typeof v === 'number') {
                        insertBreakdown.run({
                            run_id: runId,
                            result_id: resultId,
                            rank,
                            component: k,
                            value: v,
                        });
                    }
                }
            }
        });

        return runId;
    });

    return tx();
}
