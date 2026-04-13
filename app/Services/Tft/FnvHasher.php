<?php

namespace App\Services\Tft;

/**
 * FNV-1a 32-bit hasher — the format used by Riot's BIN files to reference
 * fields and objects by hashed binpath. In exported `.bin.json`, unresolved
 * keys appear as `{8-hex-chars}`, which is this hash in lowercase hex.
 *
 * Usage for TFT trait data: hash is computed from the lowercase binpath
 * `Maps/Shipping/Map22/Sets/TFTSet{N}/Traits/{trait_api_name}`, not from
 * the api_name alone. See docs/research/tft-character-bins-mechanics.md
 * for how this was discovered empirically (no public hashlist had it).
 */
class FnvHasher
{
    private const OFFSET_BASIS = 0x811c9dc5;
    private const PRIME = 0x01000193;
    private const MASK_32 = 0xffffffff;

    /**
     * Compute FNV-1a 32 of a string, returning bare 8-char lowercase hex.
     * Input is lowercased before hashing — Riot's convention for binpaths.
     */
    public static function hash(string $input): string
    {
        $hash = self::OFFSET_BASIS;

        foreach (unpack('C*', strtolower($input)) as $byte) {
            $hash ^= $byte;
            $hash = ($hash * self::PRIME) & self::MASK_32;
        }

        return sprintf('%08x', $hash);
    }

    /**
     * Wrapped form matching how CDragon writes unresolved keys in .bin.json.
     * Returns e.g. `{c09777da}` ready for direct comparison with JSON values.
     */
    public static function wrapped(string $input): string
    {
        return '{'.self::hash($input).'}';
    }
}
