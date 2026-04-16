<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Single-item popularity + performance on a champion.
 * One row per (champion × item). For 3-item builds see ChampionItemSet.
 */
class ChampionItemBuild extends Model
{
    use HasFactory;

    public const UPDATED_AT = 'updated_at';

    public const CREATED_AT = null;

    protected $fillable = [
        'champion_id',
        'item_id',
        'set_id',
        'avg_place',
        'games',
        'frequency',
        'win_rate',
        'top4_rate',
        'place_change',
        'prev_avg_place',
        'tier',
        'synced_at',
    ];

    protected $casts = [
        'avg_place' => 'float',
        'games' => 'integer',
        'frequency' => 'float',
        'win_rate' => 'float',
        'top4_rate' => 'float',
        'place_change' => 'float',
        'prev_avg_place' => 'float',
        'updated_at' => 'datetime',
        'synced_at' => 'datetime',
    ];

    public function champion(): BelongsTo
    {
        return $this->belongsTo(Champion::class);
    }

    public function item(): BelongsTo
    {
        return $this->belongsTo(Item::class);
    }

    public function set(): BelongsTo
    {
        return $this->belongsTo(Set::class);
    }
}
