<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * TFT Champion (e.g., Aatrox, Miss Fortune, Aurelion Sol Enhanced).
 *
 * Includes both base champions and synthetic variants created by SetHooks:
 *   - Base champions: base_champion_id IS NULL
 *   - Variants (MF forms, Mecha Enhanced): base_champion_id → base
 *
 * is_playable flag:
 *   - true (default): shown in planner for selection
 *   - false: only for base Miss Fortune (she has no "pure" form; player
 *            must pick one of 3 variants — Conduit/Challenger/Replicator)
 *
 * Two champions with the same base_champion_id are mutually exclusive
 * on the board (replaces the old exclusion_groups table).
 */
class Champion extends Model
{
    use HasFactory;

    protected $fillable = [
        'set_id',
        'api_name',
        'name',
        'cost',
        'slots_used',
        'role',
        'damage_type',
        'role_category',
        'is_playable',
        'hp',
        'armor',
        'magic_resist',
        'attack_damage',
        'attack_speed',
        'mana',
        'start_mana',
        'range',
        'crit_chance',
        'crit_multiplier',
        'ability_desc',
        'ability_name',
        'ability_icon_path',
        'ability_stats',
        'base_champion_id',
        'variant_label',
        'planner_code',
        'icon_path',
    ];

    protected $casts = [
        'cost' => 'integer',
        'slots_used' => 'integer',
        'is_playable' => 'boolean',
        'hp' => 'float',
        'armor' => 'float',
        'magic_resist' => 'float',
        'attack_damage' => 'float',
        'attack_speed' => 'float',
        'mana' => 'float',
        'start_mana' => 'float',
        'range' => 'float',
        'crit_chance' => 'float',
        'crit_multiplier' => 'float',
        'ability_stats' => 'array', // JSONB → [{name, value: [...]}]
        'planner_code' => 'integer',
    ];

    // ── Relations ──────────────────────────────────

    public function set(): BelongsTo
    {
        return $this->belongsTo(Set::class);
    }

    public function traits(): BelongsToMany
    {
        return $this->belongsToMany(
            TftTrait::class,
            'champion_trait',
            'champion_id',
            'trait_id'
        );
    }

    /**
     * If this champion is a variant, points to the base form.
     * E.g., Miss Fortune (Conduit) → Miss Fortune (base).
     */
    public function baseChampion(): BelongsTo
    {
        return $this->belongsTo(self::class, 'base_champion_id');
    }

    /**
     * If this champion is a base, returns all its variants.
     * E.g., Miss Fortune (base) → [Conduit, Challenger, Replicator].
     */
    public function variants(): HasMany
    {
        return $this->hasMany(self::class, 'base_champion_id');
    }

    // ── Scopes ─────────────────────────────────────

    /** Only champions selectable by the player in planner lists */
    public function scopePlayable($query)
    {
        return $query->where('is_playable', true);
    }

    /** Only "base" champions (not variants) */
    public function scopeBase($query)
    {
        return $query->whereNull('base_champion_id');
    }

    /** Only variants of other champions */
    public function scopeVariants($query)
    {
        return $query->whereNotNull('base_champion_id');
    }

    public function scopeByCost($query, int $cost)
    {
        return $query->where('cost', $cost);
    }

    public function scopeForSet($query, int $setId)
    {
        return $query->where('set_id', $setId);
    }

    /**
     * Filter champions by trait api_name (e.g., 'TFT17_Mecha').
     * Uses exists() rather than whereHas for performance on small datasets.
     */
    public function scopeWithTrait($query, string $traitApiName)
    {
        return $query->whereHas(
            'traits',
            fn ($q) => $q->where('api_name', $traitApiName)
        );
    }

    // ── Accessors ──────────────────────────────────

    public function getIsVariantAttribute(): bool
    {
        return $this->base_champion_id !== null;
    }

    public function getIsBaseAttribute(): bool
    {
        return $this->base_champion_id === null;
    }
}
