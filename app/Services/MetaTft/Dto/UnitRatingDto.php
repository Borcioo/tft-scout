<?php

namespace App\Services\MetaTft\Dto;

/**
 * One champion's aggregate performance across MetaTFT's sample games.
 * `apiName` is the CDragon identifier (TFT17_Aatrox) — matches our
 * champions.api_name column so MetaTftSync can FK-link via a single
 * lookup map.
 *
 * Score is derived the same way the legacy scout did: `(6 - avg_place) / 3`
 * clamped to [0, 1]. Avg 1 = 1.66 → clamped 1.0; avg 6 = 0. Lets the
 * algorithm use `score` directly as a 0-1 weight without reaching for
 * avg_place each time.
 */
final readonly class UnitRatingDto
{
    public function __construct(
        public string $apiName,
        public float $avgPlace,
        public float $winRate,
        public float $top4Rate,
        public int $games,
        public ?string $patch,
    ) {}

    public function score(): float
    {
        $raw = (6.0 - $this->avgPlace) / 3.0;

        return max(0.0, min(1.0, $raw));
    }
}
