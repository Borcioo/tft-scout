<?php

namespace App\Services\Scout;

use App\Models\Champion;
use App\Models\ChampionCompanion;
use App\Models\ChampionItemSet;
use App\Models\ChampionRating;
use App\Models\ChampionTraitAffinity;
use App\Models\MetaComp;
use App\Models\MetaSync;
use App\Models\Set;
use App\Models\TftTrait;
use App\Models\TraitRating;
use App\Models\TraitStyle;

/**
 * Assembles the JSON payload that the scout Web Worker consumes.
 *
 * Shape matches the `ctx` object expected by
 * `resources/js/workers/scout/engine.ts`. See the spec for full field
 * definitions.
 */
class ScoutContextBuilder
{
    public function build(int $setNumber): array
    {
        $set = Set::query()->where('number', $setNumber)->firstOrFail();

        $champions = $this->buildChampions($set);
        $traits = $this->buildTraits($set);
        $exclusionGroups = $this->buildExclusionGroups($set);
        $scoringCtx = $this->buildScoringCtx($set);

        $lastSync = MetaSync::query()
            ->where('set_id', $set->id)
            ->where('status', 'ok')
            ->orderByDesc('synced_at')
            ->first();

        $syncedAt = $lastSync?->synced_at?->toIso8601String();
        $stale = $lastSync === null
            || $lastSync->synced_at->lt(now()->subHours(24));

        return [
            'champions' => $champions,
            'traits' => $traits,
            'exclusionGroups' => $exclusionGroups,
            'scoringCtx' => $scoringCtx,
            'syncedAt' => $syncedAt,
            'stale' => $stale,
        ];
    }

    /**
     * Build a map of championApiName → top 5 3-item builds for that
     * champion, sorted by avgPlace ascending. Only includes builds with
     * item_count=3 and games >= 50 to avoid noise. Each build carries
     * enough detail for the UI (item apiNames + names + icons + tier +
     * stats) so the frontend can render accordion rows without fetching.
     *
     * Tactician items filtered out — they're hatbox-wide stats not
     * relevant to combat BIS selection.
     */
    /**
     * Public entry point used by ScoutController to embed item builds
     * in the Inertia props (no separate fetch needed on frontend).
     */
    public function buildItemBuildsForInertia(int $setNumber): array
    {
        $set = Set::query()->where('number', $setNumber)->firstOrFail();

        return $this->buildItemBuilds($set);
    }

    private function buildItemBuilds(Set $set): array
    {
        $rows = ChampionItemSet::query()
            ->join('champions', 'champions.id', '=', 'champion_item_sets.champion_id')
            ->where('champions.set_id', $set->id)
            ->where('champion_item_sets.item_count', 3)
            ->where('champion_item_sets.games', '>=', 50)
            ->orderBy('champions.api_name')
            ->orderBy('champion_item_sets.avg_place')
            ->get([
                'champions.api_name as champ_api',
                'champion_item_sets.item_api_names',
                'champion_item_sets.avg_place',
                'champion_item_sets.games',
                'champion_item_sets.tier',
                'champion_item_sets.frequency',
                'champion_item_sets.place_change',
            ]);

        // Item lookup for names + icons
        $allItemApis = $rows
            ->flatMap(fn ($r) => $r->item_api_names ?? [])
            ->unique()
            ->values();

        $itemsByApi = \App\Models\Item::query()
            ->whereIn('api_name', $allItemApis)
            ->get()
            ->keyBy('api_name');

        $isTactician = fn (string $api) => str_contains($api, 'Tacticians')
            || str_contains($api, 'ForceOfNature');

        $map = [];
        foreach ($rows as $row) {
            $apiNames = $row->item_api_names ?? [];

            // Skip builds containing any tactician item
            if (array_filter($apiNames, $isTactician)) {
                continue;
            }

            // Skip builds referencing items not in DB (cross-set legacy)
            $allKnown = true;
            foreach ($apiNames as $api) {
                if (! $itemsByApi->has($api)) {
                    $allKnown = false;
                    break;
                }
            }
            if (! $allKnown) {
                continue;
            }

            $map[$row->champ_api] ??= [];

            // Cap at top 5 per champion
            if (count($map[$row->champ_api]) >= 5) {
                continue;
            }

            $map[$row->champ_api][] = [
                'items' => $apiNames,
                'names' => array_map(
                    fn ($api) => $itemsByApi->get($api)?->name ?? $api,
                    $apiNames,
                ),
                'avgPlace' => (float) $row->avg_place,
                'games' => (int) $row->games,
                'tier' => $row->tier,
                'frequency' => (float) $row->frequency,
                'placeChange' => $row->place_change !== null ? (float) $row->place_change : null,
            ];
        }

        return $map;
    }

    private function buildChampions(Set $set): array
    {
        return Champion::query()
            ->where('set_id', $set->id)
            ->where('is_playable', true)
            ->with(['traits:id,api_name,name'])
            ->get()
            ->map(fn (Champion $c) => [
                'apiName' => $c->api_name,
                'name' => $c->name,
                'cost' => $c->cost,
                'traits' => $c->traits->pluck('api_name')->all(),
                'traitNames' => $c->traits->pluck('name')->all(),
                'slotsUsed' => $c->slots_used,
                'baseApiName' => $c->baseChampion?->api_name,
                'variant' => $c->variant_label,
                'role' => $c->role,
                'damageType' => $c->damage_type,
                'roleCategory' => $c->role_category,
                'icon' => '/icons/champions/'.$c->api_name.'.png',
                'abilityIcon' => $c->ability_icon_path
                    ? '/icons/abilities/'.$c->api_name.'.png'
                    : null,
                'plannerCode' => $c->planner_code,
            ])
            ->values()
            ->all();
    }

    private function buildTraits(Set $set): array
    {
        $styles = TraitStyle::pluck('name', 'id')->all();

        return TftTrait::query()
            ->where('set_id', $set->id)
            ->whereIn('category', ['public', 'unique'])
            ->with('breakpoints')
            ->get()
            ->map(fn (TftTrait $t) => [
                'apiName' => $t->api_name,
                'name' => $t->name,
                'category' => $t->category,
                'breakpoints' => $t->breakpoints
                    ->sortBy('position')
                    ->map(fn ($bp) => [
                        'position' => $bp->position,
                        'minUnits' => $bp->min_units,
                        'maxUnits' => $bp->max_units >= 25000 ? null : $bp->max_units,
                        'style' => $styles[$bp->style_id] ?? null,
                    ])
                    ->values()
                    ->all(),
                'icon' => '/icons/traits/'.$t->api_name.'.png',
            ])
            ->values()
            ->all();
    }

    /**
     * Convert `base_champion_id` self-FK into the shape the scout
     * algorithm expects: a list of mutually-exclusive apiName groups.
     * Each group holds champions that cannot appear together in a team
     * (MF Conduit/Challenger/Replicator, Galio/Galio Enhanced, etc.).
     */
    private function buildExclusionGroups(Set $set): array
    {
        $champions = Champion::query()
            ->where('set_id', $set->id)
            ->get(['id', 'api_name', 'base_champion_id', 'is_playable']);

        $groups = [];
        foreach ($champions as $champ) {
            $rootId = $champ->base_champion_id ?? $champ->id;
            $groups[$rootId] ??= [];
            if ($champ->is_playable) {
                $groups[$rootId][] = $champ->api_name;
            }
        }

        return array_values(array_filter(
            $groups,
            fn (array $group) => count($group) > 1,
        ));
    }

    private function buildScoringCtx(Set $set): array
    {
        return [
            'unitRatings' => $this->buildUnitRatings($set),
            'traitRatings' => $this->buildTraitRatings($set),
            'affinity' => $this->buildAffinity($set),
            'companions' => $this->buildCompanions($set),
            'metaComps' => $this->buildMetaComps($set),
            'styleScores' => $this->buildStyleScores(),
        ];
    }

    private function buildUnitRatings(Set $set): array
    {
        return ChampionRating::query()
            ->join('champions', 'champions.id', '=', 'champion_ratings.champion_id')
            ->where('champion_ratings.set_id', $set->id)
            ->get([
                'champions.api_name as api_name',
                'champion_ratings.avg_place',
                'champion_ratings.win_rate',
                'champion_ratings.top4_rate',
                'champion_ratings.games',
                'champion_ratings.score',
            ])
            ->mapWithKeys(fn ($row) => [
                $row->api_name => [
                    'avgPlace' => (float) $row->avg_place,
                    'winRate' => (float) $row->win_rate,
                    'top4Rate' => (float) $row->top4_rate,
                    'games' => (int) $row->games,
                    'score' => (float) $row->score,
                ],
            ])
            ->all();
    }

    private function buildTraitRatings(Set $set): array
    {
        $rows = TraitRating::query()
            ->join('traits', 'traits.id', '=', 'trait_ratings.trait_id')
            ->where('trait_ratings.set_id', $set->id)
            ->get([
                'traits.api_name as api_name',
                'trait_ratings.breakpoint_position',
                'trait_ratings.avg_place',
                'trait_ratings.win_rate',
                'trait_ratings.games',
                'trait_ratings.score',
            ]);

        $map = [];
        foreach ($rows as $row) {
            $map[$row->api_name] ??= [];
            $map[$row->api_name][(int) $row->breakpoint_position] = [
                'avgPlace' => (float) $row->avg_place,
                'winRate' => (float) $row->win_rate,
                'games' => (int) $row->games,
                'score' => (float) $row->score,
            ];
        }

        return $map;
    }

    private function buildAffinity(Set $set): array
    {
        $rows = ChampionTraitAffinity::query()
            ->join('champions', 'champions.id', '=', 'champion_trait_affinity.champion_id')
            ->join('traits', 'traits.id', '=', 'champion_trait_affinity.trait_id')
            ->where('champions.set_id', $set->id)
            ->orderBy('champions.api_name')
            ->orderBy('champion_trait_affinity.avg_place')
            ->get([
                'champions.api_name as champ_api',
                'traits.api_name as trait_api',
                'champion_trait_affinity.breakpoint_position',
                'champion_trait_affinity.avg_place',
                'champion_trait_affinity.games',
                'champion_trait_affinity.frequency',
            ]);

        $map = [];
        foreach ($rows as $row) {
            $map[$row->champ_api] ??= [];
            $map[$row->champ_api][] = [
                'trait' => $row->trait_api,
                'breakpoint' => (int) $row->breakpoint_position,
                'avgPlace' => (float) $row->avg_place,
                'games' => (int) $row->games,
                'frequency' => (float) $row->frequency,
            ];
        }

        return $map;
    }

    private function buildCompanions(Set $set): array
    {
        $rows = ChampionCompanion::query()
            ->join('champions as c1', 'c1.id', '=', 'champion_companions.champion_id')
            ->join('champions as c2', 'c2.id', '=', 'champion_companions.companion_champion_id')
            ->where('c1.set_id', $set->id)
            ->orderBy('c1.api_name')
            ->orderBy('champion_companions.avg_place')
            ->get([
                'c1.api_name as champ_api',
                'c2.api_name as companion_api',
                'champion_companions.avg_place',
                'champion_companions.games',
                'champion_companions.frequency',
            ]);

        $map = [];
        foreach ($rows as $row) {
            $map[$row->champ_api] ??= [];
            $map[$row->champ_api][] = [
                'companion' => $row->companion_api,
                'avgPlace' => (float) $row->avg_place,
                'games' => (int) $row->games,
                'frequency' => (float) $row->frequency,
            ];
        }

        return $map;
    }

    private function buildMetaComps(Set $set): array
    {
        return MetaComp::query()
            ->where('set_id', $set->id)
            ->with('champions:id,api_name')
            ->orderBy('avg_place')
            ->get()
            ->map(fn (MetaComp $comp) => [
                'id' => $comp->external_id,
                'name' => $comp->name,
                // Worker (`engine.ts`) reads this as `meta.units`.
                // Keep the key name in sync with the worker.
                'units' => $comp->champions->pluck('api_name')->all(),
                'avgPlace' => (float) $comp->avg_place,
                'games' => (int) $comp->games,
                'level' => (int) $comp->level,
            ])
            ->values()
            ->all();
    }

    private function buildStyleScores(): array
    {
        return TraitStyle::query()
            ->get()
            ->mapWithKeys(fn (TraitStyle $s) => [$s->name => (float) $s->fallback_score])
            ->all();
    }
}
