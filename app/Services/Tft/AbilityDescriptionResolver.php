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
     * The optional `$template` parameter gives the evaluator a chance to
     * reverse-resolve hashed calc keys (e.g. `{c30d568b}` ↔ `ModifiedNumRockets`)
     * by FNV-1a matching against the placeholders found in the template.
     *
     * `$championStats` maps mStat enum values to champion stat values so
     * StatByCoefficient nodes (Jinx NumRockets uses mStat=4 for AS) can
     * be evaluated. Hooks build this dict from the Champion model before
     * calling resolve().
     *
     * @param  list<array{name: string, values: array<int, int|float>}>  $dataValues
     * @param  array<string, mixed>  $calculations
     * @param  array<int, float>  $championStats
     * @return list<array{name: string, value: array<int, int|float>, kind?: string}>
     */
    public function mergeDataValuesWithCalculations(
        array $dataValues,
        array $calculations,
        ?string $template = null,
        array $championStats = [],
    ): array {
        $placeholderNames = $template !== null
            ? $this->extractPlaceholderNames($template)
            : [];

        // Some spells (Gragas DURATION/HEALING) ship DataValue names in a
        // different case than the template's placeholder (`@Duration@`).
        // Rewrite the stat name to match the template so frontend lookups
        // — which are case-sensitive — still find it.
        $placeholderByLower = [];
        foreach ($placeholderNames as $p) {
            $placeholderByLower[strtolower($p)] = $p;
        }

        $merged = array_map(
            function (array $dv) use ($placeholderByLower) {
                $name = $dv['name'];
                $normalised = $placeholderByLower[strtolower($name)] ?? $name;

                return [
                    'name' => $normalised,
                    // Normalise to `value` (singular) to match the existing
                    // en_us.json-sourced ability_stats column format.
                    'value' => $dv['values'] ?? $dv['value'] ?? [],
                ];
            },
            $dataValues,
        );

        $calcs = $this->calculationEvaluator->evaluate(
            $calculations,
            $dataValues,
            $placeholderNames,
            $championStats,
        );

        foreach ($calcs as $calc) {
            $merged[] = $calc;
        }

        return $merged;
    }

    /**
     * Extract every `@VarName@` placeholder name from a template string.
     * Used to feed the calc evaluator so it can match calcs whose
     * hashed key is the FNV-1a of a template placeholder.
     *
     * @return list<string>
     */
    private function extractPlaceholderNames(string $template): array
    {
        preg_match_all('/@([A-Za-z_][A-Za-z0-9_]*)(?:\*[0-9.]+)?@/', $template, $matches);

        return array_values(array_unique($matches[1] ?? []));
    }

    /**
     * Resolve a spell's name and description into text, rendering for a
     * given star level (0 = base, 1-3 = star 1-3, 4-6 = upgraded variants).
     *
     * @param  array{key_name: string|null, key_tooltip: string|null}  $locKeys
     * @param  list<array{name: string, values: array<int, int|float>}>  $dataValues
     * @param  array<string, mixed>  $calculations  raw mSpellCalculations dict
     * @param  array<int, float>  $championStats   mStat enum → stat value
     * @return array{name: string|null, template: string|null, rendered: string|null, merged_stats: array}
     */
    public function resolve(
        array $locKeys,
        array $dataValues,
        int $starLevel = 2,
        ?string $channel = null,
        string $locale = 'en_us',
        array $calculations = [],
        array $championStats = [],
    ): array {
        $channel ??= (string) config('services.cdragon.channel', 'latest');
        $entries = $this->stringtable->entries($channel, $locale);

        $name = $this->lookup($entries, $locKeys['key_name'] ?? null);
        $template = $this->lookup($entries, $locKeys['key_tooltip'] ?? null);

        if ($template !== null) {
            $template = $this->expandKeywordTokens($template, $entries);
            $template = $this->substituteUnitProperties($template);
        }

        $mergedStats = $this->mergeDataValuesWithCalculations(
            $dataValues,
            $calculations,
            $template,
            $championStats,
        );

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
     * Replace `@TFTUnitProperty.:SomeProp@` references with a static `0`.
     *
     * These are runtime-accumulated stacks — Bard's abducted friends,
     * Ezreal's takedowns, Cho'Gath's bonus health per kill, Nasus Hero's
     * bonus damage per kill. In-game the number grows during combat;
     * before the fight starts (and in our static tooltip) it's `0`, which
     * is the value the game itself shows on the unit card.
     *
     * The `.:` separator is Riot's syntax for "lookup unit property by
     * name" — there's no DataValue or SpellCalculation we could resolve
     * it against, and the placeholder renderer would otherwise leave
     * `@TFTUnitProperty.:...@` as literal text in the tooltip.
     */
    private function substituteUnitProperties(string $template): string
    {
        return preg_replace('/@TFTUnitProperty\.:[A-Za-z0-9_]+@/', '0', $template) ?? $template;
    }

    /**
     * Expand `{{token}}` tooltip tokens in a description template.
     *
     * Riot ability descriptions reference named keywords like
     * `{{TFT17_SpaceGroove_TheGroove}}` or `{{TFT_Keyword_Chill}}` that
     * should display as short inline labels ("The Groove", "Chill"). The
     * token key resolves against the same RST stringtable used for the
     * tooltip itself; the resulting value often contains a rainbow
     * `<font color='#XXX'>` wrapper per character which the frontend
     * doesn't know how to render.
     *
     * We look up the token, strip any `<font>` tags (keeping only their
     * inner text), and wrap the plain label in `<TFTKeyword>` so the
     * existing frontend tag-class map styles it in amber. Unresolved
     * tokens fall back to the last underscore-separated segment
     * ("Chill") so we at least render something readable instead of
     * leaking the raw `{{...}}` form.
     */
    private function expandKeywordTokens(string $template, array $entries): string
    {
        return preg_replace_callback(
            '/\{\{([^}]+)\}\}/',
            function (array $match) use ($entries) {
                $token = trim($match[1]);
                $resolved = $this->lookup($entries, $token);

                if ($resolved === null) {
                    // Fallback: last underscore-separated chunk ("Chill"
                    // from "TFT_Keyword_Chill"). Keeps tooltips readable
                    // for tokens Riot hasn't shipped a stringtable entry for.
                    $parts = explode('_', $token);
                    $label = end($parts) ?: $token;
                } else {
                    // Strip the rainbow `<font color=...>` wrapper Riot
                    // uses for flavour — it's one `<font>` tag per character,
                    // which collapses back to the plain label ("The Groove").
                    $label = preg_replace('/<font[^>]*>|<\/font>/i', '', $resolved) ?? $resolved;
                    $label = trim($label);
                }

                return '<TFTKeyword>'.$label.'</TFTKeyword>';
            },
            $template,
        ) ?? $template;
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
     * Present a number the way tooltips usually show it. The key
     * distinction is between legit fractional values (`2.5 seconds`,
     * `0.75 crit chance`) that players should see, and arithmetic
     * artefacts from SpellCalculationEvaluator (`18.14 rockets`) that
     * tooltips round to integers.
     *
     * Heuristic: if the fractional part is smaller than 0.2 treat it
     * as imprecision from the evaluator and round to an int. Anything
     * larger is a deliberate half-integer step (2.5, 30.5) that we
     * keep so the displayed number matches in-game text.
     */
    private function formatNumber(float $value): string
    {
        $fractional = abs($value - round($value));
        if ($fractional < 0.2) {
            return (string) (int) round($value);
        }

        return rtrim(rtrim(number_format($value, 2, '.', ''), '0'), '.');
    }
}
