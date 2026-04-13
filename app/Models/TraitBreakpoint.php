<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Activation threshold for a trait (e.g., Vanguard 2/4/6/8 unit tiers).
 *
 * Each breakpoint represents one "step" in a trait's scaling:
 *   position 1 → min 2 units → Bronze style
 *   position 2 → min 4 units → Silver style
 *   etc.
 *
 * effects JSONB holds game variables per breakpoint (damage, heal, shield).
 * Some keys from CDragon are hash-obfuscated translation keys ({fefec6fb})
 * and are filtered out during import.
 */
class TraitBreakpoint extends Model
{
    // No timestamps — breakpoints are overwritten on CDragon re-import
    public $timestamps = false;

    protected $fillable = [
        'trait_id',
        'position',
        'min_units',
        'max_units',
        'style_id',
        'effects',
    ];

    protected $casts = [
        'position' => 'integer',
        'min_units' => 'integer',
        'max_units' => 'integer',
        'style_id' => 'integer',
        'effects' => 'array', // JSONB → associative array
    ];

    // ── Relations ──────────────────────────────────

    public function trait(): BelongsTo
    {
        return $this->belongsTo(TftTrait::class, 'trait_id');
    }

    public function style(): BelongsTo
    {
        return $this->belongsTo(TraitStyle::class, 'style_id');
    }
}
