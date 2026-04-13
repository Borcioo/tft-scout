<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * TFT Augment (chosen at stages 2-1, 3-2, 4-2).
 *
 * Tiers:
 *   - silver    → weakest, offered early
 *   - gold      → mid-tier
 *   - prismatic → strongest, rare
 *   - hero      → champion-specific (hero augments)
 *
 * Trait-gated augments (e.g., "Mecha Determined") have associated_trait_id
 * pointing to the required trait.
 */
class Augment extends Model
{
    use HasFactory;

    protected $fillable = [
        'set_id',
        'api_name',
        'name',
        'description',
        'tier',
        'effects',
        'associated_trait_id',
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

    public function associatedTrait(): BelongsTo
    {
        return $this->belongsTo(TftTrait::class, 'associated_trait_id');
    }

    // ── Scopes ─────────────────────────────────────

    public function scopeOfTier($query, string $tier)
    {
        return $query->where('tier', $tier);
    }

    public function scopeSilver($query)
    {
        return $query->where('tier', 'silver');
    }

    public function scopeGold($query)
    {
        return $query->where('tier', 'gold');
    }

    public function scopePrismatic($query)
    {
        return $query->where('tier', 'prismatic');
    }

    public function scopeHero($query)
    {
        return $query->where('tier', 'hero');
    }

    public function scopeTraitGated($query)
    {
        return $query->whereNotNull('associated_trait_id');
    }
}
