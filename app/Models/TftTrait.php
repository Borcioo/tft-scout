<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * TFT Trait (e.g., Mecha, Astronaut, Vanguard).
 *
 * NOTE: class named `TftTrait` because `Trait` is a reserved PHP keyword
 * and cannot be used as a class name. Table remains `traits`.
 *
 * category column distinguishes 3 trait types found in real data:
 *   - "public"  → main visible traits shown in UI (Mecha, Astronaut)
 *   - "unique"  → per-champion unique traits (ShenUniqueTrait)
 *   - "hidden"  → MetaTFT-only grouping (HPTank, ResistTank, FlexTrait)
 */
class TftTrait extends Model
{
    use HasFactory;

    protected $table = 'traits';

    protected $fillable = [
        'set_id',
        'api_name',
        'name',
        'description',
        'icon_path',
        'category',
        'is_unique',
    ];

    protected $casts = [
        'is_unique' => 'boolean',
    ];

    // ── Relations ──────────────────────────────────

    public function set(): BelongsTo
    {
        return $this->belongsTo(Set::class);
    }

    public function breakpoints(): HasMany
    {
        return $this->hasMany(TraitBreakpoint::class, 'trait_id')
            ->orderBy('position');
    }

    public function champions(): BelongsToMany
    {
        // Explicit pivot table name required: Laravel would guess "champion_tft_trait"
        // from alphabetical convention, but our pivot is `champion_trait`.
        return $this->belongsToMany(
            Champion::class,
            'champion_trait',
            'trait_id',
            'champion_id'
        );
    }

    public function emblems(): HasMany
    {
        return $this->hasMany(Emblem::class, 'trait_id');
    }

    public function gatedAugments(): HasMany
    {
        return $this->hasMany(Augment::class, 'associated_trait_id');
    }

    // ── Scopes ─────────────────────────────────────

    public function scopePublic($query)
    {
        return $query->where('category', 'public');
    }

    public function scopeUnique($query)
    {
        return $query->where('category', 'unique');
    }

    public function scopeHidden($query)
    {
        return $query->where('category', 'hidden');
    }

    public function scopeForSet($query, int $setId)
    {
        return $query->where('set_id', $setId);
    }
}
