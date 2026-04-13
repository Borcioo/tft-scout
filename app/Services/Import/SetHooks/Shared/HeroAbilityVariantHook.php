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
 * Turn Hero Augment alternative spells into champion variants, using
 * the same variant pattern MF / Mecha already use.
 *
 * Background
 * ----------
 * Several TFT17 champions ship a second SpellObject in their character
 * bin named `{primaryScriptName}Hero` — Aatrox's "Stellar Combo" is
 * the visible example. The hero form carries a fully separate template
 * (Strike/Sweep/Slam rotation), DataValues, and mSpellCalculations. In
 * game it's gated on picking up a specific Hero Augment.
 *
 * Architecturally it's indistinguishable from MF's Conduit/Challenger/
 * Replicator forms (TraitClone variants) or Mecha Enhanced pairings:
 * one champion → several Champion rows linked by base_champion_id,
 * each with its own ability text, shown in the detail page's variant
 * selector. This hook creates one extra variant row per champion that
 * has a hero spell.
 *
 * Runs after CharacterAbilityEnrichHook (which fills primary ability
 * data) and after VariantChoiceHook (which handles TraitClone variants)
 * so MF base isn't confused with a hero candidate. Unlike
 * VariantChoiceHook, this hook does NOT demote the base — the base
 * champion stays playable because the hero form is an optional
 * upgrade, not a mandatory pick.
 */
class HeroAbilityVariantHook implements PostImportHook
{
    public function __construct(
        private readonly CharacterBinInspector $inspector,
        private readonly AbilityDescriptionResolver $abilityResolver,
    ) {}

    public function name(): string
    {
        return 'HeroAbilityVariant';
    }

    public function run(Set $set): void
    {
        $baseChampions = Champion::query()
            ->where('set_id', $set->id)
            ->whereNull('base_champion_id')
            ->get();

        foreach ($baseChampions as $base) {
            $this->tryCreateHeroVariant($base, $set);
        }
    }

    /**
     * Look at the champion's bin spells for a `{primary}Hero` sibling.
     * When found, resolve its description + stats and create a new
     * variant Champion row with the same base stats but the hero
     * ability data. Missing hero spell is silently skipped — most
     * champions don't have one.
     */
    private function tryCreateHeroVariant(Champion $base, Set $set): void
    {
        try {
            $report = $this->inspector->inspect($base->api_name);
        } catch (Throwable $e) {
            Log::warning("HeroAbilityVariantHook: inspect failed for {$base->api_name}: ".$e->getMessage());

            return;
        }

        $spells = $report['main']['spells'] ?? [];
        $spellNames = $report['main']['spell_names'] ?? [];
        if (empty($spells)) {
            return;
        }

        $primaryRef = $spellNames[0] ?? ($base->api_name.'Spell');

        $primarySpell = $this->findPrimarySpell($spells, $primaryRef);
        if ($primarySpell === null) {
            return;
        }

        $heroSpell = $this->findHeroSibling($spells, $primarySpell['script_name'] ?? '');
        if ($heroSpell === null) {
            return;
        }

        $heroLocKeys = $heroSpell['loc_keys'] ?? ['key_name' => null, 'key_tooltip' => null];
        if (($heroLocKeys['key_tooltip'] ?? null) === null) {
            return;
        }

        $resolved = $this->abilityResolver->resolve(
            $heroLocKeys,
            $heroSpell['data_values'] ?? [],
            starLevel: 0,
            calculations: $heroSpell['calculations'] ?? [],
            championStats: [
                1 => (float) $base->armor,
                2 => (float) $base->attack_damage,
                4 => (float) $base->attack_speed,
                6 => (float) $base->magic_resist,
                11 => (float) $base->magic_resist,
                12 => (float) $base->hp,
                31 => (float) $base->range,
            ],
        );

        $heroTemplate = $resolved['template'] ?? null;
        if ($heroTemplate === null) {
            return;
        }

        $this->createHeroVariant($base, $resolved['name'] ?? null, $heroTemplate, $resolved['merged_stats'] ?? []);
    }

    /**
     * Spawn the variant row. Copies every base stat and trait pivot,
     * overrides ability text with the hero resolution, and labels it
     * `hero` so the frontend picks a distinct badge and slug.
     *
     * Unlike VariantChoiceHook, we keep the base playable — the hero
     * form is an optional upgrade tied to a Hero Augment pickup, not
     * a mandatory form selection.
     */
    private function createHeroVariant(
        Champion $base,
        ?string $heroName,
        string $heroTemplate,
        array $heroStats,
    ): void {
        $variant = Champion::create([
            'set_id' => $base->set_id,
            'api_name' => $base->api_name.'_hero',
            // Prefer the resolved spell name ("Stellar Combo") — falls
            // back to a generic "(Hero)" suffix when RST doesn't have
            // the keyName entry for this spell.
            'name' => $heroName !== null
                ? $base->name.' ('.$heroName.')'
                : $base->name.' (Hero)',
            'cost' => $base->cost,
            'slots_used' => $base->slots_used,

            // Hero form inherits combat role from base — same stats,
            // different ability.
            'role' => $base->role,
            'damage_type' => $base->damage_type,
            'role_category' => $base->role_category,

            'is_playable' => true,

            'hp' => $base->hp,
            'armor' => $base->armor,
            'magic_resist' => $base->magic_resist,
            'attack_damage' => $base->attack_damage,
            'attack_speed' => $base->attack_speed,
            'mana' => $base->mana,
            'start_mana' => $base->start_mana,
            'range' => $base->range,
            'crit_chance' => $base->crit_chance,
            'crit_multiplier' => $base->crit_multiplier,

            'ability_desc' => $heroTemplate,
            'ability_name' => $heroName,
            // Hero spell icons are not exposed by CDragon's en_us.json, so
            // we reuse the base champion's ability icon for now — the hero
            // form is still visually distinguishable via its variant badge.
            'ability_icon_path' => $base->ability_icon_path,
            'ability_stats' => $heroStats,

            'base_champion_id' => $base->id,
            'variant_label' => 'hero',

            'planner_code' => $base->planner_code,
            'icon_path' => $base->icon_path,
        ]);

        // Hero variant shares the base's trait pivot — copy verbatim so
        // planner filters by trait still find both forms.
        $traitIds = $base->traits()->pluck('traits.id')->all();
        if (! empty($traitIds)) {
            $variant->traits()->sync($traitIds);
        }
    }

    /**
     * Same matching ladder as CharacterAbilityEnrichHook: exact script
     * name, or the `spell`-suffixed fallback for champions whose
     * spellNames[0] is just the bare champion prefix (Aatrox).
     *
     * @param  list<array<string, mixed>>  $spells
     */
    private function findPrimarySpell(array $spells, string $primarySpellRef): ?array
    {
        $target = strtolower(basename(str_replace('\\', '/', $primarySpellRef)));

        foreach ($spells as $spell) {
            $name = $spell['script_name'] ?? null;
            if (is_string($name) && strtolower($name) === $target) {
                return $spell;
            }
        }

        if (! str_ends_with($target, 'spell')) {
            foreach ($spells as $spell) {
                $name = $spell['script_name'] ?? null;
                if (is_string($name) && strtolower($name) === $target.'spell') {
                    return $spell;
                }
            }
        }

        return null;
    }

    /**
     * Hero spell matching — script name is the primary's name with
     * `Hero` appended, so `TFT17_AatroxSpell` → `TFT17_AatroxSpellHero`.
     *
     * @param  list<array<string, mixed>>  $spells
     */
    private function findHeroSibling(array $spells, string $primaryScriptName): ?array
    {
        if ($primaryScriptName === '') {
            return null;
        }

        $target = strtolower($primaryScriptName).'hero';
        foreach ($spells as $spell) {
            $name = $spell['script_name'] ?? null;
            if (is_string($name) && strtolower($name) === $target) {
                return $spell;
            }
        }

        return null;
    }
}
