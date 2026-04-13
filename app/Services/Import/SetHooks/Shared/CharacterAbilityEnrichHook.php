<?php

namespace App\Services\Import\SetHooks\Shared;

use App\Models\Champion;
use App\Models\Set;
use App\Services\Import\Contracts\PostImportHook;
use App\Services\Tft\AbilityDescriptionResolver;
use App\Services\Tft\CharacterBinInspector;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Enrich base champions with their full ability data pulled straight
 * from the character BIN files, replacing the sparse en_us.json version
 * the main importer writes.
 *
 * Why this hook exists
 * --------------------
 * CDragon's `cdragon/tft/en_us.json` serves a minimal ability shape:
 * `{ name, desc, variables[] }`. The `variables` list is the spell's
 * raw DataValues — good enough for abilities whose description only
 * references DataValue names directly.
 *
 * But many champions (e.g. TFT17 Jinx) use descriptions like
 *   "Fire a barrage of @ModifiedNumRockets@ rockets, each dealing
 *    @TotalDamage@ physical damage..."
 * where `@TotalDamage@` is a calculated variable defined in
 * `mSpellCalculations` — NOT in DataValues. en_us.json doesn't expose
 * those, so the frontend renderer falls back to a `[TotalDamage]` stub.
 *
 * This hook pulls the full character BIN, walks its SpellObjects, and
 * lets AbilityDescriptionResolver compute the merged DataValues +
 * evaluated calculations. The resulting template + stat list replaces
 * whatever en_us.json wrote, so every champion renders the same way
 * variants already do.
 *
 * Runs before VariantChoiceHook so the inspector report cache is warm
 * by the time variants need it — VariantChoiceHook calls
 * `$inspector->inspect($base->api_name)` again and gets the cached
 * response instead of a second HTTP fetch.
 */
class CharacterAbilityEnrichHook implements PostImportHook
{
    public function __construct(
        private readonly CharacterBinInspector $inspector,
        private readonly AbilityDescriptionResolver $abilityResolver,
    ) {}

    public function name(): string
    {
        return 'CharacterAbilityEnrich';
    }

    public function run(Set $set): void
    {
        $baseChampions = Champion::query()
            ->where('set_id', $set->id)
            ->whereNull('base_champion_id')
            ->get();

        foreach ($baseChampions as $champion) {
            $this->enrichChampion($champion);
        }
    }

    /**
     * Fetch the champion's BIN, find its primary spell (the one referenced
     * by spellNames[0]), and overwrite ability_desc / ability_stats with
     * fully-resolved content. Any failure — 404, no loc keys, no matching
     * spell — is logged and left alone so en_us.json data stays in place.
     */
    private function enrichChampion(Champion $champion): void
    {
        try {
            $report = $this->inspector->inspect($champion->api_name);
        } catch (Throwable $e) {
            Log::warning("CharacterAbilityEnrichHook: inspect failed for {$champion->api_name}: ".$e->getMessage());

            return;
        }

        $main = $report['main'] ?? [];
        $spellNames = $main['spell_names'] ?? [];
        $spells = $main['spells'] ?? [];

        if (empty($spellNames) || empty($spells)) {
            return;
        }

        $primarySpell = $this->findPrimarySpell($spells, $spellNames[0]);
        if ($primarySpell === null) {
            return;
        }

        $locKeys = $primarySpell['loc_keys'] ?? ['key_name' => null, 'key_tooltip' => null];
        if ($locKeys['key_tooltip'] === null) {
            // No description key — nothing we can resolve beyond en_us.json.
            return;
        }

        $championStats = $this->buildChampionStatsForEvaluator($champion);

        $resolved = $this->abilityResolver->resolve(
            $locKeys,
            $primarySpell['data_values'] ?? [],
            starLevel: 0,
            calculations: $primarySpell['calculations'] ?? [],
            championStats: $championStats,
        );

        $template = $resolved['template'] ?? null;
        if ($template === null) {
            // Loc key didn't resolve in the stringtable — stale cache? —
            // leave en_us.json data untouched.
            return;
        }

        $update = [
            'ability_desc' => $template,
            'ability_stats' => $resolved['merged_stats'] ?? [],
        ];

        // Hero Augment form: several TFT17 champions ship a second
        // SpellObject named `{primaryScriptName}Hero` (Aatrox's
        // "Stellar Combo" → TFT17_AatroxSpellHero). If present, resolve
        // it the same way as the primary and store on the dedicated
        // `hero_ability` JSONB column so the frontend can render it as
        // a second section on the champion detail page.
        $heroAbility = $this->resolveHeroAbility(
            $spells,
            $primarySpell['script_name'] ?? '',
            $championStats,
        );
        if ($heroAbility !== null) {
            $update['hero_ability'] = $heroAbility;
        }

        $champion->update($update);
    }

    /**
     * Find `{primaryScriptName}Hero` in the same character bin and
     * resolve its description. Returns null when there's no hero spell
     * or its loc keys don't resolve.
     *
     * @param  list<array<string, mixed>>  $spells
     * @param  array<int, float>  $championStats
     * @return array{name: string|null, desc: string, stats: array}|null
     */
    private function resolveHeroAbility(
        array $spells,
        string $primaryScriptName,
        array $championStats,
    ): ?array {
        if ($primaryScriptName === '') {
            return null;
        }

        $heroTarget = strtolower($primaryScriptName).'hero';
        $heroSpell = $this->matchByScriptName($spells, $heroTarget);
        if ($heroSpell === null) {
            return null;
        }

        $heroLocKeys = $heroSpell['loc_keys'] ?? ['key_name' => null, 'key_tooltip' => null];
        if (($heroLocKeys['key_tooltip'] ?? null) === null) {
            return null;
        }

        $heroResolved = $this->abilityResolver->resolve(
            $heroLocKeys,
            $heroSpell['data_values'] ?? [],
            starLevel: 0,
            calculations: $heroSpell['calculations'] ?? [],
            championStats: $championStats,
        );

        $heroTemplate = $heroResolved['template'] ?? null;
        if ($heroTemplate === null) {
            return null;
        }

        return [
            'name' => $heroResolved['name'],
            'desc' => $heroTemplate,
            'stats' => $heroResolved['merged_stats'] ?? [],
        ];
    }

    /**
     * Build the mStat-enum → champion-stat-value map that
     * StatByCoefficientCalculationPart nodes need. Only the enums we've
     * empirically confirmed are populated; adding more as new spells
     * surface them costs one entry here each.
     *
     * mStat enum (empirical, TFT17):
     *   4 → attack_speed  (Jinx NumRockets formula)
     *
     * @return array<int, float>
     */
    private function buildChampionStatsForEvaluator(Champion $champion): array
    {
        return [
            4 => (float) $champion->attack_speed,
        ];
    }

    /**
     * Match the primary spell by trimming the spellNames reference down
     * to its bare name and comparing against each SpellObject's script
     * name. spellNames entries come in two shapes:
     *
     *   - Full binpath: `Characters/TFT17_Jinx/Spells/TFT17_JinxSpell`
     *     — basename gives `TFT17_JinxSpell`, which matches a script
     *     name exactly.
     *   - Bare champion prefix: `TFT17_Aatrox` — no binpath wrapper and
     *     no `Spell` suffix. We have to append `Spell` to land on the
     *     intended `TFT17_AatroxSpell` SpellObject.
     *
     * Fallback ladder: exact match → `target + Spell` match → null.
     *
     * @param  list<array<string, mixed>>  $spells
     */
    private function findPrimarySpell(array $spells, string $primarySpellRef): ?array
    {
        $target = strtolower(basename(str_replace('\\', '/', $primarySpellRef)));

        $match = $this->matchByScriptName($spells, $target);
        if ($match !== null) {
            return $match;
        }

        // Aatrox and friends whose spellNames[0] omits the `Spell` suffix —
        // try once more with it appended.
        if (! str_ends_with($target, 'spell')) {
            $match = $this->matchByScriptName($spells, $target.'spell');
            if ($match !== null) {
                return $match;
            }
        }

        return null;
    }

    /**
     * @param  list<array<string, mixed>>  $spells
     */
    private function matchByScriptName(array $spells, string $target): ?array
    {
        foreach ($spells as $spell) {
            $name = $spell['script_name'] ?? null;
            if (is_string($name) && strtolower($name) === $target) {
                return $spell;
            }
        }

        return null;
    }
}
