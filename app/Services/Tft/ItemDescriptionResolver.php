<?php

namespace App\Services\Tft;

/**
 * Renders an item description template against its `effects` dict,
 * substituting `@Var@` / `@Var*N@` placeholders with the matching
 * effect value. Handles the same keyword/conditional/unit-property
 * tooltip conventions as TraitDescriptionResolver so items, traits
 * and champion abilities all surface through the same tokenisation
 * pipeline on the frontend.
 *
 * Item templates are simpler than trait templates — no `<row>`
 * per-tier blocks — but they do use:
 *   - `{{TFT_Keyword_Precision}}` flavour tokens
 *   - `<ShowIf.X>` / `<ShowIfNot.X>` conditional blocks
 *   - `<TFTRadiantItemBonus>` and `<rules>` styling wrappers
 *   - `%i:scaleAD%` inline icon markers
 *   - Plaintext numeric effect keys (`@AD*100@%` against `effects.AD`)
 */
class ItemDescriptionResolver
{
    public function __construct(
        private readonly StringtableCache $stringtable,
    ) {}

    /**
     * @param  array<string, mixed>  $effects
     * @return string|null  rendered description with placeholders resolved,
     *                      or null if the template was null/empty
     */
    public function resolve(
        ?string $description,
        array $effects,
        ?string $channel = null,
        string $locale = 'en_us',
    ): ?string {
        if ($description === null || $description === '') {
            return null;
        }

        $channel ??= (string) config('services.cdragon.channel', 'latest');
        $entries = $this->stringtable->entries($channel, $locale);

        $template = $this->expandKeywordTokens($description, $entries);
        $template = $this->substituteUnitProperties($template);
        $template = $this->collapseConditionalBlocks($template);

        return $this->renderTemplate($template, $effects);
    }

    /**
     * Substitute `@Name@` / `@Name*Multiplier@` placeholders against the
     * effects dict. Unknown placeholders pass through untouched so the
     * frontend can still render them literally (and so we notice which
     * ones are missing during audit).
     */
    private function renderTemplate(string $template, array $effects): string
    {
        $lower = [];
        foreach ($effects as $k => $v) {
            $lower[strtolower((string) $k)] = $v;
        }

        // The optional `%` after the numeric multiplier (observed in
        // `@PctMaxHP*100%@`) is a display hint Riot uses to indicate
        // "render this as a percent". It doesn't affect the math so we
        // match-and-ignore it — the actual numeric display comes from
        // formatNumber and whatever `%` character the template has
        // outside the placeholder.
        return preg_replace_callback(
            '/@([A-Za-z_][A-Za-z0-9_]*)(\*([0-9.]+)%?)?@/',
            function (array $match) use ($effects, $lower) {
                $var = $match[1];
                $multiplier = isset($match[3]) ? (float) $match[3] : 1.0;

                $value = $effects[$var] ?? $lower[strtolower($var)] ?? null;
                if (! is_numeric($value)) {
                    return $match[0];
                }

                return $this->formatNumber(((float) $value) * $multiplier);
            },
            $template,
        ) ?? $template;
    }

    private function formatNumber(float $value): string
    {
        $fractional = abs($value - round($value));
        if ($fractional < 0.01) {
            return (string) (int) round($value);
        }

        return rtrim(rtrim(number_format($value, 2, '.', ''), '0'), '.');
    }

    /**
     * Resolve `{{key}}` stringtable tokens to their plain label wrapped
     * in `<TFTKeyword>`. Identical behaviour to TraitDescriptionResolver;
     * the two helpers stay in sync by convention rather than sharing code
     * so each resolver can evolve independently as new shapes show up.
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
     * Drop `<ShowIfNot.X>` blocks and unwrap `<ShowIf.X>` so items that
     * carry dual-branch tooltips (radiant variants, trait-synergy items)
     * render only the enabled variant instead of duplicating text.
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
     * Same convention as TraitDescriptionResolver: `.:` runtime stacks
     * collapse to `0`, `.trait:` trait-item refs to a muted placeholder.
     */
    private function substituteUnitProperties(string $template): string
    {
        // `.item:TFT_Item_Artifact_LichBane_Damage` references the holder's
        // own stacked damage buff. We can't compute the scaling here
        // (it's stage-based, runtime-only), so substitute a muted
        // placeholder that tells the player "scales with stage" via
        // the adjoining `<tftitemrules>` text.
        $template = preg_replace(
            '/@TFTUnitProperty\.item:[A-Za-z0-9_]+@/',
            '<rules>(scales)</rules>',
            $template,
        ) ?? $template;

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
