<?php

namespace App\Services\MetaTft;

use App\Services\MetaTft\Dto\AffinityDto;
use App\Services\MetaTft\Dto\CompanionDto;
use App\Services\MetaTft\Dto\ItemBuildDto;
use App\Services\MetaTft\Dto\ItemStatDto;
use App\Services\MetaTft\Dto\MetaCompDto;
use App\Services\MetaTft\Dto\TraitRatingDto;
use App\Services\MetaTft\Dto\UnitRatingDto;
use Illuminate\Http\Client\Factory as HttpFactory;
use Illuminate\Http\Client\Pool;
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

    // Queue ID per MetaTFT's frontend QueueMapping: 1100=Ranked, 1090=Normal,
    // 1130=HyperRoll, 1160=DoubleUp. MUST be the integer ID — the string
    // alias "RANKED" works on /tft-stat-api and /tft-comps-api but silently
    // returns empty data on /tft-explorer-api (sample_size=0, no error).
    private readonly string $queue;

    // GOLD+ — excludes IRON/BRONZE/SILVER where players often misplay
    // comps, which skews avgPlace data. Still wide enough for sample
    // size (GOLD is ~30% of playerbase). Matches MetaTFT UI "PLATINUM+"
    // default conceptually while being one tier more permissive.
    private const DEFAULT_RANK = 'GOLD,PLATINUM,EMERALD,DIAMOND,MASTER,GRANDMASTER,CHALLENGER';

    private const DEFAULT_TTL = 3600;

    /**
     * Per-run memo for fetchTotalGames — the sync calls it once from
     * fetchItemStats and once from fetchItemBuilds for the SAME champion,
     * which doubles the HTTP work even though the answer is identical
     * within a single sync run. Cleared between runs via resetRunCache().
     *
     * @var array<string, int>
     */
    private array $totalGamesCache = [];

    public function __construct(
        private readonly HttpFactory $http,
    ) {
        $this->queue = (string) config('services.metatft.queue', 'PBE');
    }

    /**
     * Clear per-run in-memory caches. Call at the start of a sync run so
     * repeated runs in the same process (tests, queue workers) don't
     * return stale values.
     */
    public function resetRunCache(): void
    {
        $this->totalGamesCache = [];
    }

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
     * Fetch total champion games used as denominator for `frequency`.
     *
     * Explorer /total returns `{data: [{total_games, placement_count, avg_placement}]}`.
     * `total_games` can be `null` — fallback to summing placement_count.
     */
    public function fetchTotalGames(string $championApiName): int
    {
        if (isset($this->totalGamesCache[$championApiName])) {
            return $this->totalGamesCache[$championApiName];
        }

        $payload = $this->getWithCache(
            self::EXPLORER_BASE_URL,
            'total',
            $this->explorerUnitParams($championApiName),
        );

        $row = $payload['data'][0] ?? null;
        if (! is_array($row)) {
            return $this->totalGamesCache[$championApiName] = 0;
        }

        $direct = $row['total_games'] ?? null;
        if (is_numeric($direct)) {
            return $this->totalGamesCache[$championApiName] = (int) $direct;
        }

        return $this->totalGamesCache[$championApiName] =
            self::sumPlaces($row['placement_count'] ?? []);
    }

    /**
     * Fetch single-item stats for one champion from `/unit_items_unique/{api}-1`.
     *
     * Key format: `"{unitApi}-{star}&{itemApi}-{slot}"`. We strip the unit
     * and slot parts and fold all (star, slot) variants into a single row
     * per itemApi, because our tier is computed per champion×item regardless
     * of star level or inventory slot.
     *
     * @return list<ItemStatDto>
     */
    public function fetchItemStats(string $championApiName): array
    {
        $payload = $this->getWithCache(
            self::EXPLORER_BASE_URL,
            'unit_items_unique/'.$championApiName.'-1',
            $this->explorerUnitParams($championApiName),
        );

        $rows = $payload['data'] ?? [];
        $totalGames = $this->fetchTotalGames($championApiName);

        /** @var array<string, array{games:int, placeSum:int, top4:int, wins:int}> $folded */
        $folded = [];
        foreach ($rows as $row) {
            $key = $row['unit_items_unique'] ?? null;
            if ($key === null) {
                continue;
            }
            $itemApi = self::parseItemFromUnitItemKey((string) $key);
            if ($itemApi === null) {
                continue;
            }

            $places = $row['placement_count'] ?? [];
            $games = self::sumPlaces($places);
            if ($games === 0) {
                continue;
            }

            if (! isset($folded[$itemApi])) {
                $folded[$itemApi] = ['games' => 0, 'placeSum' => 0, 'top4' => 0, 'wins' => 0];
            }
            $folded[$itemApi]['games'] += $games;
            $folded[$itemApi]['placeSum'] += self::placeSum($places);
            for ($i = 0; $i < 4; $i++) {
                $folded[$itemApi]['top4'] += (int) ($places[$i] ?? 0);
            }
            $folded[$itemApi]['wins'] += (int) ($places[0] ?? 0);
        }

        $out = [];
        foreach ($folded as $itemApi => $agg) {
            $out[] = new ItemStatDto(
                championApiName: $championApiName,
                itemApiName: $itemApi,
                avgPlace: $agg['placeSum'] / $agg['games'],
                winRate: $agg['wins'] / $agg['games'],
                top4Rate: $agg['top4'] / $agg['games'],
                games: $agg['games'],
                frequency: $totalGames > 0 ? $agg['games'] / $totalGames : 0.0,
            );
        }

        return $out;
    }

    /**
     * Fetch 3-item build stats for one champion from `/unit_builds/{api}`.
     *
     * Key format: `"{unitApi}&{item1}|{item2}|{item3}"`. Build may have
     * fewer than 3 items when the key contains fewer `|` separators
     * (ThiefsGloves and emblem items appear solo). We pass the raw list
     * through — the sync layer dedups by sorting alphabetically.
     *
     * @return list<ItemBuildDto>
     */
    public function fetchItemBuilds(string $championApiName): array
    {
        $payload = $this->getWithCache(
            self::EXPLORER_BASE_URL,
            'unit_builds/'.$championApiName,
            $this->explorerUnitParams($championApiName),
        );

        $rows = $payload['data'] ?? [];
        $totalGames = $this->fetchTotalGames($championApiName);
        $out = [];

        foreach ($rows as $row) {
            $key = $row['unit_builds'] ?? null;
            if ($key === null) {
                continue;
            }
            $items = self::parseItemsFromBuildKey((string) $key);
            if (empty($items)) {
                continue;
            }

            $places = $row['placement_count'] ?? [];
            $agg = self::aggregatePlaces($places);
            if ($agg['games'] === 0) {
                continue;
            }

            $out[] = new ItemBuildDto(
                championApiName: $championApiName,
                itemApiNames: $items,
                avgPlace: $agg['avgPlace'],
                winRate: $agg['winRate'],
                top4Rate: $agg['top4Rate'],
                games: $agg['games'],
                frequency: $totalGames > 0 ? $agg['games'] / $totalGames : 0.0,
            );
        }

        return $out;
    }

    /**
     * Parse `"TFT17_Aatrox-2&TFT_Item_GuinsoosRageblade-1"` → item api_name.
     * Returns null for malformed keys.
     */
    private static function parseItemFromUnitItemKey(string $key): ?string
    {
        $parts = explode('&', $key, 2);
        if (count($parts) !== 2) {
            return null;
        }

        $itemWithSlot = $parts[1];
        $item = preg_replace('/-\d+$/', '', $itemWithSlot);

        return ($item === '' || $item === null) ? null : $item;
    }

    /**
     * Parse `"TFT17_Aatrox&TFT_Item_BloodThirster|TFT_Item_Sterak|TFT_Item_Titan"`
     * → `["TFT_Item_BloodThirster","TFT_Item_Sterak","TFT_Item_Titan"]`.
     *
     * Also handles keys with 1 or 2 items (ThiefsGloves, emblems).
     *
     * @return list<string>
     */
    private static function parseItemsFromBuildKey(string $key): array
    {
        $parts = explode('&', $key, 2);
        if (count($parts) !== 2) {
            return [];
        }

        $items = explode('|', $parts[1]);

        return array_values(array_filter(
            array_map(fn (string $s) => trim($s), $items),
            fn (string $s) => $s !== '',
        ));
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
                'queue' => $this->queue,
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
            'queue' => $this->queue,
            'patch' => 'current',
            'days' => '3',
            // Apply rank filter to bulk units/traits stats too — without
            // this we were averaging across all ranks including low elo,
            // which biased avgPlace high on skill-demanding comps like
            // Meta1 (SummonTrait+Viktor) vs easy stack comps.
            'rank' => self::DEFAULT_RANK,
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
            'queue' => $this->queue,
            'patch' => 'current',
            'days' => '1',
            'rank' => self::DEFAULT_RANK,
            'permit_filter_adjustment' => 'true',
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
        $hash = $this->cacheKey($baseUrl, $endpoint, $params);

        $cached = \App\Models\MetatftCache::query()
            ->where('endpoint', $endpoint)
            ->where('params_hash', $hash)
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
        $this->storeInCache($hash, $endpoint, $params, $data);

        return $data;
    }

    /**
     * Truncated sha256 of (base, endpoint, params). Column is varchar(16),
     * so we slice to 64 bits — collision probability across the few
     * thousand rows this table ever holds is negligible.
     *
     * @param  array<string, mixed>  $params
     */
    private function cacheKey(string $baseUrl, string $endpoint, array $params): string
    {
        ksort($params);

        return substr(
            hash('sha256', $baseUrl.':'.$endpoint.':'.json_encode($params)),
            0,
            16,
        );
    }

    /**
     * Write a payload to the metatft_cache table. Caller computes the hash
     * so it matches exactly what getWithCache looks up.
     *
     * @param  array<string, mixed>  $params
     * @param  array<mixed>  $data
     */
    private function storeInCache(string $hash, string $endpoint, array $params, array $data): void
    {
        \App\Models\MetatftCache::query()->updateOrCreate(
            ['endpoint' => $endpoint, 'params_hash' => $hash],
            [
                'params' => $params,
                'data' => $data,
                'fetched_at' => now(),
                'ttl_seconds' => self::DEFAULT_TTL,
            ],
        );
    }

    /**
     * Warm the cache for a batch of champions via concurrent HTTP.
     *
     * For every champion we need 5 explorer endpoints (traits, units_unique,
     * total, unit_items_unique/X-1, unit_builds/X). Running them one
     * champion at a time is network-bound and slow. This method fires them
     * in parallel using Http::pool, batched so the pool never holds more
     * than `$concurrency × 5` in-flight requests.
     *
     * After prewarm completes the regular fetch* methods see a cache hit
     * and skip the HTTP layer entirely, so the rest of the sync flow is
     * unchanged. Cache-fresh entries are skipped to avoid wasted traffic.
     *
     * Failures inside a batch are swallowed individually — a single bad
     * response from one champion must not poison the rest of the batch.
     * The per-champion fetch* methods will still fail loudly later when
     * called for that champion.
     *
     * @param  list<string>  $championApiNames
     * @param  callable(int, int): void|null  $onProgress  Optional
     *         "batch i of N processed" reporter for CLI progress output.
     */
    public function prewarmChampionsBatch(
        array $championApiNames,
        int $concurrency = 10,
        ?callable $onProgress = null,
    ): void {
        if ($concurrency < 1) {
            $concurrency = 1;
        }

        // Build the request plan: (key, baseUrl, endpoint, params) tuples
        // for every champion × endpoint, skipping those already fresh in
        // cache so we don't hammer MetaTFT with no-op requests.
        $requests = [];
        foreach ($championApiNames as $api) {
            $explorerParams = $this->explorerUnitParams($api);
            $endpoints = [
                'traits',
                'units_unique',
                'total',
                'unit_items_unique/'.$api.'-1',
                'unit_builds/'.$api,
            ];

            foreach ($endpoints as $endpoint) {
                $hash = $this->cacheKey(self::EXPLORER_BASE_URL, $endpoint, $explorerParams);
                $cached = \App\Models\MetatftCache::query()
                    ->where('endpoint', $endpoint)
                    ->where('params_hash', $hash)
                    ->first();
                if ($cached && $cached->isFresh()) {
                    continue;
                }

                $requests[] = [
                    'key' => $api.'|'.$endpoint,
                    'endpoint' => $endpoint,
                    'url' => self::EXPLORER_BASE_URL.'/'.$endpoint,
                    'params' => $explorerParams,
                ];
            }
        }

        if (empty($requests)) {
            return;
        }

        $chunks = array_chunk($requests, $concurrency * 5);
        $total = count($chunks);

        foreach ($chunks as $i => $chunk) {
            $responses = $this->http->pool(fn (Pool $pool) => array_map(
                fn (array $req) => $pool
                    ->as($req['key'])
                    ->timeout(30)
                    ->acceptJson()
                    ->get($req['url'], $req['params']),
                $chunk,
            ));

            foreach ($chunk as $req) {
                $res = $responses[$req['key']] ?? null;
                if ($res === null || ! method_exists($res, 'successful') || ! $res->successful()) {
                    // Leave the cache empty — the per-champion fetch path
                    // will retry and surface the error with context.
                    continue;
                }
                $data = $res->json() ?? [];
                $hash = $this->cacheKey(
                    self::EXPLORER_BASE_URL,
                    $req['endpoint'],
                    $req['params'],
                );
                $this->storeInCache($hash, $req['endpoint'], $req['params'], $data);
            }

            if ($onProgress) {
                $onProgress($i + 1, $total);
            }
        }
    }
}
