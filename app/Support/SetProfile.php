<?php

namespace App\Support;

/**
 * Per-set naming and mechanic quirks, read from `config/tft.php` `sets`.
 *
 * Up to Set 17 every record was namespaced `TFT{N}_` and the evergreen
 * `TFT_Item_*` pool was shared across sets, so the importer could hard
 * code both. Set 18 broke that: everything lives under `DA_` with the
 * set number embedded anywhere in the id (DA_18_Ahri, DA_Amumu18), and
 * the set ships its own component/completed item records. This class is
 * the single place that knows which shape a set uses.
 *
 * Sets missing from config fall back to the pre-18 conventions.
 */
final class SetProfile
{
    /**
     * @param  list<string>  $prefixes
     * @param  list<string>  $fakeUnits
     * @param  array<string, int>  $slotsByTrait
     * @param  array<string, string>  $metatftUnitAliases
     * @param  list<string>  $fighterTraits
     */
    private function __construct(
        public readonly int $number,
        public readonly array $prefixes,
        public readonly bool $evergreenItems,
        public readonly array $fakeUnits,
        public readonly array $slotsByTrait,
        public readonly array $metatftUnitAliases,
        public readonly array $fighterTraits,
    ) {}

    public static function for(int $setNumber): self
    {
        $cfg = config("tft.sets.{$setNumber}", []);

        return new self(
            number: $setNumber,
            prefixes: array_values($cfg['prefixes'] ?? ["TFT{$setNumber}_"]),
            evergreenItems: (bool) ($cfg['evergreen_items'] ?? true),
            fakeUnits: array_values($cfg['fake_units'] ?? []),
            slotsByTrait: $cfg['slots_by_trait'] ?? [],
            metatftUnitAliases: $cfg['metatft_unit_aliases'] ?? [],
            fighterTraits: array_values($cfg['fighter_traits'] ?? []),
        );
    }

    /** The set configured as current (TFT_SET env). */
    public static function current(): self
    {
        return self::for((int) config('services.tft.set', 18));
    }

    /** True when the api_name sits in one of this set's namespaces. */
    public function owns(string $apiName): bool
    {
        foreach ($this->prefixes as $prefix) {
            if (str_starts_with($apiName, $prefix)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Map a MetaTFT unit id onto the champion api_name we store.
     *
     * Explicit aliases win; otherwise an `_AD`/`_AP` suffixed id whose
     * opposite-suffix sibling is a known champion folds into it (Adaptor
     * forms). Anything else passes through unchanged.
     *
     * @param  array<string, mixed>  $known  champion api_name → anything
     */
    public function canonicalUnit(string $apiName, array $known): string
    {
        if (isset($known[$apiName])) {
            return $apiName;
        }

        $alias = $this->metatftUnitAliases[$apiName] ?? null;
        if ($alias !== null) {
            return $alias;
        }

        if (preg_match('/^(.+)_(AD|AP)$/', $apiName, $m)) {
            $sibling = $m[1].'_'.($m[2] === 'AD' ? 'AP' : 'AD');
            if (isset($known[$sibling])) {
                return $sibling;
            }
        }

        return $apiName;
    }
}
