<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Audit trail for data imports (CDragon, MetaTFT).
 *
 * Populated by importers at start/end of each run. Enables debugging
 * "why does this champion have weird stats" questions by letting you
 * inspect when the data was last refreshed and from what source.
 */
class DataImport extends Model
{
    use HasFactory;

    public $timestamps = false; // managed via started_at / completed_at

    protected $fillable = [
        'source',
        'endpoint',
        'set_id',
        'started_at',
        'completed_at',
        'status',
        'records_affected',
        'error_message',
        'metadata',
    ];

    protected $casts = [
        'started_at' => 'datetime',
        'completed_at' => 'datetime',
        'records_affected' => 'integer',
        'metadata' => 'array',
    ];

    public function set(): BelongsTo
    {
        return $this->belongsTo(Set::class);
    }

    // ── Scopes ─────────────────────────────────────

    public function scopeSuccessful($query)
    {
        return $query->where('status', 'success');
    }

    public function scopeFailed($query)
    {
        return $query->where('status', 'failed');
    }

    public function scopeRunning($query)
    {
        return $query->where('status', 'running');
    }

    public function scopeFromSource($query, string $source)
    {
        return $query->where('source', $source);
    }

    // ── Helpers ────────────────────────────────────

    /**
     * Compute duration in seconds, or null if not completed yet.
     */
    public function getDurationSecondsAttribute(): ?float
    {
        if (! $this->completed_at) {
            return null;
        }

        return $this->completed_at->diffInMilliseconds($this->started_at) / 1000;
    }

    /**
     * Mark as successfully completed.
     */
    public function markSuccess(int $recordsAffected = 0, array $metadata = []): void
    {
        $this->update([
            'status' => 'success',
            'completed_at' => now(),
            'records_affected' => $recordsAffected,
            'metadata' => array_merge($this->metadata ?? [], $metadata),
        ]);
    }

    /**
     * Mark as failed with error message.
     */
    public function markFailed(string $error): void
    {
        $this->update([
            'status' => 'failed',
            'completed_at' => now(),
            'error_message' => $error,
        ]);
    }
}
