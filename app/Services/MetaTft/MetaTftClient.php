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
 * MetaTFT's API is split across THREE hosts — the A4 plan guessed one
 * base URL and it turned out to be wrong. Real hosts, verified live on
 * 2026-04-14:
 *
 *   - api-hc.metatft.com/tft-stat-api      → /units, /traits (bulk)
 *   - api-hc.metatft.com/tft-comps-api     → /comps_data (cluster details)
 *   - api-hc.metatft.com/tft-explorer-api  → /traits, /units_unique
 *                                            (per-unit affinity + companions)
 *
 * None of the endpoints return pre-aggregated `avg_place` / `win_rate`
 * in this version — they all return an 8-element `places` / `placement_count`
 * histogram counting 1st-through-8th finishes, and the client aggregates
 * on the way out via `aggregatePlaces()`.
 *
 * Caching uses `metatft_cache` — key = (baseUrl, endpoint, params) hash.
 */
class MetaTftClient
{
    private const STATS_BASE_URL = 'https://api-hc.metatft.com/tft-stat-api';
    private const COMPS_BASE_URL = 'https://api-hc.metatft.com/tft-comps-api';
    private const EXPLORER_BASE_URL = 'https://api-hc.metatft.com/tft-explorer-api';

    // PBE while Set 17 is in the PBE test cycle. The API silently
    // returns Set 16 data when `queue=RANKED` is passed for Set 17 —
    // flip this constant to 'RANKED' only after Set 17 hits retail.
    private const QUEUE = 'PBE';

    private const DEFAULT_TTL = 3600;

    public function __construct(
        private readonly HttpFactory $http,
    ) {}

    /**
     * Fetch per-champion placement histograms and aggregate to ratings.
     *
     * @return list<UnitRatingDto>
     */
    public function fetchUnits(int $setNumber): array
    {
        $payload = $this->getWithCache(
            self::STATS_BASE_URL,
            'units',
            $this->statsBulkParams($setNumber),
        );

        $rows = $payload['results'] ?? [];

        return array_values(array_map(
            function (array $row) use ($payload) {
                $agg = self::aggregatePlaces($row['places'] ?? []);

                return new UnitRatingDto(
                    apiName: (string) ($row['unit'] ?? ''),
                    avgPlace: $agg['avgPlace'],
                    winRate: $agg['winRate'],
                    top4Rate: $agg['top4Rate'],
                    games: $agg['games'],
                    patch: $payload['patch'] ?? null,
                );
            },
            $rows,
        ));
    }

    /**
     * Fetch per-trait-per-breakpoint histograms and aggregate.
     *
     * Response `trait` keys are `{traitApiName}_{breakpointPosition}`
     * (e.g. `TFT17_DarkStar_1`, `TFT17_Stargazer_Wolf_1`), so the last
     * `_N` segment is the breakpoint and the rest is the base trait
     * api_name matching our `tft_traits.api_name` column.
     *
     * @return list<TraitRatingDto>
     */
    public function fetchTraits(int $setNumber): array
    {
        $payload = $this->getWithCache(
            self::STATS_BASE_URL,
            'traits',
            $this->statsBulkParams($setNumber),
        );

        $rows = $payload['results'] ?? [];
        $out = [];

        foreach ($rows as $row) {
            [$apiName, $breakpoint] = self::splitTraitKey((string) ($row['trait'] ?? ''));
            if ($apiName === '') {
                continue;
            }

            $agg = self::aggregatePlaces($row['places'] ?? []);
            $out[] = new TraitRatingDto(
                traitApiName: $apiName,
                breakpointPosition: $breakpoint,
                avgPlace: $agg['avgPlace'],
                winRate: $agg['winRate'],
                top4Rate: $agg['top4Rate'],
                games: $agg['games'],
            );
        }

        return $out;
    }

    /**
     * Fetch trait affinity for one champion from the explorer API.
     *
     * Response: `{ data: [ { traits: "TFT17_X_1", placement_count: [...] }, ... ] }`.
     * The first row has `traits: null` and holds the overall placement
     * totals for the queried unit — used as the denominator for
     * frequency. Remaining rows are keyed by `{traitApiName}_{breakpoint}`.
     *
     * @return list<AffinityDto>
     */
    public function fetchAffinity(string $championApiName): array
    {
        $payload = $this->getWithCache(
            self::EXPLORER_BASE_URL,
            'traits',
            $this->explorerUnitParams($championApiName),
        );

        $rows = $payload['data'] ?? [];
        $overallGames = 0;
        foreach ($rows as $row) {
            if (($row['traits'] ?? null) === null) {
                $overallGames = self::sumPlaces($row['placement_count'] ?? []);
                break;
            }
        }

        $out = [];
        foreach ($rows as $row) {
            $key = $row['traits'] ?? null;
            if ($key === null) {
                continue;
            }

            [$apiName, $breakpoint] = self::splitTraitKey((string) $key);
            if ($apiName === '') {
                continue;
            }

            $agg = self::aggregatePlaces($row['placement_count'] ?? []);
            $out[] = new AffinityDto(
                championApiName: $championApiName,
                traitApiName: $apiName,
                breakpointPosition: $breakpoint,
                avgPlace: $agg['avgPlace'],
                games: $agg['games'],
                frequency: $overallGames > 0 ? $agg['games'] / $overallGames : 0.0,
            );
        }

        return $out;
    }

    /**
     * Fetch companion (co-occurrence) data for one champion.
     *
     * Response: `{ data: [ { units_unique: "TFT17_X-1", placement_count: [...] }, ... ] }`.
     * `units_unique` has a star-level suffix (`-1`, `-2`, `-3`); we
     * strip it and fold all star variants into a single total per
     * companion apiName. The self-reference row (queried unit itself)
     * supplies the denominator for frequency.
     *
     * @return list<CompanionDto>
     */
    public function fetchCompanions(string $championApiName): array
    {
        $payload = $this->getWithCache(
            self::EXPLORER_BASE_URL,
            'units_unique',
            $this->explorerUnitParams($championApiName),
        );

        $rows = $payload['data'] ?? [];

        /** @var array<string, array{games:int, placeSum:int}> $folded */
        $folded = [];
        $overallGames = 0;

        foreach ($rows as $row) {
            $unique = (string) ($row['units_unique'] ?? '');
            if ($unique === '') {
                continue;
            }
            $baseApi = preg_replace('/-\d+$/', '', $unique) ?? $unique;
            $places = $row['placement_count'] ?? [];
            $games = self::sumPlaces($places);
            if ($games === 0) {
                continue;
            }

            if ($baseApi === $championApiName) {
                $overallGames += $games;

                continue;
            }

            if (! isset($folded[$baseApi])) {
                $folded[$baseApi] = ['games' => 0, 'placeSum' => 0];
            }
            $folded[$baseApi]['games'] += $games;
            $folded[$baseApi]['placeSum'] += self::placeSum($places);
        }

        $out = [];
        foreach ($folded as $apiName => $agg) {
            $out[] = new CompanionDto(
                championApiName: $championApiName,
                companionApiName: $apiName,
                avgPlace: $agg['games'] > 0 ? $agg['placeSum'] / $agg['games'] : 4.5,
                games: $agg['games'],
                frequency: $overallGames > 0 ? $agg['games'] / $overallGames : 0.0,
            );
        }

        return $out;
    }

    /**
     * Fetch meta comps from `comps_data`.
     *
     * Response shape:
     *   { results: { data: { cluster_details: {
     *       "399001": {
     *           Cluster, units_string, traits_string, name_string,
     *           overall: { count, avg }, levelling: "lvl 7", ...
     *       }, ...
     *   } } } }
     *
     * `comps_data` doesn't take a `set` param — MetaTFT returns the
     * current set's clusters based on the queue hint. We still accept
     * `$setNumber` to match the interface with the other fetchers.
     *
     * @return list<MetaCompDto>
     */
    public function fetchMetaComps(int $setNumber): array
    {
        $payload = $this->getWithCache(
            self::COMPS_BASE_URL,
            'comps_data',
            [
                'queue' => self::QUEUE,
                'region_hint' => 'eun1',
            ],
        );

        $clusterDetails = $payload['results']['data']['cluster_details'] ?? [];
        $comps = [];

        foreach ($clusterDetails as $id => $row) {
            if (! is_array($row)) {
                continue;
            }
            $comps[] = new MetaCompDto(
                id: (string) $id,
                name: (string) ($row['name_string'] ?? $id),
                championApiNames: self::splitCommaList((string) ($row['units_string'] ?? '')),
                // traits_string entries include a breakpoint suffix
                // ("TFT17_DRX_1") — strip it so the values match our
                // tft_traits.api_name column.
                traitApiNames: array_values(array_unique(array_map(
                    fn (string $s) => self::splitTraitKey($s)[0],
                    self::splitCommaList((string) ($row['traits_string'] ?? '')),
                ))),
                avgPlace: (float) ($row['overall']['avg'] ?? 4.5),
                games: (int) ($row['overall']['count'] ?? 0),
                level: self::parseLevelling($row['levelling'] ?? null),
            );
        }

        return $comps;
    }

    /**
     * @return array<string, string>
     */
    private function statsBulkParams(int $setNumber): array
    {
        return [
            'set' => (string) $setNumber,
            'queue' => self::QUEUE,
            'patch' => 'current',
            'days' => '3',
            'permit_filter_adjustment' => 'true',
        ];
    }

    /**
     * @return array<string, string>
     */
    private function explorerUnitParams(string $championApiName): array
    {
        return [
            'unit_unique' => $championApiName.'-1',
            'formatnoarray' => 'true',
            'compact' => 'true',
            'queue' => self::QUEUE,
            'patch' => 'current',
            'days' => '1',
            'permit_filter_adjustment' => 'true',
            'region_hint' => 'eun1',
        ];
    }

    /**
     * @param  list<int|float>  $places
     * @return array{avgPlace:float, winRate:float, top4Rate:float, games:int}
     */
    private static function aggregatePlaces(array $places): array
    {
        $games = self::sumPlaces($places);
        if ($games <= 0) {
            return ['avgPlace' => 4.5, 'winRate' => 0.0, 'top4Rate' => 0.0, 'games' => 0];
        }

        $placeSum = self::placeSum($places);
        $top4 = 0;
        for ($i = 0; $i < 4; $i++) {
            $top4 += (int) ($places[$i] ?? 0);
        }

        return [
            'avgPlace' => $placeSum / $games,
            'winRate' => (int) ($places[0] ?? 0) / $games,
            'top4Rate' => $top4 / $games,
            'games' => $games,
        ];
    }

    /**
     * Sum of the first 8 histogram buckets. Some endpoints append a
     * 9th element (totals) — we ignore anything past index 7.
     *
     * @param  list<int|float>  $places
     */
    private static function sumPlaces(array $places): int
    {
        $sum = 0;
        for ($i = 0; $i < 8; $i++) {
            $sum += (int) ($places[$i] ?? 0);
        }

        return $sum;
    }

    /**
     * Weighted sum `Σ((i+1) * places[i])` used as avg-place numerator.
     *
     * @param  list<int|float>  $places
     */
    private static function placeSum(array $places): int
    {
        $sum = 0;
        for ($i = 0; $i < 8; $i++) {
            $sum += ($i + 1) * (int) ($places[$i] ?? 0);
        }

        return $sum;
    }

    /**
     * Split a trait histogram key like `TFT17_Stargazer_Wolf_1` into
     * `["TFT17_Stargazer_Wolf", 1]`. The trailing `_N` is always the
     * breakpoint position; the rest is the base api_name.
     *
     * @return array{0:string, 1:int}
     */
    private static function splitTraitKey(string $key): array
    {
        if ($key === '') {
            return ['', 0];
        }
        if (! preg_match('/^(.+)_(\d+)$/', $key, $m)) {
            return [$key, 0];
        }

        return [$m[1], (int) $m[2]];
    }

    /**
     * `"TFT17_Aatrox, TFT17_Graves, ..."` → list of trimmed non-empty
     * strings. MetaTFT pads with `, ` so we accept optional whitespace.
     *
     * @return list<string>
     */
    private static function splitCommaList(string $csv): array
    {
        if ($csv === '') {
            return [];
        }

        return array_values(array_filter(
            array_map(fn (string $s) => trim($s), explode(',', $csv)),
            fn (string $s) => $s !== '',
        ));
    }

    /**
     * Parse strings like `"lvl 7"`, `"lvl 8"` into int. Falls back to
     * 9 (max stage) when the field is missing or malformed so a bad
     * row never sneaks a 0 into the DB and breaks level filtering.
     */
    private static function parseLevelling(mixed $raw): int
    {
        if (! is_string($raw)) {
            return 9;
        }
        if (preg_match('/(\d+)/', $raw, $m)) {
            return (int) $m[1];
        }

        return 9;
    }

    /**
     * @param  array<string, mixed>  $params
     * @return array<mixed>
     */
    private function getWithCache(string $baseUrl, string $endpoint, array $params): array
    {
        ksort($params);
        // Column is varchar(16) — truncate to the first 16 hex chars
        // (64 bits). Collision probability across a few thousand rows
        // is negligible and the migration comment explicitly calls this
        // a "sha256 slice".
        $paramsHash = substr(
            hash('sha256', $baseUrl.':'.$endpoint.':'.json_encode($params)),
            0,
            16,
        );

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
            ->get($baseUrl.'/'.$endpoint, $params);

        if ($response->failed()) {
            throw new RuntimeException(
                "MetaTFT API failed for {$baseUrl}/{$endpoint}: HTTP {$response->status()}",
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
