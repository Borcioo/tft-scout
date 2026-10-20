<?php

namespace App\Services\Import\SetHooks\Shared;

use App\Models\Champion;
use App\Models\Set;
use App\Services\Import\Contracts\PostImportHook;
use App\Support\SetProfile;

/**
 * Removes non-playable "fake" units that CDragon exports but aren't
 * real champions you can field, e.g. Set 17's TFT17_DarkStar_FakeUnit
 * (Mini Black Hole, a Dark Star trait summon).
 *
 * The list lives in config/tft.php `sets.{N}.fake_units` — add new fake
 * units there as they're discovered via import testing.
 */
class RemoveNonPlayableHook implements PostImportHook
{
    public function name(): string
    {
        return 'RemoveNonPlayable';
    }

    public function run(Set $set): void
    {
        $fakeUnits = SetProfile::for($set->number)->fakeUnits;
        if ($fakeUnits === []) {
            return;
        }

        Champion::query()
            ->where('set_id', $set->id)
            ->whereIn('api_name', $fakeUnits)
            ->delete();
    }
}
