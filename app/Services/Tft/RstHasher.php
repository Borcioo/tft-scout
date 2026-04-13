<?php

namespace App\Services\Tft;

/**
 * Riot String Table (RST) hash algorithm. Produces the lookup key used
 * to fetch localised strings from `tft.stringtable.json`.
 *
 * Algorithm (per cdtb/rstfile.py:13-19):
 *   key = xxh3_64(lowercase(input))
 *   mask = (1 << bits) - 1
 *   return key & mask
 *
 * Bit size depends on game version + RST file version:
 *   - game_version >= 15.02 and RST v4/v5 → 38 bits (current TFT17)
 *   - game_version >= 14.15 and RST v4/v5 → 39 bits
 *   - older → 40 bits (xxh64 instead of xxh3)
 *
 * We default to 38 bits because TFT17 is the focus and everything we
 * currently work with is on 15.02+. Callers can override when parsing
 * older content.
 *
 * PHP 8.1+ ships xxh3_64 as `hash('xxh3', $input)` — no composer package
 * needed. Verified empirically: hash matches Python xxhash library output
 * for the same input on 8/8 Miss Fortune spell loc keys.
 */
final class RstHasher
{
    public const DEFAULT_BITS = 38;

    /**
     * Compute the RST hash as a 64-bit integer masked to `bits`.
     *
     * Returns a plain int — PHP is 64-bit on modern systems so the full
     * xxh3_64 value fits. Caller can format as hex via `formatAsKey()`.
     */
    public static function hash(string $input, int $bits = self::DEFAULT_BITS): int
    {
        // PHP's `hash('xxh3', ...)` returns 8 bytes of big-endian xxh3_64.
        // We unpack as signed 64-bit ('J' = big-endian unsigned 64) — the
        // sign bit doesn't matter after masking, the bitwise AND works on
        // the raw bit pattern. `hexdec` cannot be used here because it
        // falls back to float for values > PHP_INT_MAX and loses the
        // low bits we actually need.
        $binary = hash('xxh3', strtolower($input), true);
        ['full' => $full] = unpack('Jfull', $binary);

        $mask = (1 << $bits) - 1;

        return $full & $mask;
    }

    /**
     * Format a key like CDragon does in stringtable JSON dumps.
     * Example: `Spell_..._Name` @ 38 bits → `{1508bfc202}` (10 hex chars).
     *
     * The 10-char width comes from the max 40-bit representation; 38/39-bit
     * hashes are zero-padded to the same width so the lookup works for all
     * mask sizes.
     */
    public static function formatAsKey(int $hash): string
    {
        return sprintf('{%010x}', $hash);
    }

    /**
     * Convenience: hash an input and return the CDragon-style wrapped key.
     */
    public static function key(string $input, int $bits = self::DEFAULT_BITS): string
    {
        return self::formatAsKey(self::hash($input, $bits));
    }
}
