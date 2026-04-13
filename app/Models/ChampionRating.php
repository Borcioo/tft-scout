<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Per-champion aggregate from MetaTFT: avg place, winrate, top4, games, score.
 *
 * Decision #3a → A: FK to champions.id is ALWAYS valid because base champions
 * (even non-playable ones like base Miss Fortune) stay in the champions table.
 * No orphaned ratings.
 */
class ChampionRating extends Model
{
    use HasFactory;

    // updated_at only, no created_at (ratings are overwritten in place)
    public const UPDATED_AT = 'updated_at';

    public const CREATED_AT = null;

    protected $fillable = [
        'champion_id',
        'set_id',
        'patch',
        'avg_place',
        'win_rate',
        'top4_rate',
        'games',
        'score',
    ];

    protected $casts = [
        'avg_place' => 'float',
        'win_rate' => 'float',
        'top4_rate' => 'float',
        'games' => 'integer',
        'score' => 'float',
        'updated_at' => 'datetime',
    ];

    // ── Relations ──────────────────────────────────

    public function champion(): BelongsTo
    {
        return $this->belongsTo(Champion::class);
    }

    public function set(): BelongsTo
    {
        return $this->belongsTo(Set::class);
    }

    // ── Scopes ─────────────────────────────────────

    public function scopeForSet($query, int $setId)
    {
        return $query->where('set_id', $setId);
    }

    /**
     * Top N champions by score. Joins against champions to filter playable.
     */
    public function scopeTopByScore($query, int $limit = 10)
    {
        return $query->orderByDesc('score')->limit($limit);
    }

    // ── Helper ─────────────────────────────────────

    /**
     * Compute S/A/B/C/D tier label from score.
     * Same thresholds as old Node ratings.mapper.js for consistency.
     */
    public function getTierAttribute(): string
    {
        return match (true) {
            $this->score >= 0.75 => 'S',
            $this->score >= 0.63 => 'A',
            $this->score >= 0.53 => 'B',
            $this->score >= 0.43 => 'C',
            default => 'D',
        };
    }
}
