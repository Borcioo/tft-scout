<?php

namespace App\Services\MetaTft\Dto;

/**
 * A champion's affinity for a specific trait at a specific breakpoint.
 * "Affinity" here = how well this champion performs when that trait is
 * active at that breakpoint. Populated from the MetaTFT explorer API
 * per champion. Legacy scout uses top 3 affinity matches per champion,
 * capped, to avoid diversity bias.
 */
final readonly class AffinityDto
{
    public function __construct(
        public string $championApiName,
        public string $traitApiName,
        public int $breakpointPosition,
        public float $avgPlace,
        public int $games,
        public float $frequency,
    ) {}
}
