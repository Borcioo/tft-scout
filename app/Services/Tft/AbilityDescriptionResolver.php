<?php

namespace App\Services\Tft;

/**
 * Resolves TFT ability descriptions from RST stringtable entries and
 * renders their templates against the ability's DataValues.
 *
 * Flow (for one spell):
 *   1. Inspector extracts loc keys (plaintext) + data values from bin
 *   2. Resolver computes RST hash for each key (38-bit xxh3_64)
 *   3. Looks up in stringtable → template text with @VarName@ placeholders
 *   4. Substitutes @VarName@ with values[star_level] from DataValues
 *
 * Template syntax observed in the wild:
 *   @VarName@          plain substitution
 *   @VarName*100@      multiplication (e.g. percent display)
 *   <physicalDamage>text</physicalDamage>   inline color tags
 *   %i:scaleAD%        inline scaling icon marker
 *   &nbsp;             HTML entity non-breaking space
 *
 * We resolve @Name@ and @Name*N@ arithmetic; the rest (HTML tags, icon
 * markers, entities) is passed through for the frontend to handle. That's
 * the same split CDragon uses — they don't strip tags either, expecting
 * consumers to render or sanitize.
 */
class AbilityDescriptionResolver
{
    public function __construct(
        private readonly StringtableCache $stringtable,
        private readonly SpellCalculationEvaluator $calculationEvaluator,
    ) {}

    /**
     * Merge DataValues with evaluated SpellCalculations into one flat list
     * that template rendering can look variables up in.
     *
     * Calculated entries are appended after raw data values. A `@TotalDamage@`
     * placeholder in the template resolves against an evaluated calc first
     * (precomputed per star level), while simple `@Duration@` placeholders
     * still find their raw DataValue. Calc entries get `kind: calculated`
     * so downstream consumers (DB, frontend) can tell them apart.
     *
     * @param  list<array{name: string, values: array<int, int|float>}>  $dataValues
     * @param  array<string, mixed>  $calculations
     * @return list<array{name: string, value: array<int, int|float>, kind?: string}>
     */
    public function mergeDataValuesWithCalculations(array $dataValues, array $calculations): array
    {
        $merged = array_map(
            fn (array $dv) => [
                'name' => $dv['name'],
                // Normalise to `value` (singular) to match the existing
                // en_us.json-sourced ability_stats column format.
                'value' => $dv['values'] ?? $dv['value'] ?? [],
            ],
            $dataValues,
        );

        foreach ($this->calculationEvaluator->evaluate($calculations, $dataValues) as $calc) {
            $merged[] = $calc;
        }

        return $merged;
    }

    /**
     * Resolve a spell's name and description into text, rendering for a
     * given star level (0 = base, 1-3 = star 1-3, 4-6 = upgraded variants).
     *
     * @param  array{key_name: string|null, key_tooltip: string|null}  $locKeys
     * @param  list<array{name: string, values: array<int, int|float>}>  $dataValues
     * @param  array<string, mixed>  $calculations  raw mSpellCalculations dict
     * @return array{name: string|null, template: string|null, rendered: string|null, merged_stats: array}
     */
    public function resolve(
        array $locKeys,
        array $dataValues,
        int $starLevel = 2,
        string $channel = 'pbe',
        string $locale = 'en_us',
        array $calculations = [],
    ): array {
        $entries = $this->stringtable->entries($channel, $locale);

        $name = $this->lookup($entries, $locKeys['key_name'] ?? null);
        $template = $this->lookup($entries, $locKeys['key_tooltip'] ?? null);

        $mergedStats = $this->mergeDataValuesWithCalculations($dataValues, $calculations);

        $rendered = $template !== null
            ? $this->renderTemplate($template, $mergedStats, $starLevel)
            : null;

        return [
            'name' => $name,
            'template' => $template,
            'rendered' => $rendered,
            'merged_stats' => $mergedStats,
        ];
    }

    /**
     * Hash a plaintext key, look it up in the stringtable entries.
     * Null-safe — returns null for null input.
     */
    private function lookup(array $entries, ?string $key): ?string
    {
        if ($key === null || $key === '') {
            return null;
        }

        $hashKey = RstHasher::key($key);

        return $entries[$hashKey] ?? null;
    }

    /**
     * Replace @VarName@ and @VarName*N@ placeholders in a description
     * template with values drawn from merged data values / calculations
     * at the given star level.
     *
     * Accepts both `values` (plural, inspector format) and `value` (singular,
     * normalised format) since merged_stats uses `value` after normalisation.
     */
    private function renderTemplate(string $template, array $stats, int $starLevel): string
    {
        // Build a name => value map for quick lookup
        $values = [];
        foreach ($stats as $entry) {
            $arr = $entry['value'] ?? $entry['values'] ?? [];
            $values[$entry['name']] = $arr[$starLevel] ?? ($arr[0] ?? null);
        }

        // Match @VarName@ and @VarName*N@ (N can be int or float)
        return preg_replace_callback(
            '/@([A-Za-z_][A-Za-z0-9_]*)(\*([0-9.]+))?@/',
            function (array $match) use ($values) {
                $varName = $match[1];
                $multiplier = isset($match[3]) ? (float) $match[3] : 1.0;

                if (! array_key_exists($varName, $values)) {
                    return $match[0]; // leave untouched if variable unknown
                }

                $value = (float) $values[$varName] * $multiplier;

                return $this->formatNumber($value);
            },
            $template,
        );
    }

    /**
     * Present a number the way tooltips usually show it: integer if close
     * enough to whole, otherwise short decimal. Matches how Riot formats
     * numbers in in-game tooltips.
     */
    private function formatNumber(float $value): string
    {
        if (abs($value - round($value)) < 0.01) {
            return (string) (int) round($value);
        }

        return (string) round($value, 2);
    }
}
