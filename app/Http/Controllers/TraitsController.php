<?php

namespace App\Http\Controllers;

use App\Models\TftTrait;
use App\Services\Tft\TraitDescriptionResolver;
use Inertia\Inertia;
use Inertia\Response;

class TraitsController extends Controller
{
    public function __construct(
        private readonly TraitDescriptionResolver $descriptionResolver,
    ) {}

    /**
     * List public traits with breakpoints, champions, and parsed
     * description + per-tier rendered text.
     *
     * Only `category = public` is shown — hidden traits (HPTank,
     * ResistTank) exist for MetaTFT grouping only, unique traits are
     * per-champion and surfaced on champion detail pages instead.
     *
     * Full dataset is small (<30 public traits), so the frontend handles
     * search/filter client-side.
     */
    public function index(): Response
    {
        // Eager-load once for both groups so we only hit the DB once and
        // keep the FE payload split by category instead of reshuffling it
        // client-side. `hidden` traits (HPTank, FlexTrait) stay out — they
        // exist purely for MetaTFT grouping and aren't player-facing.
        $traits = TftTrait::query()
            ->whereIn('category', ['public', 'unique'])
            ->with([
                'breakpoints.style',
                'champions' => fn ($q) => $q
                    ->whereNull('base_champion_id')
                    ->orderBy('cost')
                    ->orderBy('name'),
            ])
            ->orderBy('name')
            ->get();

        $serialized = $traits->map(fn (TftTrait $t) => $this->serializeTrait($t));

        return Inertia::render('Traits/Index', [
            'public_traits' => $serialized
                ->where('category', 'public')
                ->values()
                ->all(),
            'unique_traits' => $serialized
                ->where('category', 'unique')
                ->values()
                ->all(),
        ]);
    }

    /**
     * Transform a TftTrait into the frontend-consumable shape, running
     * the description through TraitDescriptionResolver so the base
     * paragraph and per-tier rows arrive pre-rendered (placeholders
     * substituted, keyword tokens expanded, unit properties stubbed to 0).
     */
    private function serializeTrait(TftTrait $trait): array
    {
        $breakpoints = $trait->breakpoints->map(fn ($b) => [
            'position' => $b->position,
            'min_units' => $b->min_units,
            // 25000 is the Riot sentinel for "unbounded top tier"
            'max_units' => $b->max_units >= 25000 ? null : $b->max_units,
            'style' => $b->style?->name,
            'effects' => $this->cleanEffects($b->effects ?? []),
        ])->all();

        $resolved = $this->descriptionResolver->resolve(
            $trait->description,
            $breakpoints,
        );

        return [
            'id' => $trait->id,
            'api_name' => $trait->api_name,
            'name' => $trait->name,
            'category' => $trait->category,
            'description' => $resolved['base'],
            // Keep the raw template around too in case the frontend wants
            // to display it for debugging or run its own parser pass.
            'description_raw' => $trait->description,
            'breakpoints' => $resolved['breakpoints'],
            'champions' => $trait->champions->map(fn ($c) => [
                'api_name' => $c->api_name,
                'name' => $c->name,
                'cost' => $c->cost,
            ])->all(),
        ];
    }

    /**
     * Round floats to 4 decimals (CDragon exports values like 0.10000000149012
     * because of float32 → float64 conversion during BIN parsing) and drop
     * null effect values.
     */
    private function cleanEffects(array $effects): array
    {
        $clean = [];
        foreach ($effects as $key => $value) {
            if ($value === null) {
                continue;
            }
            $clean[$key] = is_float($value) ? round($value, 4) : $value;
        }

        return $clean;
    }
}
