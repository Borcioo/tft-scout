<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

/**
 * Top-performing comp cluster from MetaTFT (e.g., "8 Mecha + Bard reroll").
 * Champions are normalized via meta_comp_champions pivot.
 * Active traits and top builds stay as JSONB (nested structures).
 */
class MetaComp extends Model
{
    use HasFactory;

    public const UPDATED_AT = 'updated_at';

    public const CREATED_AT = null;

    protected $fillable = [
        'cluster_id',
        'set_id',
        'name',
        'active_traits',
        'levelling',
        'top_builds',
        'avg_place',
        'games',
    ];

    protected $casts = [
        'active_traits' => 'array',  // JSONB: [{trait_id, breakpoint_position, count}]
        'top_builds' => 'array',      // JSONB: [{champion_id, items: [], avg}]
        'avg_place' => 'float',
        'games' => 'integer',
        'updated_at' => 'datetime',
    ];

    public function set(): BelongsTo
    {
        return $this->belongsTo(Set::class);
    }

    public function champions(): BelongsToMany
    {
        return $this->belongsToMany(
            Champion::class,
            'meta_comp_champions',
            'meta_comp_id',
            'champion_id'
        )->withPivot(['star_level', 'is_carry']);
    }

    public function scopeForSet($query, int $setId)
    {
        return $query->where('set_id', $setId);
    }

    /**
     * Best-performing comps (lowest avg_place = better).
     */
    public function scopeTop($query, int $limit = 10)
    {
        return $query->orderBy('avg_place')->limit($limit);
    }
}
