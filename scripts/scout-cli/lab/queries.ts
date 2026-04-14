export type Scope = {
    experimentId: string | null;
    tag: string | null;
    lastN: number | null;
    since: string | null;
    all: boolean;
};

/** Build the SQL subquery that scopes downstream queries to a subset of runs. */
export function scopeRunIdSubquery(scope: Scope): {
    sql: string;
    params: Record<string, unknown>;
} {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};
    if (scope.experimentId) {
        clauses.push('experiment_id = @experimentId');
        params.experimentId = scope.experimentId;
    }
    if (scope.tag) {
        clauses.push('tag = @tag');
        params.tag = scope.tag;
    }
    if (scope.since) {
        clauses.push('ts >= @since');
        params.since = scope.since;
    }
    const where = clauses.length > 0 ? 'WHERE ' + clauses.join(' AND ') : '';
    const limit =
        scope.all || scope.lastN === null
            ? ''
            : ' ORDER BY ts DESC LIMIT ' + Number(scope.lastN);
    return {
        sql: `SELECT id FROM runs ${where} ${limit}`,
        params,
    };
}

export type StatDef = {
    description: string;
    build: (scope: Scope) => { sql: string; params: Record<string, unknown> };
};

export const STATS: Record<string, StatDef> = {
    summary: {
        description:
            'Totals: runs, results, time span, unique experiments, tags, git SHAs',
        build: (scope) => {
            const sub = scopeRunIdSubquery(scope);
            return {
                sql: `
                    WITH scoped AS (${sub.sql})
                    SELECT
                        (SELECT COUNT(*) FROM scoped) AS runs,
                        (SELECT COUNT(*) FROM results WHERE run_id IN scoped) AS results,
                        (SELECT MIN(ts) FROM runs WHERE id IN scoped) AS oldest,
                        (SELECT MAX(ts) FROM runs WHERE id IN scoped) AS newest,
                        (SELECT COUNT(DISTINCT experiment_id) FROM runs WHERE id IN scoped AND experiment_id IS NOT NULL) AS experiments,
                        (SELECT COUNT(DISTINCT tag) FROM runs WHERE id IN scoped AND tag IS NOT NULL) AS tags,
                        (SELECT COUNT(DISTINCT git_sha) FROM runs WHERE id IN scoped) AS gitShas
                `,
                params: sub.params,
            };
        },
    },
    'top-champions': {
        description:
            'Top 20 champions by appearance count in rank-1 within scope',
        build: (scope) => {
            const sub = scopeRunIdSubquery(scope);
            return {
                sql: `
                    SELECT api_name, COUNT(*) AS appearances
                    FROM champion_appearances
                    WHERE run_id IN (${sub.sql}) AND rank = 1
                    GROUP BY api_name
                    ORDER BY appearances DESC
                    LIMIT 20
                `,
                params: sub.params,
            };
        },
    },
    'top-champions-by-rank': {
        description: 'Champion x rank count matrix (pivot externally)',
        build: (scope) => {
            const sub = scopeRunIdSubquery(scope);
            return {
                sql: `
                    SELECT api_name, rank, COUNT(*) AS appearances
                    FROM champion_appearances
                    WHERE run_id IN (${sub.sql})
                    GROUP BY api_name, rank
                    ORDER BY api_name, rank
                `,
                params: sub.params,
            };
        },
    },
    'dead-champions': {
        description:
            'Champions that appeared in zero top-N results within scope',
        build: (scope) => {
            const sub = scopeRunIdSubquery(scope);
            return {
                sql: `
                    SELECT DISTINCT api_name
                    FROM champion_appearances
                    WHERE api_name NOT IN (
                        SELECT DISTINCT api_name FROM champion_appearances
                        WHERE run_id IN (${sub.sql})
                    )
                    ORDER BY api_name
                `,
                params: sub.params,
            };
        },
    },
    'top-traits': {
        description: 'Top 20 traits by total appearance count',
        build: (scope) => {
            const sub = scopeRunIdSubquery(scope);
            return {
                sql: `
                    SELECT api_name, COUNT(*) AS appearances, AVG(count) AS avgCount
                    FROM trait_appearances
                    WHERE run_id IN (${sub.sql})
                    GROUP BY api_name
                    ORDER BY appearances DESC
                    LIMIT 20
                `,
                params: sub.params,
            };
        },
    },
    'trait-dominance': {
        description:
            'Per trait: avg count, fraction of scoped results where active',
        build: (scope) => {
            const sub = scopeRunIdSubquery(scope);
            return {
                sql: `
                    SELECT api_name,
                           COUNT(*) AS appearances,
                           AVG(count) AS avgCount,
                           ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM results WHERE run_id IN (${sub.sql})), 2) AS activePct
                    FROM trait_appearances
                    WHERE run_id IN (${sub.sql})
                    GROUP BY api_name
                    ORDER BY appearances DESC
                `,
                params: sub.params,
            };
        },
    },
    'breakdown-distribution': {
        description:
            'Per scoring component: min / max / avg across scoped results',
        build: (scope) => {
            const sub = scopeRunIdSubquery(scope);
            return {
                sql: `
                    SELECT component,
                           MIN(value)  AS min,
                           MAX(value)  AS max,
                           ROUND(AVG(value), 2) AS avg,
                           COUNT(*)    AS samples
                    FROM breakdown_components
                    WHERE run_id IN (${sub.sql})
                    GROUP BY component
                    ORDER BY component
                `,
                params: sub.params,
            };
        },
    },
    'score-by-filter': {
        description:
            'Avg score and result count grouped by (level, minFrontline, minDps)',
        build: (scope) => {
            const sub = scopeRunIdSubquery(scope);
            return {
                sql: `
                    SELECT r.level, r.min_frontline AS minFL, r.min_dps AS minDps,
                           COUNT(DISTINCT r.id) AS runs,
                           ROUND(AVG(res.score), 2) AS avgScore,
                           ROUND(AVG(r.result_count), 2) AS avgResults
                    FROM runs r
                    LEFT JOIN results res ON res.run_id = r.id
                    WHERE r.id IN (${sub.sql})
                    GROUP BY r.level, r.min_frontline, r.min_dps
                    ORDER BY r.level, r.min_frontline, r.min_dps
                `,
                params: sub.params,
            };
        },
    },
    'meta-match-rate': {
        description: 'Fraction of results with a meta match',
        build: (scope) => {
            const sub = scopeRunIdSubquery(scope);
            return {
                sql: `
                    SELECT
                        ROUND(100.0 * SUM(CASE WHEN meta_match_json IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 2) AS matchPct,
                        COUNT(*) AS total
                    FROM results
                    WHERE run_id IN (${sub.sql})
                `,
                params: sub.params,
            };
        },
    },
    'role-balance-distribution': {
        description: 'Frequency of fl/dps/fighter combos in rank-1 results',
        build: (scope) => {
            const sub = scopeRunIdSubquery(scope);
            return {
                sql: `
                    SELECT roles_json, COUNT(*) AS n
                    FROM results
                    WHERE run_id IN (${sub.sql}) AND rank = 1
                    GROUP BY roles_json
                    ORDER BY n DESC
                `,
                params: sub.params,
            };
        },
    },
    'filter-breaking-points': {
        description: 'Matrix: (minFrontline, minDps) -> avg result_count',
        build: (scope) => {
            const sub = scopeRunIdSubquery(scope);
            return {
                sql: `
                    SELECT min_frontline AS minFL, min_dps AS minDps,
                           COUNT(*) AS runs,
                           ROUND(AVG(result_count), 2) AS avgResults
                    FROM runs
                    WHERE id IN (${sub.sql})
                    GROUP BY min_frontline, min_dps
                    ORDER BY min_frontline, min_dps
                `,
                params: sub.params,
            };
        },
    },
};

/** Render rows as a markdown table. */
export function rowsToMarkdown(
    columns: string[],
    rows: Record<string, unknown>[],
): string {
    if (rows.length === 0) return '_(no rows)_\n';
    const header = '| ' + columns.join(' | ') + ' |';
    const sep = '| ' + columns.map(() => '---').join(' | ') + ' |';
    const body = rows
        .map(
            (r) =>
                '| ' + columns.map((c) => String(r[c] ?? '')).join(' | ') + ' |',
        )
        .join('\n');
    return [header, sep, body].join('\n') + '\n';
}
