<?php

namespace App\Http\Controllers;

use App\Models\Emblem;
use App\Models\Item;
use App\Services\Tft\ItemDescriptionResolver;
use Inertia\Inertia;
use Inertia\Response;

class ItemsController extends Controller
{
    public function __construct(
        private readonly ItemDescriptionResolver $descriptionResolver,
    ) {}

    /**
     * List all items + emblems for the browse page.
     *
     * Items and emblems live in separate tables but the UI presents them
     * together: the craftable tab is split into Items / Emblems /
     * Tactician's sub-sections so the player sees everything that can
     * land on the board grouped logically.
     *
     * Radiants stay in their own `radiant` type — the FE filters tabs by
     * type, so they show up in the dedicated Radiant tab next to Base /
     * Craftable / Artifact / Support / Emblem.
     */
    public function index(): Response
    {
        $items = Item::query()
            ->with(['component1:id,api_name,name', 'component2:id,api_name,name'])
            ->orderBy('type')
            ->orderBy('name')
            ->get()
            ->map(fn (Item $item) => $this->serializeItem($item));

        // Emblems live in their own table (FK to traits) — surface them as
        // synthetic items with `type = "emblem"` so the existing tab/grid
        // pipeline can render them without a parallel data shape. The
        // associated trait name carries through as a label on the card.
        $emblems = Emblem::query()
            ->with([
                'trait:id,api_name,name',
                'component1:id,api_name,name',
                'component2:id,api_name,name',
            ])
            ->orderBy('name')
            ->get()
            ->map(fn (Emblem $emblem) => $this->serializeEmblem($emblem));

        return Inertia::render('Items/Index', [
            'items' => $items->concat($emblems)->values(),
        ]);
    }

    private function serializeItem(Item $item): array
    {
        return [
            'id' => $item->id,
            'api_name' => $item->api_name,
            'name' => $item->name,
            // Render the CDragon template against this item's own effect
            // values so the frontend receives fully-substituted text
            // ("+35% Crit Damage" instead of "@CritDamage*100@%").
            'description' => $this->descriptionResolver->resolve(
                $item->description,
                $item->effects ?? [],
            ),
            'type' => $item->type,
            'tier' => $item->tier,
            'effects' => $this->cleanEffects($item->effects ?? []),
            'tags' => $item->tags ?? [],
            'component_1' => $item->component1 ? [
                'api_name' => $item->component1->api_name,
                'name' => $item->component1->name,
            ] : null,
            'component_2' => $item->component2 ? [
                'api_name' => $item->component2->api_name,
                'name' => $item->component2->name,
            ] : null,
            'trait' => null,
        ];
    }

    /**
     * Shape an Emblem the same way as an item so the FE treats it
     * uniformly. Spatula + the trait's reagent is the implicit recipe;
     * we don't ship explicit components because Riot doesn't expose
     * them in the Emblem item record.
     */
    private function serializeEmblem(Emblem $emblem): array
    {
        return [
            'id' => 'emblem-'.$emblem->id,
            'api_name' => $emblem->api_name,
            'name' => $emblem->name,
            // Run the emblem template through the same resolver as items
            // so trait-gated bonuses (DRX N.O.V.A. Strike) and stat
            // placeholders (`@PercentHPAttack*100@%`) render as text
            // instead of leaking placeholders into the UI.
            'description' => $this->descriptionResolver->resolve(
                $emblem->description,
                $emblem->effects ?? [],
            ),
            'type' => 'emblem',
            'tier' => null,
            'effects' => $this->cleanEffects($emblem->effects ?? []),
            'tags' => [],
            'component_1' => $emblem->component1 ? [
                'api_name' => $emblem->component1->api_name,
                'name' => $emblem->component1->name,
            ] : null,
            'component_2' => $emblem->component2 ? [
                'api_name' => $emblem->component2->api_name,
                'name' => $emblem->component2->name,
            ] : null,
            'trait' => $emblem->trait ? [
                'api_name' => $emblem->trait->api_name,
                'name' => $emblem->trait->name,
            ] : null,
        ];
    }

    /**
     * Drop unresolved CDragon hash keys (e.g. "{b9c681e9}") — the field
     * name wasn't matched by the description placeholder reverse-lookup,
     * so we can't render a meaningful label. Round floats and drop nulls,
     * same rationale as TraitsController.
     */
    private function cleanEffects(array $effects): array
    {
        $clean = [];
        foreach ($effects as $key => $value) {
            if ($value === null || str_starts_with((string) $key, '{')) {
                continue;
            }
            $clean[$key] = is_float($value) ? round($value, 4) : $value;
        }

        return $clean;
    }
}
