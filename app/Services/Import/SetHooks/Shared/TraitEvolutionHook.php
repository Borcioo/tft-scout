<?php

namespace App\Services\Import\SetHooks\Shared;

use App\Models\Champion;
use App\Models\Set;
use App\Models\TftTrait;
use App\Services\Import\Contracts\PostImportHook;
use App\Support\SetProfile;
use Illuminate\Support\Str;

/**
 * Champions that permanently gain a trait of the player's choice during a
 * game — Set 18 Kha'Zix evolves into Executioner, Rapidfire, Ravager or
 * Spellweaver after enough Rival takedowns. Only the trait description
 * states it, so the choices come from config/tft.php `sets.{N}.evolutions`.
 *
 * One form per choice, "Kha'Zix (Ravager)": a copy of the base with the
 * extra trait, linked through base_champion_id so the scout's exclusion
 * group allows one Kha'Zix per board. The base stays playable — fielding
 * him unevolved is legal — and keeps the MetaTFT ratings every form is
 * scored by (MetaTFT knows only the base id).
 */
class TraitEvolutionHook implements PostImportHook
{
    public function name(): string
    {
        return 'TraitEvolution';
    }

    public function run(Set $set): void
    {
        foreach (SetProfile::for($set->number)->evolutions as $baseApiName => $traitApiNames) {
            $base = Champion::query()
                ->where('set_id', $set->id)
                ->where('api_name', $baseApiName)
                ->whereNull('base_champion_id')
                ->first();

            if ($base === null) {
                continue;
            }

            $traits = TftTrait::query()
                ->where('set_id', $set->id)
                ->whereIn('api_name', $traitApiNames)
                ->get();

            foreach ($traits as $trait) {
                $this->createForm($base, $trait);
            }
        }
    }

    private function createForm(Champion $base, TftTrait $trait): void
    {
        $form = $base->replicate();
        $form->fill([
            'api_name' => $base->api_name.'_'.Str::studly($trait->name),
            'name' => "{$base->name} ({$trait->name})",
            'base_champion_id' => $base->id,
            'variant_label' => Str::slug($trait->name),
        ]);
        $form->save();

        $traits = $base->traits()->get()
            ->mapWithKeys(fn (TftTrait $t) => [$t->id => ['amount' => $t->pivot->amount ?? 1]])
            ->all();
        $traits[$trait->id] ??= ['amount' => 1];

        $form->traits()->sync($traits);
    }
}
