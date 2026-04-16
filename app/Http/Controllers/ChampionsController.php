<?php

namespace App\Http\Controllers;

use App\Models\Champion;
use App\Models\ChampionItemBuild;
use App\Models\ChampionItemSet;
use App\Models\Item;
use Inertia\Inertia;
use Inertia\Response;

class ChampionsController extends Controller
{
    /**
     * List all base champions (no variants) with their traits.
     *
     * Variants (MF forms, Mecha Enhanced) are NOT shown in the list — they
     * only exist on the champion detail page behind a form selector. This
     * keeps the browse experience clean (one card per character).
     *
     * Note: base Miss Fortune has is_playable=false (she can't be fielded
     * in her "pure" form) but we STILL show her here because she's a base
     * character — on her detail page the player picks Conduit/Challenger/Replicator.
     *
     * Frontend handles search/filter client-side; full dataset is <60 rows
     * so client filtering beats round-tripping per keystroke.
     */
    public function index(): Response
    {
        $champions = Champion::query()
            ->base()
            ->with(['traits' => fn ($query) => $query->orderBy('api_name')])
            ->orderBy('cost')
            ->orderBy('name')
            ->get()
            ->map(fn ($champion) => [
                'id' => $champion->id,
                'api_name' => $champion->api_name,
                'name' => $champion->name,
                'cost' => $champion->cost,
                'role' => $champion->role,
                'damage_type' => $champion->damage_type,
                'role_category' => $champion->role_category,
                'traits' => $champion->traits->map(fn ($trait) => [
                    'api_name' => $trait->api_name,
                    'name' => $trait->name,
                    'category' => $trait->category,
                ])->all(),
            ]);

        return Inertia::render('Champions/Index', [
            'champions' => $champions,
        ]);
    }

    /**
     * Show full champion detail page with interactive star-level selector.
     *
     * Routes to /champions/{apiName} — e.g., /champions/TFT17_Aatrox.
     * 404s if champion not found.
     *
     * Loads:
     *   - The champion with all traits (including unique/hidden)
     *   - Its variants (for MF/Mecha form selector on the detail page)
     *   - Or its base (if this request is for a variant — e.g., MF_conduit)
     *
     * MetaTFT rating is passed as null for now — Phase B tables are empty
     * until we implement MetaTftImporter. Frontend shows a placeholder.
     */
    public function show(string $apiName): Response
    {
        $champion = Champion::query()
            ->with([
                'traits' => fn ($q) => $q->orderBy('category')->orderBy('api_name'),
                'variants.traits',
                'baseChampion.variants.traits',
                'baseChampion.traits',
            ])
            ->where('api_name', $apiName)
            ->firstOrFail();

        // Build the full "forms" list shown in the variant selector:
        //  - Find the base character (either the current champ or its parent)
        //  - Include base in the list ONLY if it's playable — for Miss Fortune
        //    the base is abstract (is_playable=false, player must pick a form)
        //  - Then append all variants tied to that base
        //
        // Result for a Mecha champion:     [Galio (base), Galio Enhanced]
        // Result for a Miss Fortune form:  [Conduit, Challenger, Replicator]
        $baseChampion = $champion->base_champion_id === null
            ? $champion
            : $champion->baseChampion;

        $forms = collect();
        if ($baseChampion->is_playable) {
            $forms->push($baseChampion);
        }
        foreach ($baseChampion->variants as $variant) {
            $forms->push($variant);
        }

        // Hide low-sample rows — a 1.0 avg over 3 games is luck, not signal.
        // Configurable via config('tft.metatft.min_games_display').
        $minGames = (int) config('tft.metatft.min_games_display', 50);

        // MetaTFT publishes stats under the base apiName (e.g. TFT17_MissFortune),
        // not per-variant (_conduit/_challenger/_replicator). Same applies to
        // Mecha Enhanced and any future variant mechanic. Fall back to the
        // base champion's rows when the current champion is a variant.
        $statsChampionId = $champion->base_champion_id ?? $champion->id;

        $itemSingleRows = ChampionItemBuild::query()
            ->with('item:id,api_name,name,icon_path')
            ->where('champion_id', $statsChampionId)
            ->where('games', '>=', $minGames)
            ->orderBy('avg_place')
            ->get();

        $itemSetRows = ChampionItemSet::query()
            ->where('champion_id', $statsChampionId)
            ->where('games', '>=', $minGames)
            ->orderBy('avg_place')
            ->get();

        $setApiNames = $itemSetRows
            ->flatMap(fn ($row) => $row->item_api_names ?? [])
            ->unique()
            ->values();

        // Include api_names of single-item rows too so we can emit `type`
        // alongside the build rows below.
        $singleApiNames = $itemSingleRows
            ->map(fn ($row) => $row->item?->api_name)
            ->filter()
            ->values();

        $itemsByApi = Item::query()
            ->whereIn('api_name', $setApiNames->merge($singleApiNames)->unique())
            ->get()
            ->keyBy('api_name');

        $syncedAt = $itemSingleRows->first()?->synced_at
            ?? $itemSetRows->first()?->synced_at;

        $metaTft = [
            // Filter out rows pointing at items we don't have in the items table
            // (e.g. TFT4_Item_OrnnTheCollector — legacy Set 4 artifact that
            // MetaTFT still returns because some players run it via portals
            // but we never imported). The UI can't render them meaningfully
            // without name/icon lookup.
            'items_single' => $itemSingleRows
                ->filter(fn ($row) => $row->item !== null)
                ->map(fn ($row) => [
                'api_name' => $row->item->api_name,
                'name' => $row->item->name ?? $row->item->api_name,
                'icon' => $row->item->icon_path,
                // `type` is the canonical class (base/craftable/radiant/artifact/
                // support/trait_item). `is_tactician` is a separate axis — some
                // craftables are Tactician's hatbox items (TacticiansRing/Scepter/
                // ForceOfNature) that players may want to filter independently.
                'type' => $row->item->type,
                'is_tactician' => str_contains($row->item->api_name, 'Tacticians')
                    || str_contains($row->item->api_name, 'ForceOfNature'),
                'games' => $row->games,
                'avg_place' => $row->avg_place,
                'place_change' => $row->place_change,
                'win_rate' => $row->win_rate,
                'top4_rate' => $row->top4_rate,
                'frequency' => $row->frequency,
                'tier' => $row->tier,
            ])->values()->all(),
            // Same filter as items_single — skip builds containing any item
            // we don't have in the items table.
            'items_builds' => $itemSetRows
                ->filter(function ($row) use ($itemsByApi) {
                    $apiNames = $row->item_api_names ?? [];
                    foreach ($apiNames as $api) {
                        if (! $itemsByApi->has($api)) {
                            return false;
                        }
                    }
                    return true;
                })
                ->map(function ($row) use ($itemsByApi) {
                $apiNames = $row->item_api_names ?? [];

                return [
                    'items' => $apiNames,
                    'names' => array_map(
                        fn ($api) => $itemsByApi->get($api)?->name ?? $api,
                        $apiNames,
                    ),
                    'icons' => array_map(
                        fn ($api) => $itemsByApi->get($api)?->icon_path,
                        $apiNames,
                    ),
                    'types' => array_map(
                        fn ($api) => $itemsByApi->get($api)?->type,
                        $apiNames,
                    ),
                    'is_tactician' => array_map(
                        fn ($api) => str_contains($api, 'Tacticians')
                            || str_contains($api, 'ForceOfNature'),
                        $apiNames,
                    ),
                    'games' => $row->games,
                    'avg_place' => $row->avg_place,
                    'place_change' => $row->place_change,
                    'win_rate' => $row->win_rate,
                    'top4_rate' => $row->top4_rate,
                    'frequency' => $row->frequency,
                    'tier' => $row->tier,
                ];
            })->values()->all(),
            'synced_at' => $syncedAt,
        ];

        return Inertia::render('Champions/Show', [
            'champion' => $this->serializeChampion($champion),
            'variants' => $forms->map(
                fn ($v) => $this->serializeChampion($v)
            )->all(),
            // Phase B MetaTFT integration is still pending.
            // When ChampionRating is wired up, replace null with:
            //   ChampionRating::where('champion_id', $champion->id)->first()
            'rating' => null,
            'metatft' => $metaTft,
        ]);
    }

    /**
     * Shared shape used by both index (list) and show (detail) pages.
     * Detail page needs more fields (stats, ability) than list.
     */
    private function serializeChampion(Champion $champion): array
    {
        return [
            'id' => $champion->id,
            'api_name' => $champion->api_name,
            'name' => $champion->name,
            'cost' => $champion->cost,
            'role' => $champion->role,
            'damage_type' => $champion->damage_type,
            'role_category' => $champion->role_category,
            'is_playable' => $champion->is_playable,
            'variant_label' => $champion->variant_label,
            'base_champion_api_name' => $champion->baseChampion?->api_name,

            // Base stats at 1-star (frontend scales for 2/3-star display)
            'stats' => [
                'hp' => round($champion->hp),
                'armor' => round($champion->armor),
                'magic_resist' => round($champion->magic_resist),
                'attack_damage' => round($champion->attack_damage),
                'attack_speed' => round($champion->attack_speed, 2),
                'mana' => round($champion->mana),
                'start_mana' => round($champion->start_mana),
                'range' => round($champion->range),
                'crit_chance' => round($champion->crit_chance, 2),
                'crit_multiplier' => round($champion->crit_multiplier, 2),
            ],

            'ability_desc' => $champion->ability_desc,
            'ability_name' => $champion->ability_name,
            'ability_icon_path' => $champion->ability_icon_path,
            'ability_stats' => $champion->ability_stats ?? [],

            'traits' => $champion->traits->map(fn ($trait) => [
                'api_name' => $trait->api_name,
                'name' => $trait->name,
                'category' => $trait->category,
            ])->all(),
        ];
    }
}
