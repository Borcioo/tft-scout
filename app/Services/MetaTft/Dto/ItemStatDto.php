<?php

namespace App\Services\MetaTft\Dto;

/**
 * A single-item performance row for a champion from MetaTFT explorer API.
 *
 * `frequency` is games-with-item / champion-total-games. Computed by the
 * client using the champion's /total denominator.
 */
final readonly class ItemStatDto
{
    public function __construct(
        public string $championApiName,
        public string $itemApiName,
        public float $avgPlace,
        public float $winRate,
        public float $top4Rate,
        public int $games,
        public float $frequency,
    ) {}
}
