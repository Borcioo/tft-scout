<?php

namespace App\Http\Controllers;

use App\Models\Item;
use Inertia\Inertia;
use Inertia\Response;

class ItemsController extends Controller
{
    /**
     * List all items with recipe components and effects.
     *
     * The frontend groups by `type` (base / craftable / radiant / artifact /
     * support), so we return one flat list and let React build the tabs.
     * Full dataset is ~227 rows — fine to ship in one Inertia payload.
     */
    public function index(): Response
    {
        $items = Item::query()
            ->with(['component1:id,api_name,name', 'component2:id,api_name,name'])
            ->orderBy('type')
            ->orderBy('name')
            ->get()
            ->map(fn (Item $item) => [
                'id' => $item->id,
                'api_name' => $item->api_name,
                'name' => $item->name,
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
            ]);

        return Inertia::render('Items/Index', [
            'items' => $items,
        ]);
    }

    /**
     * Drop unresolved CDragon hash keys (e.g. "{b9c681e9}") — the field name
     * wasn't found in the hashlist, so we can't render a meaningful label.
     * Round floats and drop nulls, same rationale as TraitsController.
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
