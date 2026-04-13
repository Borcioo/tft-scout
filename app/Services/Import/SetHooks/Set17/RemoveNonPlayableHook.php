<?php

namespace App\Services\Import\SetHooks\Set17;

use App\Models\Champion;
use App\Models\Set;
use App\Services\Import\Contracts\PostImportHook;

/**
 * Removes non-playable "fake" units that CDragon exports but aren't
 * real champions you can field. Examples:
 *   - TFT17_DarkStar_FakeUnit: Mini Black Hole (Dark Star trait summon)
 *
 * Add new fake units here as they're discovered via import testing.
 */
class RemoveNonPlayableHook implements PostImportHook
{
    private const FAKE_UNIT_API_NAMES = [
        'TFT17_DarkStar_FakeUnit',
    ];

    public function name(): string
    {
        return 'RemoveNonPlayable';
    }

    public function run(Set $set): void
    {
        Champion::query()
            ->where('set_id', $set->id)
            ->whereIn('api_name', self::FAKE_UNIT_API_NAMES)
            ->delete();
    }
}
