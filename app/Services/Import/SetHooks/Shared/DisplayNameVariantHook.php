<?php

namespace App\Services\Import\SetHooks\Shared;

use App\Models\Champion;
use App\Models\Set;
use App\Services\Import\Contracts\PostImportHook;
use Illuminate\Support\Str;

/**
 * Link champions that CDragon exports as separate records of one shop
 * unit — named "{Base} ({Form})" next to a "{Base}" record.
 *
 * Set 18 Lux (Avatar): `DA_Lux18_Base` "Lux" plus nine element forms
 * ("Lux (Coven)", "Lux (Lunar)", ...). Buying one turns every other Lux
 * in your shop into the same element, so only one form can be fielded
 * — same shape as Set 17 Miss Fortune's modes:
 *
 *   - each form becomes a variant (base_champion_id → base,
 *     variant_label = slug of the form name) and stays playable
 *   - the base becomes non-playable (it is the "unchosen" record; its
 *     only trait is Avatar) but keeps planner code and MetaTFT ratings,
 *     which MetaTFT reports under the base id for every form
 *   - forms inherit the base planner code (the Team Planner only knows
 *     the base)
 *
 * The exclusion group then falls out of base_champion_id as usual.
 */
class DisplayNameVariantHook implements PostImportHook
{
    public function name(): string
    {
        return 'DisplayNameVariant';
    }

    public function run(Set $set): void
    {
        $champions = Champion::query()
            ->where('set_id', $set->id)
            ->whereNull('base_champion_id')
            ->get();

        $baseByName = [];
        foreach ($champions as $champion) {
            if (! preg_match('/\(.+\)$/', $champion->name)) {
                $baseByName[$champion->name] ??= $champion;
            }
        }

        $demoted = [];
        foreach ($champions as $champion) {
            if (! preg_match('/^(.+?)\s*\((.+)\)$/', $champion->name, $m)) {
                continue;
            }

            $base = $baseByName[$m[1]] ?? null;
            if ($base === null || $base->cost !== $champion->cost) {
                continue;
            }

            $champion->update([
                'base_champion_id' => $base->id,
                'variant_label' => Str::slug($m[2]),
                'planner_code' => $champion->planner_code ?? $base->planner_code,
                // Form bins carry no SpellObject (the spell lives on the
                // base character), so the enrich hook leaves them with
                // en_us.json's empty variables. The template placeholders
                // are shared with the base spell — borrow its stats.
                'ability_stats' => empty($champion->ability_stats) ? $base->ability_stats : $champion->ability_stats,
            ]);

            $demoted[$base->id] = $base;
        }

        foreach ($demoted as $base) {
            $base->update(['is_playable' => false]);
        }
    }
}
