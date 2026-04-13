<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Trait activation style (Bronze / Silver / Gold / Prismatic / Unique).
 *
 * Lookup table with fixed CDragon-assigned IDs (1, 3, 4, 5, 6).
 * Not editable via app — seeded in migration, never updated at runtime.
 */
class TraitStyle extends Model
{
    protected $table = 'trait_styles';

    // Custom PK type (smallint, not auto-increment)
    protected $primaryKey = 'id';

    public $incrementing = false;

    protected $keyType = 'int';

    // No created_at/updated_at on this lookup table
    public $timestamps = false;

    protected $fillable = [
        'id',
        'name',
        'fallback_score',
        'color',
    ];

    protected $casts = [
        'fallback_score' => 'float',
    ];

    public function breakpoints(): HasMany
    {
        return $this->hasMany(TraitBreakpoint::class, 'style_id');
    }
}
