<?php

namespace App\Services\Tft;

/**
 * Empirically verified FNV-1a 32 hashes for fields on TFTCharacterRecord
 * (and shared with LoL CharacterRecord). The plaintext field names are
 * NOT publicly known — community has not resolved them and CDTB itself
 * hardcodes these as magic numbers in cdtb/tftdata.py.
 *
 * Each field value is wrapped in a `{ce9b917b}` type object with a single
 * `{b35aa769}` (= `baseValue`) inner key holding the float. See
 * StatHashResolver::extractWrappedValue() for unwrapping logic.
 *
 * Verified against LoL Ahri bin (`game/data/characters/ahri/ahri.bin.json`)
 * whose stat values match her documented LoL base stats — same hashes
 * appear in both LoL and TFT character records, so the mapping is stable
 * across games. Range is stored in "units" (÷180 = hex count in TFT).
 *
 * Full research: docs/research/tft-hash-discovery.md
 */
final class TftStatHashRegistry
{
    /**
     * FNV-1a 32 hash (as int) => our semantic name (DB column style).
     *
     * Order matches CDTB tftdata.py for easy cross-reference. Pogrubione
     * entries in the research doc are those CDTB actually uses for en_us.json
     * generation; the rest are empirical extras from Ahri mapping.
     */
    public const MAP = [
        // Core stats — used by CDTB when producing cdragon/tft/en_us.json
        0x8662CF12 => 'hp',
        0x4AF40DC3 => 'attack_damage',
        0xEA6100D5 => 'armor',
        0x33C0BF27 => 'magic_resist',
        0x836CC82A => 'attack_speed_ratio', // ← this is the "attackSpeed" CDTB reads
        0x7BD4B298 => 'attack_range_units', // ÷ 180 = hexes

        // Per-level growth (LoL concept; TFT uses tier scaling instead but
        // the fields still exist on TFTCharacterRecord and may carry values)
        0x4D37AF28 => 'hp_per_level',
        0xE2B5D80D => 'ad_per_level',
        0x18956A21 => 'armor_per_level',
        0x01262A25 => 'mr_per_level',
        0xB9F2B365 => 'attack_speed_per_level',

        // Regen and misc
        0x9EEDEBAD => 'hp_regen',
        0x913157BB => 'hp_regen_per_level',
        0xE62D9D92 => 'move_speed',
        0x4F89C991 => 'base_attack_speed',
    ];

    /** Wrapper class hash and inner `baseValue` field hash — used for unwrapping. */
    public const WRAPPER_TYPE_HASH = '{ce9b917b}';

    public const INNER_VALUE_KEY = '{b35aa769}'; // FNV1a("baseValue")

    /**
     * Return the semantic name for a hash like `{8662cf12}` or `8662cf12`.
     * Accepts either wrapped `{hex}` form or bare 8-char hex.
     */
    public static function lookup(string $hash): ?string
    {
        $hex = trim($hash, '{}');
        $int = hexdec($hex);

        return self::MAP[$int] ?? null;
    }

    /**
     * Reverse lookup for diagnostics: given a semantic name, return the
     * wrapped hash string. Returns null if not in the registry.
     */
    public static function hashForName(string $name): ?string
    {
        foreach (self::MAP as $hash => $mapped) {
            if ($mapped === $name) {
                return sprintf('{%08x}', $hash);
            }
        }

        return null;
    }
}
