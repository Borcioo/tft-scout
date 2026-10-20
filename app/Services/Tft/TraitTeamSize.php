<?php

namespace App\Services\Tft;

/**
 * Max-team-size bonus granted by a trait breakpoint (Set 17 Mecha 6:
 * +1, Set 18 Riftbeast 10: +2).
 *
 * Riot exposes the bonus as a `TeamSize` effect variable, but doesn't
 * scope it to the breakpoint that grants it — Mecha carries TeamSize=1
 * on its 3, 4 and 6 breakpoints while only the 6 row says "+1 max team
 * size". The description is the source of truth: it has one row per
 * breakpoint, each opened by `@MinUnits@`, and the granting row is the
 * first one that mentions `@TeamSize@`. That breakpoint and every one
 * above it get the bonus.
 */
final class TraitTeamSize
{
    /**
     * @param  list<array{position: int, effects: array<string, mixed>}>  $breakpoints  sorted by position
     * @return array<int, int> position → team size bonus (only non-zero entries)
     */
    public static function byPosition(string $description, array $breakpoints): array
    {
        $values = [];
        foreach ($breakpoints as $bp) {
            $value = (int) round((float) ($bp['effects']['TeamSize'] ?? 0));
            if ($value > 0) {
                $values[$bp['position']] = $value;
            }
        }

        if ($values === []) {
            return [];
        }

        $rows = array_slice(explode('@MinUnits@', $description), 1);
        $firstRow = null;
        foreach ($rows as $i => $row) {
            if (str_contains($row, '@TeamSize')) {
                $firstRow = $i;
                break;
            }
        }

        // No row mentions it: trust the variable wherever it's set.
        if ($firstRow === null) {
            return $values;
        }

        $out = [];
        foreach ($breakpoints as $i => $bp) {
            if ($i >= $firstRow && isset($values[$bp['position']])) {
                $out[$bp['position']] = $values[$bp['position']];
            }
        }

        return $out;
    }
}
