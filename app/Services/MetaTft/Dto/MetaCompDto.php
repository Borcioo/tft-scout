<?php

namespace App\Services\MetaTft\Dto;

/**
 * A known meta composition — list of champions + their aggregate
 * performance. Legacy scout phase 6 seeds from these. The `champions`
 * array holds CDragon api_names so the consumer can FK-link via a
 * single lookup map. `id` is the MetaTFT-provided stable identifier.
 */
final readonly class MetaCompDto
{
    /**
     * @param  list<string>  $championApiNames
     * @param  list<string>  $traitApiNames
     */
    public function __construct(
        public string $id,
        public string $name,
        public array $championApiNames,
        public array $traitApiNames,
        public float $avgPlace,
        public int $games,
        public int $level,
    ) {}
}
