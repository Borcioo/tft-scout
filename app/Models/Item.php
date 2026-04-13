<?php

namespace App\Models;

use App\Casts\PostgresArray;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * TFT Item (Bloodthirster, Infinity Edge, Radiant items, etc.).
 *
 * Scope narrowed from old Node DB: only real items, no augments, no emblems,
 * no historical cruft from previous sets. See type column for subcategory:
 *   - "base"       → cross-set TFT_Item_* (Bloodthirster, IE, etc.)
 *   - "craftable"  → set-specific 2-component combines
 *   - "radiant"    → radiant-upgraded versions
 *   - "support"    → support items
 *   - "artifact"   → artifact items
 *
 * tags column is Postgres text[] — uses custom PostgresArray cast because
 * Laravel's built-in 'array' cast only handles JSON.
 */
class Item extends Model
{
    use HasFactory;

    protected $fillable = [
        'set_id',
        'api_name',
        'name',
        'description',
        'type',
        'tier',
        'component_1_id',
        'component_2_id',
        'radiant_parent_id',
        'effects',
        'tags',
        'icon_path',
    ];

    protected $casts = [
        'effects' => 'array',              // JSONB
        'tags' => PostgresArray::class,    // text[]
    ];

    // ── Relations ──────────────────────────────────

    public function set(): BelongsTo
    {
        return $this->belongsTo(Set::class);
    }

    public function component1(): BelongsTo
    {
        return $this->belongsTo(self::class, 'component_1_id');
    }

    public function component2(): BelongsTo
    {
        return $this->belongsTo(self::class, 'component_2_id');
    }

    /**
     * The base completed item that this radiant upgrades. Non-radiant
     * items have `radiant_parent_id = null` and their `radiantVariant`
     * reverse relation points to the radiant that upgrades them.
     */
    public function radiantParent(): BelongsTo
    {
        return $this->belongsTo(self::class, 'radiant_parent_id');
    }

    /** The radiant variant of this base item (if one exists). */
    public function radiantVariant()
    {
        return $this->hasOne(self::class, 'radiant_parent_id');
    }

    /** Items that use this item as component 1 in their recipe */
    public function usedAsComponent1(): HasMany
    {
        return $this->hasMany(self::class, 'component_1_id');
    }

    /** Items that use this item as component 2 in their recipe */
    public function usedAsComponent2(): HasMany
    {
        return $this->hasMany(self::class, 'component_2_id');
    }

    // ── Scopes ─────────────────────────────────────

    public function scopeCraftable($query)
    {
        return $query->whereNotNull('component_1_id')
            ->whereNotNull('component_2_id');
    }

    public function scopeBase($query)
    {
        return $query->where('type', 'base');
    }

    public function scopeOfType($query, string $type)
    {
        return $query->where('type', $type);
    }

    /**
     * Items that have a specific tag (e.g., 'AttackDamage').
     * Uses Postgres array contains operator via raw where.
     */
    public function scopeWithTag($query, string $tag)
    {
        return $query->whereRaw('? = ANY(tags)', [$tag]);
    }
}
