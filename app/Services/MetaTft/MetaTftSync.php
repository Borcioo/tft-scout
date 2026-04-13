<?php

namespace App\Services\MetaTft;

use App\Models\Champion;
use App\Models\ChampionCompanion;
use App\Models\ChampionRating;
use App\Models\ChampionTraitAffinity;
use App\Models\MetaComp;
use App\Models\MetaSync;
use App\Models\Set;
use App\Models\TftTrait;
use App\Models\TraitRating;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
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
    public function __construct(
        private readonly MetaTftClient $client,
    ) {}

    public function run(int $setNumber): MetaSync
    {
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
        ];

        try {
            DB::transaction(function () use (
                $set, $championsByApiName, $traitsByApiName, &$counts,
            ) {
                $counts['units'] = $this->syncUnitRatings($set, $championsByApiName);
                $counts['traits'] = $this->syncTraitRatings($set, $traitsByApiName);
                $counts['meta_comps'] = $this->syncMetaComps($set, $championsByApiName, $traitsByApiName);

                // Per-champion fetches run AFTER bulk inserts so the
                // outer transaction rolls back affinity/companions on
                // failure of the bulk block.
                foreach ($championsByApiName as $apiName => $champion) {
                    if (! $champion->is_playable) {
                        continue;
                    }
                    $counts['affinity'] += $this->syncAffinityForChampion(
                        $champion, $set, $traitsByApiName,
                    );
                    $counts['companions'] += $this->syncCompanionsForChampion(
                        $champion, $set, $championsByApiName,
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
            'status' => $status,
            'notes' => $notes,
        ]);
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

        // Replace strategy — per-champion affinity is small (5-10 rows)
        // and the exact trait list can shift between patches.
        ChampionTraitAffinity::query()
            ->where('champion_id', $champion->id)
            ->delete();

        $count = 0;
        foreach ($dtos as $dto) {
            $trait = $traitsByApiName[$dto->traitApiName] ?? null;
            if ($trait === null) {
                continue;
            }

            ChampionTraitAffinity::create([
                'champion_id' => $champion->id,
                'trait_id' => $trait->id,
                'breakpoint_position' => $dto->breakpointPosition,
                'set_id' => $set->id,
                'avg_place' => $dto->avgPlace,
                'games' => $dto->games,
                'frequency' => $dto->frequency,
            ]);
            $count++;
        }

        return $count;
    }

    private function syncCompanionsForChampion(Champion $champion, Set $set, $championsByApiName): int
    {
        try {
            $dtos = $this->client->fetchCompanions($champion->api_name);
        } catch (Throwable $e) {
            Log::warning("Companions fetch failed for {$champion->api_name}: ".$e->getMessage());

            return 0;
        }

        ChampionCompanion::query()
            ->where('champion_id', $champion->id)
            ->delete();

        $count = 0;
        foreach ($dtos as $dto) {
            $companion = $championsByApiName[$dto->companionApiName] ?? null;
            if ($companion === null) {
                continue;
            }

            ChampionCompanion::create([
                'champion_id' => $champion->id,
                'companion_champion_id' => $companion->id,  // actual DB column name
                'set_id' => $set->id,
                'avg_place' => $dto->avgPlace,
                'games' => $dto->games,
                'frequency' => $dto->frequency,
            ]);
            $count++;
        }

        return $count;
    }
}
