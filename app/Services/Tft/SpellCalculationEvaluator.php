<?php

namespace App\Services\Tft;

/**
 * Evaluates TFT ability `mSpellCalculations` into flat per-star-level
 * numbers so they can be rendered into description templates alongside
 * regular DataValues.
 *
 * Background: a spell's description template often references computed
 * variables like `@TotalDamage@` or `@ModifiedDamagePerSecond@` that
 * aren't in DataValues directly. These live in mSpellCalculations, each
 * with a formula tree of CalculationPart nodes. Evaluating the tree
 * against the spell's DataValues gives you the final display number.
 *
 * Observed formula shapes for TFT17 Miss Fortune variants:
 *
 *   GameCalculation:
 *     mFormulaParts:
 *       SumOfSubPartsCalculationPart:
 *         mSubparts:
 *           SubPartScaledProportionalToStat:
 *             mSubpart: { mDataValue: "ADDamage" | "{hash}" }
 *             mRatio: 1.0
 *             mStat: 3     (AD scaling flag — see note below)
 *
 * About `mStat`: empirically the `mStat` multiplier is *not* applied
 * when CDragon renders tooltips. The `dataValue * mRatio` product is
 * already the displayed number and `mStat` is just a flag for the
 * frontend to know which stat the value scales with (for the "(+X% AD)"
 * subtitle format in in-game tooltips). We therefore compute
 * `sum(dataValue[star] * mRatio)` and surface that as the calc value;
 * frontend can still reference the raw dataValues for scaling hints.
 *
 * `mDataValue` can be either a plaintext name (new TFT17 spells) or a
 * FNV-1a 32 hash like `{313962b5}` (legacy format). Both are resolved.
 */
class SpellCalculationEvaluator
{
    /** How many star/level entries to compute (matches DataValues array length). */
    public const MAX_STARS = 7;

    /**
     * Evaluate every named calculation in `mSpellCalculations`.
     *
     * @param  array<string, mixed>  $calculations  raw spell.mSpellCalculations dict
     * @param  list<array{name: string, values: array<int, int|float>}>  $dataValues  from inspector
     * @return list<array{name: string, value: array<int, float>, kind: string}>
     */
    public function evaluate(array $calculations, array $dataValues): array
    {
        // Index DataValues both by plaintext name and by hash so we can
        // resolve mDataValue references of either form.
        $byName = [];
        $byHash = [];
        foreach ($dataValues as $dv) {
            $name = $dv['name'] ?? null;
            $values = $dv['values'] ?? $dv['value'] ?? [];
            if (! is_string($name) || ! is_array($values)) {
                continue;
            }
            $byName[$name] = $values;
            $byHash[FnvHasher::wrapped($name)] = $values;
        }

        $out = [];
        foreach ($calculations as $calcName => $calc) {
            // Skip hashed-key calcs — those are internal and not referenced
            // from tooltip templates. Tooltip placeholders use the plaintext
            // key (e.g. `@TotalDamage@`) which maps to the top-level key.
            if (! is_string($calcName) || str_starts_with($calcName, '{')) {
                continue;
            }
            if (! is_array($calc)) {
                continue;
            }

            $values = [];
            for ($star = 0; $star < self::MAX_STARS; $star++) {
                $total = 0.0;
                foreach ($calc['mFormulaParts'] ?? [] as $part) {
                    $total += $this->evaluatePart($part, $byName, $byHash, $star);
                }
                $values[] = round($total, 2);
            }

            $out[] = [
                'name' => $calcName,
                'value' => $values,
                'kind' => 'calculated',
            ];
        }

        return $out;
    }

    /**
     * Recursive dispatch over the mFormulaParts node types we've seen
     * in the wild. Unknown types return 0 (with the effect of skipping
     * the contribution) rather than throwing — one exotic spell
     * shouldn't break a whole import.
     */
    private function evaluatePart(array $part, array $byName, array $byHash, int $star): float
    {
        $type = $part['__type'] ?? '';

        switch ($type) {
            case 'SumOfSubPartsCalculationPart':
                $sum = 0.0;
                foreach ($part['mSubparts'] ?? [] as $sub) {
                    $sum += $this->evaluatePart($sub, $byName, $byHash, $star);
                }

                return $sum;

            case 'SubPartScaledProportionalToStat':
                // Inner structure: { mSubpart: {mDataValue}, mRatio, mStat }
                $inner = $part['mSubpart'] ?? [];
                $ratio = (float) ($part['mRatio'] ?? 1.0);
                $dvValue = $this->resolveDataValue($inner, $byName, $byHash, $star);

                return $dvValue * $ratio;

            case 'NamedDataValueCalculationPart':
                // Direct reference to a data value without any ratio wrap.
                return $this->resolveDataValue($part, $byName, $byHash, $star);

            case 'NumberCalculationPart':
                // Literal constant — rare but possible.
                return (float) ($part['mNumber'] ?? 0);

            default:
                return 0.0;
        }
    }

    /**
     * Look up a data value for the given star level. `mDataValue` can be
     * either a plaintext name or a wrapped FNV-1a hash like `{313962b5}`.
     * Missing references yield 0.
     */
    private function resolveDataValue(array $node, array $byName, array $byHash, int $star): float
    {
        $ref = $node['mDataValue'] ?? null;
        if (! is_string($ref)) {
            return 0.0;
        }

        $values = $byName[$ref] ?? $byHash[$ref] ?? null;
        if (! is_array($values)) {
            return 0.0;
        }

        return (float) ($values[$star] ?? 0);
    }
}
