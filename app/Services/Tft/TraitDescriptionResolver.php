<?php

namespace App\Services\Tft;

/**
 * Splits a trait description template into a shared base block and one
 * rendered row per breakpoint, with `@VarName@` placeholders substituted
 * from each breakpoint's effects dict.
 *
 * Trait templates look like this:
 *
 *     Your team gains @TeamwideAS*100@% Attack Speed. Challengers gain...
 *     <br><br>
 *     <row>(@MinUnits@) @AttackSpeedPercent*100@%</row>
 *     <row>(@MinUnits@) @AttackSpeedPercent*100@%</row>
 *
 * The first chunk (before any `<row>`/`<expandRow>`) shares its numbers
 * across every tier — `TeamwideAS` is the same at 2/3/4/5 Challengers.
 * Each `<row>` corresponds to one breakpoint and uses that tier's own
 * effect values, including `@MinUnits@` pulled from the breakpoint's
 * `min_units` column rather than the effects dict.
 *
 * The resolver mirrors AbilityDescriptionResolver's placeholder handling
 * (`@Var@`, `@Var*N@`) and also runs the same keyword/unit-property
 * substitutions so traits can use `{{TFT17_SpaceGroove_TheGroove}}` and
 * `@TFTUnitProperty.:...@` tokens uniformly with champion abilities.
 */
class TraitDescriptionResolver
{
    public function __construct(
        private readonly StringtableCache $stringtable,
    ) {}

    /**
     * @param  list<array{position: int, min_units: int, max_units: int|null, style: string|null, effects: array<string, mixed>}>  $breakpoints
     * @return array{base: string|null, breakpoints: list<array{position: int, min_units: int, max_units: int|null, style: string|null, effects: array<string, mixed>, rendered: string|null}>}
     */
    public function resolve(
        ?string $description,
        array $breakpoints,
        string $channel = 'pbe',
        string $locale = 'en_us',
    ): array {
        if ($description === null || $description === '') {
            return [
                'base' => null,
                'breakpoints' => array_map(
                    fn ($bp) => $bp + ['rendered' => null],
                    $breakpoints,
                ),
            ];
        }

        $entries = $this->stringtable->entries($channel, $locale);

        $template = $this->expandKeywordTokens($description, $entries);
        $template = $this->substituteUnitProperties($template);
        $template = $this->collapseConditionalBlocks($template);

        // Split off every <row>/<expandRow> block and keep the base chunk
        // that precedes them. Multiple row tag names exist (`row` for
        // normal, `expandRow` for tiers that reveal additional text) —
        // we treat both identically for rendering purposes.
        $rowTemplates = [];
        $base = preg_replace_callback(
            '/<(row|expandRow)>(.*?)<\/\1>/s',
            function (array $m) use (&$rowTemplates) {
                $rowTemplates[] = $m[2];

                return '';
            },
            $template,
        ) ?? $template;

        // Base chunk often ends with a trail of `<br>` separators left
        // behind by removed rows — trim them so the rendered text doesn't
        // open with empty lines.
        $base = $this->trimLeadingAndTrailingBreaks($base);

        // Render the base against the first breakpoint's effects (the
        // numbers shared across tiers live there). If no breakpoints
        // exist (some unique traits), fall back to empty effects.
        $baseEffects = $breakpoints[0]['effects'] ?? [];
        $baseMinUnits = $breakpoints[0]['min_units'] ?? 0;
        $renderedBase = $this->renderTemplate($base, $baseEffects, $baseMinUnits);

        // Zip rows with breakpoints. When the template has fewer row
        // templates than breakpoints (or vice versa) we still produce
        // one rendered entry per breakpoint — the last row template
        // repeats, which matches how the original tooltip duplicates
        // text across identical tiers.
        $rendered = [];
        foreach ($breakpoints as $i => $bp) {
            $rowTemplate = $rowTemplates[$i]
                ?? $rowTemplates[count($rowTemplates) - 1]
                ?? null;

            $rendered[] = $bp + [
                'rendered' => $rowTemplate !== null
                    ? $this->renderTemplate(
                        $rowTemplate,
                        $bp['effects'] ?? [],
                        $bp['min_units'] ?? 0,
                    )
                    : null,
            ];
        }

        return [
            'base' => $renderedBase === '' ? null : $renderedBase,
            'breakpoints' => $rendered,
        ];
    }

    /**
     * Collapse `<ShowIf.X>` / `<ShowIfNot.X>` conditional blocks.
     *
     * N.O.V.A. (DRX) and a few other traits ship dual-branch tooltips —
     * `<ShowIf.TFT17_DRX_HasAatrox>…ally damage 30% shred…</ShowIf.TFT17_DRX_HasAatrox>`
     * shows when Aatrox is on the board, `<ShowIfNot.…>` shows the
     * generic fallback otherwise. CDragon stores both; rendering both
     * produces a confusing double-list ("30% Shred and Sunders" + "Shred
     * and Sunder enemies") that duplicates every line.
     *
     * Our trait page is a static reference, so we keep the ShowIf branch
     * (it has concrete numbers like 30%, 20%, 12%, 800) and drop the
     * ShowIfNot fallback. The regex allows dots and underscores in the
     * tag name qualifier because Riot uses namespaced conditions like
     * `ShowIf.TFT17_DRX_HasAatrox`.
     */
    private function collapseConditionalBlocks(string $template): string
    {
        $template = preg_replace(
            '/<ShowIfNot\.[A-Za-z0-9_]+>.*?<\/ShowIfNot\.[A-Za-z0-9_]+>/s',
            '',
            $template,
        ) ?? $template;

        $template = preg_replace(
            '/<ShowIf\.[A-Za-z0-9_]+>(.*?)<\/ShowIf\.[A-Za-z0-9_]+>/s',
            '$1',
            $template,
        ) ?? $template;

        return $template;
    }

    /**
     * Substitute `@Name@` / `@Name*Multiplier@` / `@MinUnits@` against
     * the given effects dict, with lowercase fallback lookup for the
     * same reason AbilityDescriptionResolver needs it — some traits
     * reference `@Duration@` while CDragon stores `DURATION`.
     */
    private function renderTemplate(string $template, array $effects, int $minUnits): string
    {
        $lower = [];
        foreach ($effects as $k => $v) {
            $lower[strtolower((string) $k)] = $v;
        }

        return preg_replace_callback(
            '/@([A-Za-z_][A-Za-z0-9_]*)(\*([0-9.]+))?@/',
            function (array $match) use ($effects, $lower, $minUnits) {
                $var = $match[1];
                $multiplier = isset($match[3]) ? (float) $match[3] : 1.0;

                if ($var === 'MinUnits') {
                    return (string) $minUnits;
                }

                $value = $effects[$var] ?? $lower[strtolower($var)] ?? null;
                if (! is_numeric($value)) {
                    return $match[0]; // leave untouched if unknown
                }

                return $this->formatNumber(((float) $value) * $multiplier);
            },
            $template,
        ) ?? $template;
    }

    /**
     * Keep the number readable — small fractional imprecision from
     * CDragon's float32→float64 conversion rounds to integer,
     * deliberate half-steps stay as decimals.
     */
    private function formatNumber(float $value): string
    {
        $fractional = abs($value - round($value));
        if ($fractional < 0.01) {
            return (string) (int) round($value);
        }

        return rtrim(rtrim(number_format($value, 2, '.', ''), '0'), '.');
    }

    /**
     * Collapse leading `<br>` / whitespace and trailing `<br>` left
     * behind by the row extraction pass so the rendered base doesn't
     * render with phantom blank lines.
     */
    private function trimLeadingAndTrailingBreaks(string $s): string
    {
        $s = preg_replace('/^(\s|<br\s*\/?>)+/i', '', $s) ?? $s;
        $s = preg_replace('/(\s|<br\s*\/?>)+$/i', '', $s) ?? $s;

        return trim($s);
    }

    /**
     * Identical to the AbilityDescriptionResolver helper — resolves
     * `{{key}}` tokens against the stringtable, strips the rainbow
     * `<font>` wrappers, wraps the label in `<TFTKeyword>`. Kept as
     * a private copy rather than shared since the two resolvers have
     * different public APIs and no overlapping dependencies.
     */
    private function expandKeywordTokens(string $template, array $entries): string
    {
        return preg_replace_callback(
            '/\{\{([^}]+)\}\}/',
            function (array $match) use ($entries) {
                $token = trim($match[1]);
                $hashKey = RstHasher::key($token);
                $resolved = $entries[$hashKey] ?? null;

                if ($resolved === null) {
                    $parts = explode('_', $token);
                    $label = end($parts) ?: $token;
                } else {
                    $label = preg_replace('/<font[^>]*>|<\/font>/i', '', $resolved) ?? $resolved;
                    $label = trim($label);
                }

                return '<TFTKeyword>'.$label.'</TFTKeyword>';
            },
            $template,
        ) ?? $template;
    }

    /**
     * Replace runtime unit-property placeholders with static stand-ins.
     *
     * Two flavours show up in trait/spell templates:
     *
     *   - `@TFTUnitProperty.:SomeProp@` — numeric runtime stack the
     *     engine tracks (Bard's abducted friends, Nasus' bonus damage).
     *     Static tooltips render `0` because that's what the in-game
     *     tooltip shows at combat start.
     *
     *   - `@TFTUnitProperty.trait:TFT17_PsyOps_Item1@` — a reference to
     *     an item granted by the trait at this tier. We don't have a
     *     lookup table for which specific item (CDragon doesn't expose
     *     one), so we substitute a muted "[trait item]" placeholder
     *     wrapped in `<rules>` so the frontend styles it as secondary
     *     text. Players see the tier grants *an* item without a bogus
     *     name, and we avoid leaking the raw template string.
     */
    private function substituteUnitProperties(string $template): string
    {
        $template = preg_replace(
            '/@TFTUnitProperty\.trait:[A-Za-z0-9_]+@/',
            '<rules>[trait item]</rules>',
            $template,
        ) ?? $template;

        return preg_replace(
            '/@TFTUnitProperty\.:[A-Za-z0-9_]+(?:\*[0-9.]+)?@/',
            '0',
            $template,
        ) ?? $template;
    }
}
