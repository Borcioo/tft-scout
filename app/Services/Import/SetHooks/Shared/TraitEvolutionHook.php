<?php

namespace App\Services\Import\SetHooks\Shared;

use App\Models\Champion;
use App\Models\Set;
use App\Models\TftTrait;
use App\Services\Import\Contracts\PostImportHook;
use App\Support\SetProfile;
use Illuminate\Support\Str;

/**
 * Champions that permanently gain traits of the player's choice during a
 * game — Set 18 Kha'Zix picks Executioner, Rapidfire, Ravager or
 * Spellweaver at each Rival takedown threshold, up to all four. Only the
 * trait description names the choices and the pick count isn't in the
 * data, so both come from config/tft.php `sets.{N}.evolutions`.
 *
 * One form per combination of up to `max` choices, "Kha'Zix (Rapidfire +
 * Ravager)": a copy of the base with the extra traits, linked through
 * base_champion_id so the scout's exclusion group allows one Kha'Zix per
 * board. Pick order doesn't change the traits, so combinations, not
 * permutations. Forms with more than `auto_max` picks are lock_only: the
 * scout fields them only when the player locks one. The base stays playable — fielding him unevolved is
 * legal — and keeps the MetaTFT ratings every form is scored by (MetaTFT
 * knows only the base id).
 */
class TraitEvolutionHook implements PostImportHook
{
    public function name(): string
    {
        return 'TraitEvolution';
    }

    public function run(Set $set): void
    {
        foreach (SetProfile::for($set->number)->evolutions as $baseApiName => $evolution) {
            $base = Champion::query()
                ->where('set_id', $set->id)
                ->where('api_name', $baseApiName)
                ->whereNull('base_champion_id')
                ->first();

            if ($base === null) {
                continue;
            }

            // Config order, so names and api_names stay stable across imports
            $byApi = TftTrait::query()
                ->where('set_id', $set->id)
                ->whereIn('api_name', $evolution['choices'])
                ->get()
                ->keyBy('api_name');
            $choices = array_values(array_filter(array_map(
                fn (string $api) => $byApi[$api] ?? null,
                $evolution['choices'],
            )));

            foreach (self::combinations($choices, $evolution['max']) as $picked) {
                $this->createForm($base, $picked, count($picked) > $evolution['auto_max']);
            }
        }
    }

    /**
     * Every combination of 1..$max items, fewest first, each in input order.
     *
     * @template T
     *
     * @param  list<T>  $items
     * @return list<list<T>>
     */
    public static function combinations(array $items, int $max): array
    {
        $subsets = [[]];
        foreach ($items as $item) {
            foreach ($subsets as $subset) {
                $subsets[] = [...$subset, $item];
            }
        }

        $picked = array_values(array_filter(
            $subsets,
            fn (array $s) => count($s) >= 1 && count($s) <= $max,
        ));
        usort($picked, fn (array $a, array $b) => count($a) <=> count($b));

        return $picked;
    }

    /**
     * @param  list<TftTrait>  $picked
     */
    private function createForm(Champion $base, array $picked, bool $lockOnly): void
    {
        $names = array_map(fn (TftTrait $t) => $t->name, $picked);

        $form = $base->replicate();
        $form->fill([
            'api_name' => $base->api_name.'_'.implode('_', array_map(Str::studly(...), $names)),
            'name' => "{$base->name} (".implode(' + ', $names).')',
            'base_champion_id' => $base->id,
            'variant_label' => implode('-', array_map(Str::slug(...), $names)),
            'lock_only' => $lockOnly,
        ]);
        $form->save();

        $traits = $base->traits()->get()
            ->mapWithKeys(fn (TftTrait $t) => [$t->id => ['amount' => $t->pivot->amount ?? 1]])
            ->all();
        foreach ($picked as $trait) {
            $traits[$trait->id] ??= ['amount' => 1];
        }

        $form->traits()->sync($traits);
    }
}
