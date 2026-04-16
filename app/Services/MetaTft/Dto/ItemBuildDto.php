<?php

namespace App\Services\MetaTft\Dto;

/**
 * A 1-3 item build combination performance row for a champion.
 *
 * `itemApiNames` is the list as returned by MetaTFT (may be 1, 2 or 3
 * entries — ThiefsGloves / emblems show as single-item builds under
 * `/unit_builds`). Order mirrors MetaTFT's response; the sync sorts
 * before upsert for dedup.
 */
final readonly class ItemBuildDto
{
    /**
     * @param  list<string>  $itemApiNames
     */
    public function __construct(
        public string $championApiName,
        public array $itemApiNames,
        public float $avgPlace,
        public float $winRate,
        public float $top4Rate,
        public int $games,
        public float $frequency,
    ) {}
}
