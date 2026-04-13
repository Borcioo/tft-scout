<?php

namespace App\Models;

use App\Casts\PostgresArray;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * 3-item build combinations on a champion (e.g., BT + Titans + Runaan).
 * The combination is an atomic statistical unit — item_api_names stays as
 * Postgres text[] because we care about the specific set as a whole,
 * not individual items.
 */
class ChampionItemSet extends Model
{
    use HasFactory;

    public const UPDATED_AT = 'updated_at';

    public const CREATED_AT = null;

    protected $fillable = [
        'champion_id',
        'item_api_names',
        'set_id',
        'avg_place',
        'games',
    ];

    protected $casts = [
        'item_api_names' => PostgresArray::class,
        'avg_place' => 'float',
        'games' => 'integer',
        'updated_at' => 'datetime',
    ];

    public function champion(): BelongsTo
    {
        return $this->belongsTo(Champion::class);
    }

    public function set(): BelongsTo
    {
        return $this->belongsTo(Set::class);
    }

    /**
     * Find item sets containing a specific item api_name.
     * Uses GIN index via Postgres ANY operator.
     */
    public function scopeContainingItem($query, string $itemApiName)
    {
        return $query->whereRaw('? = ANY(item_api_names)', [$itemApiName]);
    }
}
