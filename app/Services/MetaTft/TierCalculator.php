<?php

namespace App\Services\MetaTft;

/**
 * Tier calculator for MetaTFT-style S/A/B/C/D ratings on items and builds.
 *
 * MetaTFT's server computes tiers internally and ships them as strings in
 * API responses — we don't see their formula. Our heuristic uses simple
 * avg_place thresholds plus a minimum sample gate to match observed
 * behavior (e.g. Jinx build with 3.10 avg → S, 11-sample row stays tier-less).
 *
 * Thresholds live in `config/tft.php` under `metatft.tier_thresholds`.
 */
class TierCalculator
{
    /**
     * Compute a tier letter or null when the sample is too small.
     *
     * Thresholds are INCLUSIVE upper bounds. Ordering from best to worst:
     *   SS (≤3.5) → S (≤4.0) → A (≤4.3) → B (≤4.6) → C (≤5.0) → D (>5.0)
     */
    public static function compute(float $avgPlace, int $games): ?string
    {
        $gate = (int) config('tft.metatft.min_games_gate', 15);
        if ($games < $gate) {
            return null;
        }

        $thresholds = config('tft.metatft.tier_thresholds', [
            'SS' => 3.5,
            'S' => 4.0,
            'A' => 4.3,
            'B' => 4.6,
            'C' => 5.0,
        ]);

        foreach ($thresholds as $tier => $upperBound) {
            if ($avgPlace <= $upperBound) {
                return $tier;
            }
        }

        return 'D';
    }
}
