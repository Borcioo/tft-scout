<?php

namespace App\Http\Controllers;

use App\Models\TftTrait;
use Inertia\Inertia;
use Inertia\Response;

class TraitsController extends Controller
{
    /**
     * List public traits with breakpoints and champions.
     *
     * Only `category = public` is shown — hidden traits (HPTank, ResistTank)
     * exist for MetaTFT grouping only, unique traits are per-champion and
     * surfaced on champion detail pages instead.
     *
     * Full dataset is small (<30 public traits), so the frontend handles
     * search/filter client-side.
     */
    public function index(): Response
    {
        $traits = TftTrait::query()
            ->public()
            ->with([
                'breakpoints.style',
                'champions' => fn ($q) => $q
                    ->whereNull('base_champion_id')
                    ->orderBy('cost')
                    ->orderBy('name'),
            ])
            ->orderBy('name')
            ->get()
            ->map(fn (TftTrait $trait) => [
                'id' => $trait->id,
                'api_name' => $trait->api_name,
                'name' => $trait->name,
                'description' => $trait->description,
                'breakpoints' => $trait->breakpoints->map(fn ($b) => [
                    'position' => $b->position,
                    'min_units' => $b->min_units,
                    // 25000 is the Riot sentinel for "unbounded top tier"
                    'max_units' => $b->max_units >= 25000 ? null : $b->max_units,
                    'style' => $b->style?->name,
                    'effects' => $this->cleanEffects($b->effects ?? []),
                ])->all(),
                'champions' => $trait->champions->map(fn ($c) => [
                    'api_name' => $c->api_name,
                    'name' => $c->name,
                    'cost' => $c->cost,
                ])->all(),
            ]);

        return Inertia::render('Traits/Index', [
            'traits' => $traits,
        ]);
    }

    /**
     * Round floats to 4 decimals (CDragon exports values like 0.10000000149012
     * because of float32 → float64 conversion during BIN parsing) and drop
     * null effect values. Hash keys like "{b9c681e9}" stay — they may carry
     * meaningful numbers even if the field name wasn't resolved.
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
