<?php

namespace App\Services\MetaTft\Dto;

/**
 * One trait-at-breakpoint aggregate. `breakpointPosition` is 1-based
 * within the trait's breakpoint list (1 = Bronze/first tier, 2 =
 * Silver, etc.) — same convention as `trait_breakpoints.position`.
 */
final readonly class TraitRatingDto
{
    public function __construct(
        public string $traitApiName,
        public int $breakpointPosition,
        public float $avgPlace,
        public float $winRate,
        public float $top4Rate,
        public int $games,
    ) {}

    public function score(): float
    {
        $raw = (6.0 - $this->avgPlace) / 3.0;

        return max(0.0, min(1.0, $raw));
    }
}
