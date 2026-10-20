<?php

namespace App\Services\Import\SetHooks\Shared;

use App\Models\Champion;
use App\Models\Set;
use App\Services\Import\Contracts\PostImportHook;
use App\Support\SetProfile;

/**
 * Champions whose trait makes them occupy more than one team slot —
 * Set 18 Apex Predator ("Elder Dragon takes up 2 team slots"). The slot
 * count isn't exposed anywhere in CDragon data, so it comes from
 * config/tft.php `sets.{N}.slots_by_trait`.
 */
class TraitSlotOverrideHook implements PostImportHook
{
    public function name(): string
    {
        return 'TraitSlotOverride';
    }

    public function run(Set $set): void
    {
        foreach (SetProfile::for($set->number)->slotsByTrait as $traitApiName => $slots) {
            Champion::query()
                ->where('set_id', $set->id)
                ->whereHas('traits', fn ($q) => $q->where('traits.api_name', $traitApiName))
                ->update(['slots_used' => $slots]);
        }
    }
}
