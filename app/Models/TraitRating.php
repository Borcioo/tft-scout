<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Per-(trait, breakpoint) aggregate from MetaTFT.
 * E.g., "Vanguard at 4 units" is a different rating than "Vanguard at 6".
 */
class TraitRating extends Model
{
    use HasFactory;

    public const UPDATED_AT = 'updated_at';

    public const CREATED_AT = null;

    protected $fillable = [
        'trait_id',
        'breakpoint_position',
        'set_id',
        'avg_place',
        'win_rate',
        'top4_rate',
        'games',
        'score',
    ];

    protected $casts = [
        'breakpoint_position' => 'integer',
        'avg_place' => 'float',
        'win_rate' => 'float',
        'top4_rate' => 'float',
        'games' => 'integer',
        'score' => 'float',
        'updated_at' => 'datetime',
    ];

    public function trait(): BelongsTo
    {
        return $this->belongsTo(TftTrait::class, 'trait_id');
    }

    public function set(): BelongsTo
    {
        return $this->belongsTo(Set::class);
    }

    public function scopeForSet($query, int $setId)
    {
        return $query->where('set_id', $setId);
    }

    public function scopeAtBreakpoint($query, int $position)
    {
        return $query->where('breakpoint_position', $position);
    }
}
