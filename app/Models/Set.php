<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * TFT Set (e.g., Set 17 "Into the Arcane").
 *
 * Top-level entity that scopes all champions, traits, items, augments and
 * emblems to a specific set. Exactly one set should have is_active = true
 * at any time (current playable set).
 */
class Set extends Model
{
    use HasFactory;

    protected $fillable = [
        'number',
        'name',
        'mutator',
        'is_active',
        'released_at',
        'retired_at',
        'imported_at',
        'cdragon_version',
    ];

    protected $casts = [
        'number' => 'integer',
        'is_active' => 'boolean',
        'released_at' => 'date',
        'retired_at' => 'date',
        'imported_at' => 'datetime',
    ];

    // ── Relations ──────────────────────────────────

    public function champions(): HasMany
    {
        return $this->hasMany(Champion::class);
    }

    public function traits(): HasMany
    {
        return $this->hasMany(TftTrait::class);
    }

    public function items(): HasMany
    {
        return $this->hasMany(Item::class);
    }

    public function augments(): HasMany
    {
        return $this->hasMany(Augment::class);
    }

    public function emblems(): HasMany
    {
        return $this->hasMany(Emblem::class);
    }

    // ── Scopes ─────────────────────────────────────

    public function scopeActive($query)
    {
        return $query->where('is_active', true);
    }
}
