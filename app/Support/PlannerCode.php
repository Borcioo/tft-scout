<?php

namespace App\Support;

/**
 * TFT in-game Team Planner code generator (PHP port).
 *
 * Mirrors resources/js/lib/plannerCode.ts — keep the two in sync.
 *
 * Format: "02" + 10 slots (3-char lowercase hex each) + "TFTSet<N>"
 * Each slot = champion's `planner_code` (int from CDragon
 * `team_planner_code`) in hex, padded to 3 chars. Empty slots = "000".
 *
 * Used server-side for deduplication: two plans with the same unit
 * composition produce the same code, so the code doubles as a natural
 * dedup / idempotency key.
 */
final class PlannerCode
{
    private const VERSION_BYTE = '02';

    private const TEAM_SIZE = 10;

    private const SLOT_HEX_CHARS = 3;

    private const EMPTY_SLOT = '000';

    private const SUFFIX_PREFIX = 'TFTSet';

    /**
     * @param  array<int, array{apiName?: string, plannerCode?: int|null}>  $champions
     */
    public static function generate(array $champions, ?string $setVersion = null): ?string
    {
        if (empty($champions)) {
            return null;
        }

        $setNumber = self::normalizeSetNumber(
            $setVersion ?? self::deriveSetVersion($champions)
        );

        $slots = [];
        foreach ($champions as $c) {
            $code = $c['plannerCode'] ?? null;
            if ($code === null) {
                continue;
            }
            $slots[] = str_pad(
                strtolower(dechex((int) $code)),
                self::SLOT_HEX_CHARS,
                '0',
                STR_PAD_LEFT,
            );
            if (count($slots) >= self::TEAM_SIZE) {
                break;
            }
        }

        if (empty($slots)) {
            return null;
        }

        while (count($slots) < self::TEAM_SIZE) {
            $slots[] = self::EMPTY_SLOT;
        }

        return self::VERSION_BYTE.implode('', $slots).self::SUFFIX_PREFIX.$setNumber;
    }

    /**
     * @param  array<int, array{apiName?: string}>  $champions
     */
    public static function deriveSetVersion(array $champions): ?string
    {
        foreach ($champions as $c) {
            $api = $c['apiName'] ?? '';
            if (preg_match('/^(TFT\d+)_/', $api, $m)) {
                return $m[1];
            }
        }

        return null;
    }

    private static function normalizeSetNumber(?string $setVersion): string
    {
        $raw = (string) ($setVersion ?? '');
        $stripped = preg_replace('/^TFT/', '', $raw) ?? '';

        return $stripped !== '' ? $stripped : '17';
    }
}
