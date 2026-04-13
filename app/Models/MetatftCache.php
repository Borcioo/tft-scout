<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * Transparent cache for MetaTFT API responses.
 *
 * Not a "domain" model — used internally by future MetaTftCache service.
 * Each row is a cached API response keyed by (endpoint, params_hash) with TTL.
 */
class MetatftCache extends Model
{
    protected $table = 'metatft_cache';

    public $timestamps = false; // manually manages fetched_at

    protected $fillable = [
        'endpoint',
        'params_hash',
        'params',
        'data',
        'fetched_at',
        'ttl_seconds',
    ];

    protected $casts = [
        'params' => 'array',
        'data' => 'array',
        'fetched_at' => 'datetime',
        'ttl_seconds' => 'integer',
    ];

    /**
     * Whether this cache entry is still within its TTL.
     */
    public function isFresh(): bool
    {
        if (! $this->fetched_at) {
            return false;
        }

        return $this->fetched_at->diffInSeconds(now()) < $this->ttl_seconds;
    }

    public function scopeFresh($query)
    {
        return $query->whereRaw("EXTRACT(EPOCH FROM (NOW() - fetched_at)) < ttl_seconds");
    }

    public function scopeStale($query)
    {
        return $query->whereRaw("EXTRACT(EPOCH FROM (NOW() - fetched_at)) >= ttl_seconds");
    }
}
