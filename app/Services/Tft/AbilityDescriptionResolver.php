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
    ) {}

    /**
     * Resolve a spell's name and description into text, rendering for a
     * given star level (0 = base, 1-3 = star 1-3, 4-6 = upgraded variants).
     *
     * @param  array{key_name: string|null, key_tooltip: string|null}  $locKeys
     * @param  list<array{name: string, values: array<int, int|float>}>  $dataValues
     * @return array{name: string|null, template: string|null, rendered: string|null}
     */
    public function resolve(
        array $locKeys,
        array $dataValues,
        int $starLevel = 2,
        string $channel = 'pbe',
        string $locale = 'en_us',
    ): array {
        $entries = $this->stringtable->entries($channel, $locale);

        $name = $this->lookup($entries, $locKeys['key_name'] ?? null);
        $template = $this->lookup($entries, $locKeys['key_tooltip'] ?? null);

        $rendered = $template !== null
            ? $this->renderTemplate($template, $dataValues, $starLevel)
            : null;

        return [
            'name' => $name,
            'template' => $template,
            'rendered' => $rendered,
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
     * template with values drawn from DataValues at the given star level.
     */
    private function renderTemplate(string $template, array $dataValues, int $starLevel): string
    {
        // Build a name => value map for quick lookup
        $values = [];
        foreach ($dataValues as $dv) {
            $arr = $dv['values'] ?? [];
            $values[$dv['name']] = $arr[$starLevel] ?? ($arr[0] ?? null);
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
