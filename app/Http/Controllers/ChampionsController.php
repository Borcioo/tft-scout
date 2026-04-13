<?php

namespace App\Http\Controllers;

use App\Models\Champion;
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

        return Inertia::render('Champions/Show', [
            'champion' => $this->serializeChampion($champion),
            'variants' => $forms->map(
                fn ($v) => $this->serializeChampion($v)
            )->all(),
            // Phase B MetaTFT integration is still pending.
            // When ChampionRating is wired up, replace null with:
            //   ChampionRating::where('champion_id', $champion->id)->first()
            'rating' => null,
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
