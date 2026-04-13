<?php

namespace App\Services\MetaTft;

use App\Services\MetaTft\Dto\AffinityDto;
use App\Services\MetaTft\Dto\CompanionDto;
use App\Services\MetaTft\Dto\MetaCompDto;
use App\Services\MetaTft\Dto\TraitRatingDto;
use App\Services\MetaTft\Dto\UnitRatingDto;
use Illuminate\Http\Client\Factory as HttpFactory;
use RuntimeException;

/**
 * HTTP client for MetaTFT's public API.
 *
 * Uses the `metatft_cache` table as a transparent JSON cache — every
 * request hashes (endpoint, params) and stores the raw body with a
 * TTL. Cache hits short-circuit the HTTP call, cache misses fetch +
 * store. This gives us idempotent sync runs (re-running right after a
 * successful run costs nothing) and survives partial failures.
 *
 * Base URL and exact endpoint paths are extracted from the legacy
 * ratings.service.js — see docs/superpowers/plans/metatft-api-notes.md.
 *
 * Response shapes are partially verified (v1 format uses `results` array
 * with `places`/`placement_count` arrays; pre-aggregated `avg_place` etc.
 * may or may not be present — A5 should confirm on live calls).
 */
class MetaTftClient
{
    // Confirmed from docs/superpowers/plans/metatft-api-notes.md (line: Base URL section).
    // Legacy v1 used /tft-stat-api/ — v2 uses /tft-comps-api/public/v1.
    private const BASE_URL = 'https://api.metatft.com/tft-comps-api/public/v1';

    private const DEFAULT_TTL = 3600; // 1 hour — MetaTFT refreshes aggregates slowly

    public function __construct(
        private readonly HttpFactory $http,
    ) {}

    /**
     * Fetch per-champion ratings for a set.
     *
     * NOTE: Legacy v2 calls this endpoint with no extra params (metatft-api-notes.md §units).
     * The `set` param is a v2-port addition — confirm it is accepted on first live call (A5).
     * Response wrapper key may be `results` (v1 shape) rather than `units`.
     *
     * @return list<UnitRatingDto>
     */
    public function fetchUnits(int $setNumber): array
    {
        $payload = $this->getWithCache('units', ['set' => $setNumber]);

        // Accept both v1 `results` wrapper and speculative `units` wrapper.
        $rows = $payload['units'] ?? $payload['results'] ?? $payload;

        return array_values(array_map(
            fn (array $row) => new UnitRatingDto(
                apiName: $row['unit'] ?? $row['apiName'] ?? '',
                avgPlace: (float) ($row['avg_place'] ?? $row['avgPlace'] ?? 4.5),
                winRate: (float) ($row['win_rate'] ?? $row['winRate'] ?? 0),
                top4Rate: (float) ($row['top4_rate'] ?? $row['top4Rate'] ?? 0),
                games: (int) ($row['games'] ?? 0),
                patch: $row['patch'] ?? null,
            ),
            $rows,
        ));
    }

    /**
     * Fetch per-trait-per-breakpoint ratings for a set.
     *
     * NOTE: Legacy v2 calls this endpoint with no extra params (metatft-api-notes.md §traits).
     * The `set` param is a v2-port addition — confirm it is accepted on first live call (A5).
     * Response `trait` key format is `{traitApiName}_{breakpointPosition}` (e.g. TFT17_DarkStar_1).
     *
     * @return list<TraitRatingDto>
     */
    public function fetchTraits(int $setNumber): array
    {
        $payload = $this->getWithCache('traits', ['set' => $setNumber]);

        // Accept both v1 `results` wrapper and speculative `traits` wrapper.
        $rows = $payload['traits'] ?? $payload['results'] ?? $payload;

        return array_values(array_map(
            fn (array $row) => new TraitRatingDto(
                traitApiName: $row['trait'] ?? $row['apiName'] ?? '',
                breakpointPosition: (int) ($row['breakpoint'] ?? $row['position'] ?? 1),
                avgPlace: (float) ($row['avg_place'] ?? 4.5),
                winRate: (float) ($row['win_rate'] ?? 0),
                top4Rate: (float) ($row['top4_rate'] ?? 0),
                games: (int) ($row['games'] ?? 0),
            ),
            $rows,
        ));
    }

    /**
     * Fetch trait affinity for a single champion.
     *
     * Params confirmed from ratings.service.js lines 67–71 (metatft-api-notes.md §explorer/traits):
     * `unit_unique = {apiName}-1`, `formatnoarray = 'true'`, `compact = 'true'`.
     *
     * Response uses `traits` key (format: `{traitApiName}_{breakpointPosition}`) inside `results`.
     *
     * @return list<AffinityDto>
     */
    public function fetchAffinity(string $championApiName): array
    {
        $payload = $this->getWithCache('explorer/traits', [
            'unit_unique' => $championApiName.'-1',
            'formatnoarray' => 'true',
            'compact' => 'true',
        ]);

        // Accept both v1 `results` wrapper and speculative `traits` wrapper.
        $rows = $payload['traits'] ?? $payload['results'] ?? $payload;

        return array_values(array_map(
            fn (array $row) => new AffinityDto(
                championApiName: $championApiName,
                traitApiName: $row['traits'] ?? $row['trait'] ?? '',
                breakpointPosition: (int) ($row['breakpoint'] ?? 1),
                avgPlace: (float) ($row['avg_place'] ?? 4.5),
                games: (int) ($row['games'] ?? 0),
                frequency: (float) ($row['frequency'] ?? 0),
            ),
            $rows,
        ));
    }

    /**
     * Fetch companion co-occurrence for a single champion.
     *
     * Params confirmed from ratings.service.js lines 263–267 (metatft-api-notes.md §explorer/units):
     * `unit_unique = {apiName}-1`, `formatnoarray = 'true'`, `compact = 'true'`.
     *
     * Response shape is unverified (metatft-api-notes.md marks it ⚠ unverified).
     * Likely `unit` field for companion apiName; confirm on first live call (A5).
     *
     * @return list<CompanionDto>
     */
    public function fetchCompanions(string $championApiName): array
    {
        $payload = $this->getWithCache('explorer/units', [
            'unit_unique' => $championApiName.'-1',
            'formatnoarray' => 'true',
            'compact' => 'true',
        ]);

        // Accept both v1 `results` wrapper and speculative `units` wrapper.
        $rows = $payload['units'] ?? $payload['results'] ?? $payload;

        return array_values(array_map(
            fn (array $row) => new CompanionDto(
                championApiName: $championApiName,
                companionApiName: $row['unit'] ?? $row['companion'] ?? '',
                avgPlace: (float) ($row['avg_place'] ?? 4.5),
                games: (int) ($row['games'] ?? 0),
                frequency: (float) ($row['frequency'] ?? 0),
            ),
            $rows,
        ));
    }

    /**
     * Fetch the current set's top meta compositions.
     *
     * Response shape uses `cluster_details` keyed by clusterId (v1 format, metatft-api-notes.md §comps).
     * The `units_string` and `traits_string` fields are comma-separated apiName lists.
     * Pre-aggregated `avg_place` / `games` come from `overall.avg` / `overall.count`.
     *
     * NOTE: speculative `comps` wrapper accepted as fallback for a possible v2 response shape.
     *
     * @return list<MetaCompDto>
     */
    public function fetchMetaComps(int $setNumber): array
    {
        $payload = $this->getWithCache('comps', ['set' => $setNumber]);

        // v1 shape: { cluster_details: { "<id>": { units_string, traits_string, overall: { avg, count } } } }
        if (isset($payload['cluster_details']) && is_array($payload['cluster_details'])) {
            $comps = [];
            foreach ($payload['cluster_details'] as $id => $row) {
                $comps[] = new MetaCompDto(
                    id: (string) $id,
                    name: (string) ($row['name'] ?? $id),
                    championApiNames: array_values(array_filter(
                        explode(',', $row['units_string'] ?? ''),
                        fn (string $s) => $s !== '',
                    )),
                    traitApiNames: array_values(array_filter(
                        explode(',', $row['traits_string'] ?? ''),
                        fn (string $s) => $s !== '',
                    )),
                    avgPlace: (float) ($row['overall']['avg'] ?? 4.5),
                    games: (int) ($row['overall']['count'] ?? 0),
                    level: (int) ($row['level'] ?? $row['levelling']['recommended_level'] ?? 9),
                );
            }

            return $comps;
        }

        // Fallback: accept a speculative flat `comps` or `results` array.
        $rows = $payload['comps'] ?? $payload['results'] ?? $payload;

        return array_values(array_map(
            fn (array $row) => new MetaCompDto(
                id: (string) ($row['id'] ?? $row['comp_id'] ?? ''),
                name: (string) ($row['name'] ?? ''),
                championApiNames: array_values($row['champions'] ?? $row['units'] ?? []),
                traitApiNames: array_values($row['traits'] ?? []),
                avgPlace: (float) ($row['avg_place'] ?? $row['overall']['avg'] ?? 4.5),
                games: (int) ($row['games'] ?? $row['overall']['count'] ?? 0),
                level: (int) ($row['level'] ?? 9),
            ),
            $rows,
        ));
    }

    /**
     * Low-level GET with metatft_cache lookup. Hash `(endpoint, params)`
     * to a stable key, check the cache, fetch + store on miss.
     *
     * @param  array<string, mixed>  $params
     * @return array<mixed>
     */
    private function getWithCache(string $endpoint, array $params): array
    {
        ksort($params);
        $paramsHash = hash('sha256', $endpoint.':'.json_encode($params));

        $cached = \App\Models\MetatftCache::query()
            ->where('endpoint', $endpoint)
            ->where('params_hash', $paramsHash)
            ->first();

        if ($cached && $cached->isFresh()) {
            return $cached->data ?? [];
        }

        $response = $this->http
            ->retry(3, 500, throw: false)
            ->timeout(30)
            ->acceptJson()
            ->get(self::BASE_URL.'/'.$endpoint, $params);

        if ($response->failed()) {
            throw new RuntimeException(
                "MetaTFT API failed for /{$endpoint}: HTTP {$response->status()}",
            );
        }

        $data = $response->json() ?? [];

        \App\Models\MetatftCache::query()->updateOrCreate(
            ['endpoint' => $endpoint, 'params_hash' => $paramsHash],
            [
                'params' => $params,
                'data' => $data,
                'fetched_at' => now(),
                'ttl_seconds' => self::DEFAULT_TTL,
            ],
        );

        return $data;
    }
}
