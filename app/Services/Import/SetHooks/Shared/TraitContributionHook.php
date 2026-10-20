<?php

namespace App\Services\Import\SetHooks\Shared;

use App\Models\Champion;
use App\Models\Set;
use App\Models\TftTrait;
use App\Services\Import\Contracts\PostImportHook;
use App\Services\Tft\CharacterBinInspector;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Copy per-trait contribution amounts from the character BINs onto the
 * champion_trait pivot.
 *
 * en_us.json lists a champion's traits by name only, so "Lux (Coven)"
 * looks like any other Coven unit. The BIN's `mLinkedTraits` entries
 * carry an `Amount` field that the game uses for trait counting:
 *
 *   DA_18_Lux_Coven     Coven ×2      ("chosen Trait is counted twice")
 *   DA_18_ElderDragon   Riftbeast ×2  (Apex Predator)
 *
 * Only amounts > 1 are written; the pivot default is 1. Must run before
 * DisplayNameVariantHook — it walks every champion, variants included,
 * while the base-only hooks after that skip linked variants.
 */
class TraitContributionHook implements PostImportHook
{
    public function __construct(
        private readonly CharacterBinInspector $inspector,
    ) {}

    public function name(): string
    {
        return 'TraitContribution';
    }

    public function run(Set $set): void
    {
        $traitIdByApi = TftTrait::query()
            ->where('set_id', $set->id)
            ->pluck('id', 'api_name')
            ->all();

        $champions = Champion::query()
            ->where('set_id', $set->id)
            ->whereNull('base_champion_id')
            ->get();

        foreach ($champions as $champion) {
            try {
                $report = $this->inspector->inspect($champion->api_name);
            } catch (Throwable $e) {
                Log::warning("TraitContributionHook: inspect failed for {$champion->api_name}: ".$e->getMessage());

                continue;
            }

            $attached = $champion->traits()->pluck('traits.id')->flip()->all();

            foreach ($report['main']['linked_traits'] ?? [] as $link) {
                $amount = (int) ($link['amount'] ?? 1);
                $traitId = $traitIdByApi[$link['api_name'] ?? ''] ?? null;

                if ($amount <= 1 || $traitId === null || ! isset($attached[$traitId])) {
                    continue;
                }

                $champion->traits()->updateExistingPivot($traitId, ['amount' => $amount]);
            }
        }
    }
}
