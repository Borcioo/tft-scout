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
        'description',
        'effects',
        'component_1_id',
        'component_2_id',
        'trait_id',
        'icon_path',
    ];

    protected $casts = [
        'effects' => 'array',
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

    public function component1(): BelongsTo
    {
        return $this->belongsTo(Item::class, 'component_1_id');
    }

    public function component2(): BelongsTo
    {
        return $this->belongsTo(Item::class, 'component_2_id');
    }
}
