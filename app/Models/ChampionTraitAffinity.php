<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * How well champion X performs when trait Y is active at breakpoint N.
 * Used by scout to prioritize champion-trait pairings in comp building.
 */
class ChampionTraitAffinity extends Model
{
    use HasFactory;

    protected $table = 'champion_trait_affinity';

    public const UPDATED_AT = 'updated_at';

    public const CREATED_AT = null;

    protected $fillable = [
        'champion_id',
        'trait_id',
        'breakpoint_position',
        'set_id',
        'avg_place',
        'games',
        'frequency',
    ];

    protected $casts = [
        'breakpoint_position' => 'integer',
        'avg_place' => 'float',
        'games' => 'integer',
        'frequency' => 'float',
        'updated_at' => 'datetime',
    ];

    public function champion(): BelongsTo
    {
        return $this->belongsTo(Champion::class);
    }

    public function trait(): BelongsTo
    {
        return $this->belongsTo(TftTrait::class, 'trait_id');
    }

    public function set(): BelongsTo
    {
        return $this->belongsTo(Set::class);
    }
}
