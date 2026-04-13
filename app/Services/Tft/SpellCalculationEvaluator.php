<?php

namespace App\Services\Tft;

/**
 * Evaluates TFT ability `mSpellCalculations` into flat per-star-level
 * numbers so they can be rendered into description templates alongside
 * regular DataValues.
 *
 * Background
 * ----------
 * A spell's description template often references computed variables
 * like `@TotalDamage@` or `@ModifiedNumRockets@` that aren't in
 * DataValues directly. These live in `mSpellCalculations`, each with
 * a formula tree of CalculationPart nodes. Evaluating the tree against
 * the spell's DataValues gives you the final display number.
 *
 * Calc keys come in two forms:
 *   - Plaintext key (`TotalDamage`) — name matches the template placeholder
 *     directly and CDragon has it in the public hashlist.
 *   - Hashed key (`{c30d568b}`) — the plaintext name (e.g. `ModifiedNumRockets`)
 *     is NOT in any public hashlist yet. We still want to expose it to the
 *     template, so we reverse-lookup by computing FNV-1a 32 of every
 *     `@Name@` placeholder we find and matching it against the hashed keys.
 *
 * Calc nodes can recursively reference other calcs via
 * `mSpellCalculationKey` — `TotalDamage` for Jinx sums two sub-calcs
 * (`{fbc8a418}` = AD contribution, `{02acd6dc}` = AP contribution). We
 * keep the whole `mSpellCalculations` dict as context during evaluation
 * so cross-references resolve naturally.
 *
 * mStat convention (for SubPartScaledProportionalToStat):
 *   - `mStat` PRESENT (e.g. `mStat: 3` for AD flat) — dataValue is already
 *     a display number, compute `dataValue * mRatio` as-is.
 *   - `mStat` ABSENT — dataValue is a scaling coefficient against the
 *     implicit base AP stat (100 in TFT), multiply by 100.
 *
 * Supported part types:
 *   - SumOfSubPartsCalculationPart — recursive sum over mSubparts
 *   - SubPartScaledProportionalToStat — dataValue * mRatio (with 100×
 *     implicit scaling when mStat is absent)
 *   - NamedDataValueCalculationPart — direct DataValue lookup
 *   - NumberCalculationPart — literal constant `mNumber`
 *   - ProductOfSubPartsCalculationPart — mPart1 × mPart2
 *   - ExponentSubPartsCalculationPart — part1 ^ part2 (NB: inner keys
 *     use lowercase `part1` / `part2` while Product uses `mPart1` /
 *     `mPart2` — Riot naming quirk, both handled)
 *   - ClampSubPartsCalculationPart — clamp(sum(mSubparts), mFloor, mCeiling)
 *   - StatByCoefficientCalculationPart — mCoefficient × championStat[mStat]
 *   - ByNamedSpellCalculationSubPart (detected by mSpellCalculationKey) —
 *     recursive lookup of another entry in mSpellCalculations
 *
 * Champion stats for StatByCoefficient come via `championStats` in the
 * evaluation context: an associative array keyed by the mStat enum
 * integer. Passing `['4' => 0.75]` lets us resolve mStat=4 (attack
 * speed) references like Jinx NumRockets. Only mStat values actually
 * used by known spells are mapped; unknown ones return null and drop
 * the whole calc so the frontend can fall back to its `[Name]` stub.
 */
class SpellCalculationEvaluator
{
    /** How many star/level entries to compute (matches DataValues array length). */
    public const MAX_STARS = 7;

    /**
     * Evaluate every calculation in `mSpellCalculations` and return the
     * subset we can fully resolve. Each entry has a plaintext name that
     * matches a template placeholder (either from its original plaintext
     * key or from a reverse FNV-1a match against a hashed key).
     *
     * @param  array<string, mixed>  $calculations  raw spell.mSpellCalculations dict
     * @param  list<array{name: string, values: array<int, int|float>}>  $dataValues  from inspector
     * @param  list<string>  $placeholderNames  plaintext names extracted from the template
     * @param  array<int, float>  $championStats  mStat enum → champion stat value
     * @return list<array{name: string, value: array<int, float>, kind: string}>
     */
    public function evaluate(
        array $calculations,
        array $dataValues,
        array $placeholderNames = [],
        array $championStats = [],
    ): array {
        // Index DataValues by both plaintext name and FNV-1a hash so we
        // can resolve mDataValue references regardless of form.
        $dvByName = [];
        $dvByHash = [];
        foreach ($dataValues as $dv) {
            $name = $dv['name'] ?? null;
            $values = $dv['values'] ?? $dv['value'] ?? [];
            if (! is_string($name) || ! is_array($values)) {
                continue;
            }
            $dvByName[$name] = $values;
            $dvByHash[FnvHasher::wrapped($name)] = $values;
        }

        // Build hash → plaintext name map for placeholder names that
        // show up in the template. This lets us surface calcs whose
        // keys are hashed like `{c30d568b}` but whose plaintext name
        // (`ModifiedNumRockets`) is visible in the template text.
        $hashToPlaceholder = [];
        foreach ($placeholderNames as $name) {
            $hashToPlaceholder[FnvHasher::wrapped($name)] = $name;
        }

        // Keep the whole calcs dict around so cross-references via
        // mSpellCalculationKey resolve without another lookup pass.
        // championStats is passed through so StatByCoefficient nodes can
        // look up champion-level stats by their mStat enum value.
        $context = [
            'calculations' => $calculations,
            'dvByName' => $dvByName,
            'dvByHash' => $dvByHash,
            'championStats' => $championStats,
        ];

        $out = [];
        foreach ($calculations as $calcKey => $calc) {
            if (! is_array($calc)) {
                continue;
            }

            // Determine the display name: either a plaintext key, or the
            // reverse-hash match from template placeholders.
            $displayName = $this->resolveCalcName($calcKey, $hashToPlaceholder);
            if ($displayName === null) {
                continue; // hashed key with no matching template placeholder — skip
            }

            $values = [];
            $ok = true;
            for ($star = 0; $star < self::MAX_STARS; $star++) {
                $total = $this->evaluateCalculation($calc, $context, $star);
                if ($total === null) {
                    $ok = false;
                    break;
                }
                $values[] = round($total, 2);
            }

            if (! $ok) {
                continue; // unsupported formula node somewhere — drop silently
            }

            $out[] = [
                'name' => $displayName,
                'value' => $values,
                'kind' => 'calculated',
            ];
        }

        return $out;
    }

    /**
     * Map a calc key to a human-readable name:
     *   - plaintext key (`TotalDamage`) → itself
     *   - hashed key (`{c30d568b}`) → reverse-hash match against placeholders,
     *     or null if no template reference known
     */
    private function resolveCalcName(string $key, array $hashToPlaceholder): ?string
    {
        if (! (str_starts_with($key, '{') && str_ends_with($key, '}'))) {
            return $key;
        }

        return $hashToPlaceholder[$key] ?? null;
    }

    /**
     * Walk a GameCalculation's mFormulaParts and sum them for one star.
     * Returns null if any sub-part can't be resolved.
     */
    private function evaluateCalculation(array $calc, array $context, int $star): ?float
    {
        $total = 0.0;
        foreach ($calc['mFormulaParts'] ?? [] as $part) {
            $partValue = $this->evaluatePart($part, $context, $star);
            if ($partValue === null) {
                return null;
            }
            $total += $partValue;
        }

        return $total;
    }

    /**
     * Recursive dispatch over the formula part node types we know about.
     * Unknown types return null so the caller can skip the whole calc
     * rather than silently producing a wrong number.
     */
    private function evaluatePart(array $part, array $context, int $star): ?float
    {
        $type = $part['__type'] ?? '';

        switch ($type) {
            case 'SumOfSubPartsCalculationPart':
                $sum = 0.0;
                foreach ($part['mSubparts'] ?? [] as $sub) {
                    $subValue = $this->evaluatePart($sub, $context, $star);
                    if ($subValue === null) {
                        return null;
                    }
                    $sum += $subValue;
                }

                return $sum;

            case 'SubPartScaledProportionalToStat':
                $inner = $part['mSubpart'] ?? [];
                $ratio = (float) ($part['mRatio'] ?? 1.0);
                $dvValue = $this->resolveDataValue($inner, $context, $star);
                if ($dvValue === null) {
                    return null;
                }

                // mStat present → flat-damage subpart (already in final units)
                // mStat absent → ratio against implicit base AP (= 100 in TFT)
                return array_key_exists('mStat', $part)
                    ? $dvValue * $ratio
                    : $dvValue * $ratio * 100.0;

            case 'NamedDataValueCalculationPart':
                // Direct reference without any ratio wrapper.
                return $this->resolveDataValue($part, $context, $star);

            case 'NumberCalculationPart':
                return (float) ($part['mNumber'] ?? 0);

            case 'ProductOfSubPartsCalculationPart':
                // Unlike the sum variant, Product stores its operands as
                // `mPart1` and `mPart2` (Riot naming quirk). Either
                // missing operand makes the whole node unresolvable.
                $p1 = isset($part['mPart1'])
                    ? $this->evaluatePart($part['mPart1'], $context, $star)
                    : null;
                $p2 = isset($part['mPart2'])
                    ? $this->evaluatePart($part['mPart2'], $context, $star)
                    : null;
                if ($p1 === null || $p2 === null) {
                    return null;
                }

                return $p1 * $p2;

            case 'ExponentSubPartsCalculationPart':
                // Exponent uses lowercase `part1` / `part2` (different
                // from Product's mPart1 / mPart2). Base^0 handled by
                // PHP's ** operator; negative base with fractional
                // exponent would throw, but such values don't appear
                // in TFT spell data in practice.
                $e1 = isset($part['part1'])
                    ? $this->evaluatePart($part['part1'], $context, $star)
                    : null;
                $e2 = isset($part['part2'])
                    ? $this->evaluatePart($part['part2'], $context, $star)
                    : null;
                if ($e1 === null || $e2 === null) {
                    return null;
                }
                if ($e1 === 0.0 && $e2 < 0) {
                    return null; // 1/0 — unresolvable
                }

                return $e1 ** $e2;

            case 'ClampSubPartsCalculationPart':
                // Sums mSubparts then clamps to [mFloor, mCeiling]. Either
                // bound can be null — treat that as -INF / +INF.
                $sum = 0.0;
                foreach ($part['mSubparts'] ?? [] as $sub) {
                    $subValue = $this->evaluatePart($sub, $context, $star);
                    if ($subValue === null) {
                        return null;
                    }
                    $sum += $subValue;
                }
                $floor = $part['mFloor'] ?? null;
                $ceiling = $part['mCeiling'] ?? null;
                if ($floor !== null) {
                    $sum = max($sum, (float) $floor);
                }
                if ($ceiling !== null) {
                    $sum = min($sum, (float) $ceiling);
                }

                return $sum;

            case 'StatByCoefficientCalculationPart':
                // mCoefficient × championStat[mStat]. mStat is an enum
                // describing which stat to look up; we only know a handful
                // so far. mStatFormula (0 = base, 1 = bonus, 2 = total)
                // is currently ignored — we always return the base value
                // the Champion model holds. If a spell breaks because it
                // expects the bonus stat we'll extend this.
                $statEnum = $part['mStat'] ?? null;
                $coefficient = (float) ($part['mCoefficient'] ?? 1.0);
                $statValue = $this->resolveChampionStat($statEnum, $context['championStats'] ?? []);
                if ($statValue === null) {
                    return null;
                }

                return $coefficient * $statValue;

            // By-reference sub-calc: resolves via mSpellCalculationKey
            // pointing at another entry in mSpellCalculations. The type
            // name itself is usually a hash (`{f3cbe7b2}`) so we detect
            // this case by presence of the key rather than by type.
            default:
                if (isset($part['mSpellCalculationKey'])) {
                    return $this->evaluateSubCalc($part['mSpellCalculationKey'], $context, $star);
                }

                // Any truly unknown type — return null to mark the
                // whole calc as unresolvable so we don't fabricate a value.
                return null;
        }
    }

    /**
     * Map an mStat enum integer to the corresponding champion stat value.
     * Only populated with values we've empirically confirmed against
     * real spells. Unknown enums return null and drop the calc.
     *
     * Known mappings (TFT17, empirical):
     *   4 → attack_speed (verified via Jinx NumRockets)
     *
     * Add more as new spells surface them during import.
     *
     * @param  array<int|string, float>  $championStats
     */
    private function resolveChampionStat(?int $statEnum, array $championStats): ?float
    {
        if ($statEnum === null) {
            return null;
        }

        // championStats is keyed by the mStat enum directly, so hooks
        // can pass whatever stats they know about and the evaluator
        // transparently picks them up.
        return isset($championStats[$statEnum])
            ? (float) $championStats[$statEnum]
            : null;
    }

    /**
     * Look up a referenced calc by its key and evaluate it for the given
     * star level. Returns null if the key doesn't exist in the context.
     */
    private function evaluateSubCalc(string $key, array $context, int $star): ?float
    {
        $target = $context['calculations'][$key] ?? null;
        if (! is_array($target)) {
            return null;
        }

        return $this->evaluateCalculation($target, $context, $star);
    }

    /**
     * Look up a data value for the given star level. `mDataValue` can be
     * either a plaintext name or a wrapped FNV-1a hash like `{313962b5}`.
     * Missing references return null so the caller can bail on the calc.
     */
    private function resolveDataValue(array $node, array $context, int $star): ?float
    {
        $ref = $node['mDataValue'] ?? null;
        if (! is_string($ref)) {
            return null;
        }

        $values = $context['dvByName'][$ref] ?? $context['dvByHash'][$ref] ?? null;
        if (! is_array($values)) {
            return null;
        }

        return (float) ($values[$star] ?? 0);
    }
}
