<?php

namespace App\Services\MetaTft;

use App\Models\Champion;
use App\Models\ChampionCompanion;
use App\Models\ChampionItemBuild;
use App\Models\ChampionItemSet;
use App\Models\ChampionRating;
use App\Models\ChampionTraitAffinity;
use App\Models\Item;
use App\Models\MetaComp;
use App\Models\MetaSync;
use App\Models\Set;
use App\Models\TftTrait;
use App\Models\TraitRating;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use RuntimeException;
use Throwable;

/**
 * Orchestrates a full MetaTFT sync for one set.
 *
 * Flow:
 *   1. Fetch units + traits + meta_comps via MetaTftClient (bulk)
 *   2. For each playable champion, fetch per-champion affinity + companions
 *   3. Upsert everything inside a single DB transaction so a half-sync
 *      can't leave the DB in a weird state
 *   4. Write a `meta_syncs` row with counts + status
 *
 * Idempotent: safe to re-run. Upserts use `(champion_id, patch)` or
 * equivalent unique constraints to overwrite existing rows.
 */
class MetaTftSync
{
    /** @var array<int, true> Champion IDs whose item fetch failed this run. */
    private array $itemFetchFailedChampions = [];

    /** @var (\Closure(string): void)|null Optional progress reporter. */
    private ?\Closure $progress = null;

    public function __construct(
        private readonly MetaTftClient $client,
    ) {}

    /**
     * Attach a progress callback. Called with human-readable status
     * strings as the sync progresses through each phase and per-champion
     * batch. Use from the Artisan command to stream updates to the user.
     */
    public function onProgress(\Closure $cb): self
    {
        $this->progress = $cb;

        return $this;
    }

    private function log(string $msg): void
    {
        if ($this->progress) {
            ($this->progress)($msg);
        }
    }

    /**
     * @param  int  $concurrency  When >1, prewarm per-champion caches in
     *         parallel with Http::pool. Default 1 preserves the legacy
     *         sequential behavior for safety.
     *
     * @throws RuntimeException if another sync is already running for this
     *         set (CLI invocation racing with a queue job, or two queue
     *         workers somehow picking up the same job). The lock is
     *         released in `finally` so a crashed run never strands it.
     */
    public function run(int $setNumber, int $concurrency = 1): MetaSync
    {
        // Service-layer guard — the middleware + ShouldBeUnique already
        // block most duplicate paths, but this protects against CLI
        // runs (`artisan metatft:sync`) colliding with a queued refresh.
        //
        // TTL 600s — prod sync on mikrus 2GB runs ~5-7 min total (prewarm
        // ~1 min, serial per-champion DB writes ~4-6 min). 300s was too
        // aggressive; lock expired mid-sync and next dispatch could start
        // a concurrent run. 600s = comfortable margin above observed p95.
        $lock = Cache::lock("meta-tft-sync-running:{$setNumber}", 600);
        if (! $lock->get()) {
            throw new RuntimeException(
                "MetaTftSync: another run is already in progress for set {$setNumber}",
            );
        }

        try {
            return $this->runLocked($setNumber, $concurrency);
        } finally {
            $lock->release();
        }
    }

    /**
     * Inner sync body — held behind the Cache::lock in run().
     */
    private function runLocked(int $setNumber, int $concurrency): MetaSync
    {
        $this->client->resetRunCache();
        $set = Set::query()->where('number', $setNumber)->firstOrFail();

        $championsByApiName = Champion::query()
            ->where('set_id', $set->id)
            ->get()
            ->keyBy('api_name')
            // ->all() flattens to a plain PHP array so the `[$key] ?? null`
            // lookups below don't trigger Collection::offsetGet, which in
            // PHP 8 emits "Undefined array key" before the null-coalesce
            // can swallow it. Seen on meta unit `TFT17_Summon` (a PvE row
            // from MetaTFT that has no matching champion in our DB).
            ->all();

        $traitsByApiName = TftTrait::query()
            ->where('set_id', $set->id)
            ->get()
            ->keyBy('api_name')
            // ->all() flattens to a plain PHP array so the `[$key] ?? null`
            // lookups below don't trigger Collection::offsetGet, which in
            // PHP 8 emits "Undefined array key" before the null-coalesce
            // can swallow it. Seen on meta unit `TFT17_Summon` (a PvE row
            // from MetaTFT that has no matching champion in our DB).
            ->all();

        $status = 'ok';
        $notes = null;
        $counts = [
            'units' => 0,
            'traits' => 0,
            'affinity' => 0,
            'companions' => 0,
            'meta_comps' => 0,
            'item_stats' => 0,
            'item_builds' => 0,
        ];
        $this->itemFetchFailedChampions = [];
        $runStartedAt = CarbonImmutable::now();

        // Build the per-champion sync list ONCE — used both for prewarm
        // (before the transaction) and the inner loop (inside). Include
        // variant-parent rows (is_playable=false but referenced via
        // base_champion_id by playable variants) so the scorer can look
        // up affinity/companions for champions like TFT17_MissFortune —
        // MetaTFT publishes stats under the base apiName, and the
        // scorer's `baseApiName || apiName` fallback needs those rows
        // populated or variant champs end up with zero score.
        $variantParentIds = Champion::query()
            ->where('set_id', $set->id)
            ->whereNotNull('base_champion_id')
            ->distinct()
            ->pluck('base_champion_id')
            ->flip()
            ->all();

        $toSync = [];
        foreach ($championsByApiName as $apiName => $champion) {
            if (! $champion->is_playable && ! isset($variantParentIds[$champion->id])) {
                continue;
            }
            $toSync[] = [$apiName, $champion];
        }
        $totalChamps = count($toSync);

        // PHASE 1 — prewarm HTTP cache BEFORE opening the DB transaction.
        //
        // Keeping HTTP I/O out of `DB::transaction` is critical: Postgres
        // holds the connection in "idle in transaction" for the full
        // duration of the pool's network round-trips, blocking concurrent
        // writers and occasionally wedging the whole sync on slower boxes
        // (observed on mikrus 2GB — 6+ minute lockups). With prewarm
        // outside, the subsequent transaction hits warm cache and does
        // pure DB work with no network waits.
        if ($concurrency > 1 && $totalChamps > 0) {
            $this->log("Prewarming HTTP cache for {$totalChamps} champions (concurrency={$concurrency})...");
            $apiNames = array_map(fn ($row) => $row[0], $toSync);
            $this->client->prewarmChampionsBatch(
                $apiNames,
                $concurrency,
                function (int $done, int $total) {
                    $this->log("  prewarm batch {$done}/{$total}");
                },
            );
            $this->log('  → prewarm done, DB transaction will hit cache');
        }

        try {
            DB::transaction(function () use (
                $set, $championsByApiName, $traitsByApiName, &$counts, $runStartedAt, $toSync, $totalChamps,
            ) {
                $this->log('Fetching bulk unit ratings...');
                $counts['units'] = $this->syncUnitRatings($set, $championsByApiName);
                $this->log("  → {$counts['units']} unit ratings upserted");

                $this->log('Fetching bulk trait ratings...');
                $counts['traits'] = $this->syncTraitRatings($set, $traitsByApiName);
                $this->log("  → {$counts['traits']} trait ratings upserted");

                $this->log('Fetching meta comps (cluster data)...');
                $counts['meta_comps'] = $this->syncMetaComps($set, $championsByApiName, $traitsByApiName);
                $this->log("  → {$counts['meta_comps']} meta comps upserted");

                $total = $totalChamps;
                $this->log("Fetching per-champion data (affinity + companions + items) for {$total} champions...");

                $i = 0;
                foreach ($toSync as [$apiName, $champion]) {
                    $i++;
                    $this->log("  [{$i}/{$total}] {$apiName}");
                    $counts['affinity'] += $this->syncAffinityForChampion(
                        $champion, $set, $traitsByApiName,
                    );
                    $counts['companions'] += $this->syncCompanionsForChampion(
                        $champion, $set, $championsByApiName,
                    );
                    $counts['item_stats'] += $this->syncItemStatsForChampion(
                        $champion, $set, $runStartedAt,
                    );
                    $counts['item_builds'] += $this->syncItemBuildsForChampion(
                        $champion, $set, $runStartedAt,
                    );
                }
            });
        } catch (Throwable $e) {
            $status = 'failed';
            $notes = $e->getMessage();
            Log::error('MetaTftSync failed', [
                'set' => $setNumber,
                'error' => $e->getMessage(),
                'file' => $e->getFile().':'.$e->getLine(),
            ]);
        }

        return MetaSync::create([
            'set_id' => $set->id,
            'synced_at' => now(),
            'units_count' => $counts['units'],
            'traits_count' => $counts['traits'],
            'affinity_count' => $counts['affinity'],
            'companions_count' => $counts['companions'],
            'meta_comps_count' => $counts['meta_comps'],
            'item_stats_count' => $counts['item_stats'],
            'item_builds_count' => $counts['item_builds'],
            'failed_item_champions' => count($this->itemFetchFailedChampions),
            'status' => $status,
            'notes' => $notes,
        ]);
    }

    /**
     * Sync single-item MetaTFT stats for one champion.
     *
     * Uses `champion_item_builds` (legacy name — stores 1 item × champion
     * rows, not multi-item builds). Fold-keys on (champion_id, item_id)
     * unique constraint so re-runs upsert. Rows for items that disappear
     * from the response are deleted unless the fetch itself failed, in
     * which case we preserve the previous snapshot.
     */
    private function syncItemStatsForChampion(
        Champion $champion,
        Set $set,
        CarbonImmutable $runStartedAt,
    ): int {
        try {
            $dtos = $this->client->fetchItemStats($champion->api_name);
        } catch (Throwable $e) {
            Log::warning("fetchItemStats failed for {$champion->api_name}: ".$e->getMessage());
            $this->itemFetchFailedChampions[$champion->id] = true;

            return 0;
        }

        if (empty($dtos)) {
            return 0;
        }

        $apiNames = array_map(fn ($d) => $d->itemApiName, $dtos);
        $itemsByApi = Item::query()
            ->where('set_id', $set->id)
            ->whereIn('api_name', $apiNames)
            ->pluck('id', 'api_name')
            ->all();

        // Fetch all existing rows once for prev_avg_place lookup — was
        // one SELECT per item inside the loop (~8-20 per champion).
        $itemIds = array_values(array_filter($itemsByApi));
        $prevByItemId = empty($itemIds)
            ? []
            : ChampionItemBuild::query()
                ->where('champion_id', $champion->id)
                ->whereIn('item_id', $itemIds)
                ->pluck('avg_place', 'item_id')
                ->all();

        $rows = [];
        foreach ($dtos as $dto) {
            $itemId = $itemsByApi[$dto->itemApiName] ?? null;
            if ($itemId === null) {
                continue;
            }

            $prevAvg = $prevByItemId[$itemId] ?? null;
            $placeChange = $prevAvg !== null ? $dto->avgPlace - $prevAvg : null;
            $tier = TierCalculator::compute($dto->avgPlace, $dto->games);

            $rows[] = [
                'champion_id' => $champion->id,
                'item_id' => $itemId,
                'set_id' => $set->id,
                'avg_place' => $dto->avgPlace,
                'games' => $dto->games,
                'frequency' => $dto->frequency,
                'win_rate' => $dto->winRate,
                'top4_rate' => $dto->top4Rate,
                'prev_avg_place' => $prevAvg,
                'place_change' => $placeChange,
                'tier' => $tier,
                'synced_at' => $runStartedAt,
            ];
        }

        // Single bulk upsert replaces N × (SELECT + UPDATE/INSERT) —
        // the per-item updateOrCreate was ~3 round-trips each.
        if (! empty($rows)) {
            DB::table('champion_item_builds')->upsert(
                $rows,
                ['champion_id', 'item_id'],
                [
                    'set_id', 'avg_place', 'games', 'frequency',
                    'win_rate', 'top4_rate', 'prev_avg_place',
                    'place_change', 'tier', 'synced_at',
                ],
            );
        }

        if (! isset($this->itemFetchFailedChampions[$champion->id])) {
            ChampionItemBuild::query()
                ->where('champion_id', $champion->id)
                ->where(function ($q) use ($runStartedAt) {
                    $q->whereNull('synced_at')->orWhere('synced_at', '<', $runStartedAt);
                })
                ->delete();
        }

        return count($rows);
    }

    /**
     * Sync 3-item (or 1/2-item) build combinations for one champion.
     *
     * Uses `champion_item_sets` (legacy name — stores item combos as
     * Postgres text[]). Builds are identified by the sorted `item_api_names`
     * array so `(BT, IE, Sterak)` dedups against `(IE, Sterak, BT)`.
     *
     * Bulk strategy: prefetch existing rows (1 SELECT) for prev_avg_place
     * tracking, then DELETE all rows for this champion + single bulk
     * INSERT of fresh rows. Replaces N × (SELECT + UPDATE/INSERT) which
     * dominated the per-champion DB budget — a single champion can have
     * 100-400 build rows. There's no unique constraint on
     * (champion_id, item_api_names) so upsert() isn't available; DELETE
     * + INSERT is the cleanest alternative.
     */
    private function syncItemBuildsForChampion(
        Champion $champion,
        Set $set,
        CarbonImmutable $runStartedAt,
    ): int {
        try {
            $dtos = $this->client->fetchItemBuilds($champion->api_name);
        } catch (Throwable $e) {
            Log::warning("fetchItemBuilds failed for {$champion->api_name}: ".$e->getMessage());
            $this->itemFetchFailedChampions[$champion->id] = true;

            return 0;
        }

        if (empty($dtos)) {
            return 0;
        }

        // Prefetch existing avg_place values keyed by "a|b|c" (sorted),
        // so DELETE + INSERT doesn't lose the place_change tracking.
        $existingByKey = ChampionItemSet::query()
            ->where('champion_id', $champion->id)
            ->get(['item_api_names', 'avg_place'])
            ->mapWithKeys(function ($row) {
                $items = $row->item_api_names ?? [];
                sort($items);
                return [implode('|', $items) => $row->avg_place];
            })
            ->all();

        ChampionItemSet::query()
            ->where('champion_id', $champion->id)
            ->delete();

        $rows = [];
        foreach ($dtos as $dto) {
            $sortedItems = $dto->itemApiNames;
            sort($sortedItems);
            $itemCount = count($sortedItems);
            $key = implode('|', $sortedItems);

            $prevAvg = $existingByKey[$key] ?? null;
            $placeChange = $prevAvg !== null ? $dto->avgPlace - $prevAvg : null;
            $tier = TierCalculator::compute($dto->avgPlace, $dto->games);

            // Build postgres array literal manually — raw DB insert
            // bypasses the PostgresArray cast. Quote each element to be
            // safe with any embedded commas (item api_names don't have
            // them today but future-proof against surprises).
            $pgArray = '{'.implode(',', array_map(
                fn ($s) => '"'.str_replace(['\\', '"'], ['\\\\', '\\"'], $s).'"',
                $sortedItems,
            )).'}';

            $rows[] = [
                'champion_id' => $champion->id,
                'set_id' => $set->id,
                'item_api_names' => $pgArray,
                'avg_place' => $dto->avgPlace,
                'games' => $dto->games,
                'frequency' => $dto->frequency,
                'win_rate' => $dto->winRate,
                'top4_rate' => $dto->top4Rate,
                'item_count' => $itemCount,
                'prev_avg_place' => $prevAvg,
                'place_change' => $placeChange,
                'tier' => $tier,
                'synced_at' => $runStartedAt,
            ];
        }

        if (! empty($rows)) {
            // Chunk the insert to keep a single statement under Postgres'
            // parameter limit (65535 placeholders). 13 cols × 5000 rows
            // = 65000 params; chunk at 2000 for a wide safety margin.
            foreach (array_chunk($rows, 2000) as $chunk) {
                DB::table('champion_item_sets')->insert($chunk);
            }
        }

        return count($rows);
    }

    private function syncUnitRatings(Set $set, $championsByApiName): int
    {
        $dtos = $this->client->fetchUnits($set->number);
        $count = 0;

        foreach ($dtos as $dto) {
            $champion = $championsByApiName[$dto->apiName] ?? null;
            if ($champion === null) {
                continue;
            }

            ChampionRating::updateOrCreate(
                [
                    'champion_id' => $champion->id,
                    'patch' => $dto->patch,
                ],
                [
                    'set_id' => $set->id,
                    'avg_place' => $dto->avgPlace,
                    'win_rate' => $dto->winRate,
                    'top4_rate' => $dto->top4Rate,
                    'games' => $dto->games,
                    'score' => $dto->score(),
                    'updated_at' => now(),
                ],
            );
            $count++;
        }

        return $count;
    }

    private function syncTraitRatings(Set $set, $traitsByApiName): int
    {
        $dtos = $this->client->fetchTraits($set->number);
        $count = 0;

        foreach ($dtos as $dto) {
            $trait = $traitsByApiName[$dto->traitApiName] ?? null;
            if ($trait === null) {
                continue;
            }

            TraitRating::updateOrCreate(
                [
                    'trait_id' => $trait->id,
                    'breakpoint_position' => $dto->breakpointPosition,
                ],
                [
                    'set_id' => $set->id,
                    'avg_place' => $dto->avgPlace,
                    'win_rate' => $dto->winRate,
                    'top4_rate' => $dto->top4Rate,
                    'games' => $dto->games,
                    'score' => $dto->score(),
                    'updated_at' => now(),
                ],
            );
            $count++;
        }

        return $count;
    }

    private function syncMetaComps(Set $set, $championsByApiName, $traitsByApiName): int
    {
        $dtos = $this->client->fetchMetaComps($set->number);
        $count = 0;

        // Clear-and-rebuild approach: meta comps are few (~30) and the
        // set of valid comps changes between patches. Simpler than
        // diff-upsert via composite keys.
        MetaComp::query()->where('set_id', $set->id)->delete();

        foreach ($dtos as $dto) {
            $comp = MetaComp::create([
                'set_id' => $set->id,
                // `cluster_id` is the primary DB identifier for a
                // cluster (unique, not-null); `external_id` mirrors it
                // and was added later for cross-reference — set both.
                'cluster_id' => $dto->id,
                'external_id' => $dto->id,
                'name' => $dto->name,
                'avg_place' => $dto->avgPlace,
                'games' => $dto->games,
                'level' => $dto->level,
            ]);

            // Attach champions via pivot (meta_comp_champions).
            $champIds = collect($dto->championApiNames)
                ->map(fn ($api) => ($championsByApiName[$api] ?? null)?->id)
                ->filter()
                ->values()
                ->all();

            if (! empty($champIds)) {
                $comp->champions()->sync($champIds);
            }

            $count++;
        }

        return $count;
    }

    private function syncAffinityForChampion(Champion $champion, Set $set, $traitsByApiName): int
    {
        try {
            $dtos = $this->client->fetchAffinity($champion->api_name);
        } catch (Throwable $e) {
            Log::warning("Affinity fetch failed for {$champion->api_name}: ".$e->getMessage());

            return 0;
        }

        // Bulk DELETE + INSERT. Was: DELETE + N × Model::create() →
        // N+1 round-trips per champion (~10 queries × 60 champs = 600+).
        // Now: 2 queries per champion (DELETE + single bulk INSERT).
        ChampionTraitAffinity::query()
            ->where('champion_id', $champion->id)
            ->delete();

        $rows = [];
        foreach ($dtos as $dto) {
            $trait = $traitsByApiName[$dto->traitApiName] ?? null;
            if ($trait === null) {
                continue;
            }

            $rows[] = [
                'champion_id' => $champion->id,
                'trait_id' => $trait->id,
                'breakpoint_position' => $dto->breakpointPosition,
                'set_id' => $set->id,
                'avg_place' => $dto->avgPlace,
                'games' => $dto->games,
                'frequency' => $dto->frequency,
            ];
        }

        if (! empty($rows)) {
            ChampionTraitAffinity::insert($rows);
        }

        return count($rows);
    }

    private function syncCompanionsForChampion(Champion $champion, Set $set, $championsByApiName): int
    {
        try {
            $dtos = $this->client->fetchCompanions($champion->api_name);
        } catch (Throwable $e) {
            Log::warning("Companions fetch failed for {$champion->api_name}: ".$e->getMessage());

            return 0;
        }

        // Same DELETE + bulk INSERT pattern as affinity — per-row
        // ChampionCompanion::create() was dominating the per-champion
        // time budget.
        ChampionCompanion::query()
            ->where('champion_id', $champion->id)
            ->delete();

        $rows = [];
        foreach ($dtos as $dto) {
            $companion = $championsByApiName[$dto->companionApiName] ?? null;
            if ($companion === null) {
                continue;
            }

            $rows[] = [
                'champion_id' => $champion->id,
                'companion_champion_id' => $companion->id,
                'set_id' => $set->id,
                'avg_place' => $dto->avgPlace,
                'games' => $dto->games,
                'frequency' => $dto->frequency,
            ];
        }

        if (! empty($rows)) {
            ChampionCompanion::insert($rows);
        }

        return count($rows);
    }
}
