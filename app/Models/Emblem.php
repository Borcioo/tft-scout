<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Trait Emblem (Spatula-crafted item that grants a trait to equipping champion).
 *
 * Each emblem is 1:1 with a trait — e.g., Mecha Emblem adds Mecha trait
 * to the champion equipped with it. Separated from items table because
 * emblems have different semantics (they dynamically add traits at runtime).
 */
class Emblem extends Model
{
    use HasFactory;

    protected $fillable = [
        'set_id',
        'api_name',
        'name',
        'trait_id',
        'icon_path',
    ];

    // ── Relations ──────────────────────────────────

    public function set(): BelongsTo
    {
        return $this->belongsTo(Set::class);
    }

    public function trait(): BelongsTo
    {
        return $this->belongsTo(TftTrait::class, 'trait_id');
    }
}
