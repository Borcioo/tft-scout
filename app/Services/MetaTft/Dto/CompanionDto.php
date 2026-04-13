<?php

namespace App\Services\MetaTft\Dto;

/**
 * Champion-pair co-occurrence in real games. Both champions played on
 * the same board → affinityScore derived from avg_place. Legacy scout
 * uses these for phase 5 (companion-seeded) and as "hidden edges" in
 * the synergy graph that don't require shared traits.
 */
final readonly class CompanionDto
{
    public function __construct(
        public string $championApiName,
        public string $companionApiName,
        public float $avgPlace,
        public int $games,
        public float $frequency,
    ) {}
}
