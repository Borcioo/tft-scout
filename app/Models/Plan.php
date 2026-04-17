<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

/**
 * User-saved team composition (planner).
 *
 * Decision #5 → C (hybrid): slots stored as JSONB for MVP. Each slot has:
 *   {x: int, y: int, champion_api_name: string, star_level: int, items: string[], augment?: string}
 *
 * When a real query need emerges (e.g., "show all plans using Aatrox"),
 * Phase 2 migration will split slots into a `plan_slots` relational table.
 */
class Plan extends Model
{
    use HasFactory;

    protected $fillable = [
        'user_id',
        'set_id',
        'name',
        'notes',
        'slots',
        'planner_code',
        'meta',
        'is_public',
        'share_token',
    ];

    protected $casts = [
        'slots' => 'array',
        'meta' => 'array',
        'is_public' => 'boolean',
    ];

    // ── Relations ──────────────────────────────────

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function set(): BelongsTo
    {
        return $this->belongsTo(Set::class);
    }

    // ── Scopes ─────────────────────────────────────

    public function scopePublic($query)
    {
        return $query->where('is_public', true);
    }

    public function scopeForUser($query, int $userId)
    {
        return $query->where('user_id', $userId);
    }

    // ── Helpers ────────────────────────────────────

    /**
     * Generate and persist a share token, enabling public sharing via URL.
     * Idempotent — returns existing token if already set.
     */
    public function enableSharing(): string
    {
        if (! $this->share_token) {
            $this->share_token = Str::random(32);
            $this->is_public = true;
            $this->save();
        }

        return $this->share_token;
    }

    public function disableSharing(): void
    {
        $this->share_token = null;
        $this->is_public = false;
        $this->save();
    }
}
