<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A single MetaTFT sync run — one row per `metatft:sync` invocation,
 * records how many rows were upserted per category and whether the
 * run succeeded. ScoutContextBuilder reads the most recent `ok` row to
 * decide whether data is stale (>24h) and a background refresh should
 * be kicked off.
 */
class MetaSync extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'set_id',
        'synced_at',
        'units_count',
        'traits_count',
        'affinity_count',
        'companions_count',
        'meta_comps_count',
        'status',
        'notes',
        'item_stats_count',
        'item_builds_count',
        'failed_item_champions',
    ];

    protected $casts = [
        'synced_at' => 'datetime',
        'units_count' => 'integer',
        'traits_count' => 'integer',
        'affinity_count' => 'integer',
        'companions_count' => 'integer',
        'meta_comps_count' => 'integer',
    ];

    public function set(): BelongsTo
    {
        return $this->belongsTo(Set::class);
    }
}
