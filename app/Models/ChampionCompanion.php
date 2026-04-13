<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * How often champion X is played together with champion Y.
 * Protected by DB-level CHECK constraint: champion_id != companion_champion_id.
 */
class ChampionCompanion extends Model
{
    use HasFactory;

    public const UPDATED_AT = 'updated_at';

    public const CREATED_AT = null;

    protected $fillable = [
        'champion_id',
        'companion_champion_id',
        'set_id',
        'avg_place',
        'games',
        'frequency',
    ];

    protected $casts = [
        'avg_place' => 'float',
        'games' => 'integer',
        'frequency' => 'float',
        'updated_at' => 'datetime',
    ];

    public function champion(): BelongsTo
    {
        return $this->belongsTo(Champion::class);
    }

    public function companion(): BelongsTo
    {
        return $this->belongsTo(Champion::class, 'companion_champion_id');
    }

    public function set(): BelongsTo
    {
        return $this->belongsTo(Set::class);
    }
}
