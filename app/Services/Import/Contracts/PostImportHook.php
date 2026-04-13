<?php

namespace App\Services\Import\Contracts;

use App\Models\Set;

/**
 * Set-specific logic that runs after the base CDragon import completes.
 *
 * Why hooks exist: CDragon API does NOT expose game mechanics like variant
 * champions (Miss Fortune's 3 forms) or Mecha Enhanced pairings. Those are
 * runtime game logic encoded in the TFT engine, not in exported data.
 * Each set brings new mechanics → each set gets its own hook classes in
 * app/Services/Import/SetHooks/Set{N}/.
 *
 * Hooks run inside the same transaction as the base import, so any throw
 * rolls back the entire import.
 */
interface PostImportHook
{
    /**
     * Human-readable name for logging progress.
     */
    public function name(): string;

    /**
     * Apply the hook's mutations to the imported set.
     * All changes should be made via Eloquent models (not raw SQL)
     * so that model events and observers fire correctly.
     */
    public function run(Set $set): void;
}
