<?php

namespace App\Services\Import\SetHooks\Shared;

use App\Models\Champion;
use App\Models\Set;
use App\Models\TftTrait;
use App\Services\Import\Contracts\PostImportHook;
use App\Services\Tft\AbilityDescriptionResolver;
use App\Services\Tft\CharacterBinInspector;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Generic variant-choice hook: detects champions that have a selectable
 * trait variant (like Miss Fortune Set 17's Conduit/Challenger/Replicator)
 * and creates the appropriate variant Champion rows automatically.
 *
 * Detection is fully data-driven: we check each champion for a sibling
 * `{apiName}_TraitClone` character bin on CommunityDragon. If that file
 * exists, its `mLinkedTraits` list is the set of selectable variants for
 * this champion. See docs/research/tft-character-bins-mechanics.md for
 * the full story on how this was discovered.
 *
 * Replaces the old Set17/MissFortuneVariantsHook which hardcoded MF
 * specifically. This hook handles MF and any future champion with the
 * same mechanic (historical precedent: TFT15 Lee Sin also uses it).
 *
 * UX metadata (variant_label, role, damage_type, role_category) that
 * can't be derived from the BIN comes from `config/tft.php` keyed by
 * the variant trait api_name. Missing config = sensible defaults (label
 * derived from api_name, role fields null).
 */
class VariantChoiceHook implements PostImportHook
{
    public function __construct(
        private readonly CharacterBinInspector $inspector,
        private readonly AbilityDescriptionResolver $abilityResolver,
    ) {}

    public function name(): string
    {
        return 'VariantChoice';
    }

    public function run(Set $set): void
    {
        $baseChampions = Champion::query()
            ->where('set_id', $set->id)
            ->whereNull('base_champion_id')
            ->get();

        foreach ($baseChampions as $base) {
            $this->processChampion($base, $set);
        }
    }

    /**
     * Inspect one champion. If it has a TraitClone sibling, demote it to
     * non-playable and create one variant per TraitClone linked trait.
     * Any inspection failure is logged but does not abort the import —
     * a broken fetch for one champion shouldn't nuke the whole set.
     */
    private function processChampion(Champion $base, Set $set): void
    {
        try {
            $report = $this->inspector->inspect($base->api_name);
        } catch (Throwable $e) {
            Log::warning("VariantChoiceHook: inspect failed for {$base->api_name}: ".$e->getMessage());

            return;
        }

        if (! ($report['has_variant_choice'] ?? false)) {
            return;
        }

        $variantTraitApiNames = collect($report['trait_clone']['linked_traits'] ?? [])
            ->pluck('api_name')
            ->filter()
            ->values()
            ->all();

        if (empty($variantTraitApiNames)) {
            Log::warning("VariantChoiceHook: {$base->api_name} has TraitClone but no resolvable variant traits");

            return;
        }

        // Base champion becomes an "abstract" record — the player has to
        // pick a variant to actually field the unit. It stays in the DB
        // because ratings and pivot FKs still reference it, but it won't
        // appear as a selectable champion in the planner.
        $base->update(['is_playable' => false]);

        $baseKeepTraits = $this->resolveBaseKeepTraits($base, $set);
        $mainSpells = $report['main']['spells'] ?? [];

        foreach ($variantTraitApiNames as $variantTraitApiName) {
            $this->createVariant($base, $set, $variantTraitApiName, $baseKeepTraits, $mainSpells);
        }
    }

    /**
     * Keep the base champion's public/unique traits for the variant (so
     * every variant still has its signature Unique trait), but drop any
     * hidden placeholder traits like `*UndeterminedTrait` that only exist
     * to represent "not yet chosen" state in the game engine.
     *
     * @return array<int> Trait IDs to attach alongside the variant trait
     */
    private function resolveBaseKeepTraits(Champion $base, Set $set): array
    {
        return TftTrait::query()
            ->where('set_id', $set->id)
            ->whereIn('id', $base->traits()->pluck('traits.id'))
            ->where('category', '!=', 'hidden')
            ->pluck('id')
            ->all();
    }

    private function createVariant(
        Champion $base,
        Set $set,
        string $variantTraitApiName,
        array $baseKeepTraitIds,
        array $mainSpells,
    ): void {
        $override = config("tft.variant_overrides.{$variantTraitApiName}", []);
        $variantLabel = $override['variant_label'] ?? $this->deriveLabel($variantTraitApiName);

        // Try to pull per-variant ability text from the BIN's stance spell.
        // Each variant has its own SpellObject with its own loc keys — these
        // resolve to distinct descriptions like "Conduit Mode" / "Challenger
        // Mode" / "Replicator Mode", rather than inheriting the base's
        // meta-description ("Field Miss Fortune to choose...").
        $ability = $this->resolveVariantAbility(
            $mainSpells,
            $override['stance_spell'] ?? null,
            $base,
        );

        $variant = Champion::create([
            'set_id' => $base->set_id,
            'api_name' => $base->api_name.'_'.$variantLabel,
            'name' => $base->name.' ('.ucfirst($variantLabel).')',
            'cost' => $base->cost,
            'slots_used' => $base->slots_used,

            // Role metadata from config override — null falls through
            // gracefully if unset.
            'role' => $override['role'] ?? null,
            'damage_type' => $override['damage_type'] ?? null,
            'role_category' => $override['role_category'] ?? null,

            'is_playable' => true,

            // Stats copied verbatim — BIN files show clone has different
            // numbers but those are internal meta-stats, not what players see.
            // Base's stats came from en_us.json and are the ones UI displays.
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

            'ability_desc' => $ability['desc'],
            'ability_name' => $ability['name'],
            // MF stance spells share the base's ability icon — Riot doesn't
            // ship per-variant artwork in the public asset tree.
            'ability_icon_path' => $base->ability_icon_path,
            'ability_stats' => $ability['stats'],

            'base_champion_id' => $base->id,
            'variant_label' => $variantLabel,

            'planner_code' => $base->planner_code,
            'icon_path' => $base->icon_path,
        ]);

        // Attach the variant's own trait plus whatever the base keeps
        // (Unique traits stay, hidden placeholders drop).
        $variantTraitId = TftTrait::query()
            ->where('set_id', $set->id)
            ->where('api_name', $variantTraitApiName)
            ->value('id');

        $traitIds = array_values(array_unique(array_merge(
            $baseKeepTraitIds,
            $variantTraitId !== null ? [$variantTraitId] : [],
        )));

        if (! empty($traitIds)) {
            $variant->traits()->sync($traitIds);
        }
    }

    /**
     * Look up a variant's own ability description + data values from the
     * spells list extracted by CharacterBinInspector. Returns a shape
     * matching existing `ability_desc` / `ability_stats` columns:
     *   - desc: template string with @var@ placeholders (frontend renders)
     *   - stats: [{name, value: []}] matching en_us.json format
     *
     * Falls back to the base champion's ability_desc/stats when the stance
     * spell isn't found or has no loc keys — that way champions without
     * per-variant text still land with the meta description from en_us.json.
     *
     * @param  list<array<string, mixed>>  $mainSpells  from inspector report
     * @return array{desc: string|null, name: string|null, stats: array}
     */
    private function resolveVariantAbility(
        array $mainSpells,
        ?string $stanceSpellSuffix,
        Champion $base,
    ): array {
        $fallback = [
            'desc' => $base->ability_desc,
            'name' => $base->ability_name,
            'stats' => $base->ability_stats ?? [],
        ];

        if ($stanceSpellSuffix === null) {
            return $fallback;
        }

        $match = $this->findStanceSpell($mainSpells, $stanceSpellSuffix);
        if ($match === null) {
            return $fallback;
        }

        // Resolve the template from stringtable and merge data values
        // with evaluated spell calculations. We store the TEMPLATE (not
        // rendered), so the frontend can render per star level at
        // display time. The merged stats list includes both raw
        // DataValues and calculated values (@TotalDamage@ etc.) so the
        // frontend has everything it needs for placeholder substitution.
        $resolved = $this->abilityResolver->resolve(
            $match['loc_keys'] ?? ['key_name' => null, 'key_tooltip' => null],
            $match['data_values'] ?? [],
            starLevel: 0,
            calculations: $match['calculations'] ?? [],
            championStats: [
                // mStat enum convention documented in CharacterAbilityEnrichHook.
                1 => (float) $base->armor,
                2 => (float) $base->attack_damage,
                4 => (float) $base->attack_speed,
                6 => (float) $base->magic_resist,
                11 => (float) $base->magic_resist,
                12 => (float) $base->hp,
                31 => (float) $base->range,
            ],
        );

        $template = $resolved['template'] ?? null;
        if ($template === null) {
            return $fallback;
        }

        return [
            'desc' => $template,
            'name' => $resolved['name'] ?? $base->ability_name,
            'stats' => $resolved['merged_stats'] ?? [],
        ];
    }

    /**
     * Find a SpellObject in the main bin whose script_name ends with the
     * given suffix. Suffix is matched case-insensitively so config can
     * use PascalCase without worrying about Riot's exact capitalisation.
     *
     * @param  list<array<string, mixed>>  $spells
     */
    private function findStanceSpell(array $spells, string $suffix): ?array
    {
        $suffixLower = strtolower($suffix);
        foreach ($spells as $spell) {
            $name = $spell['script_name'] ?? null;
            if (! is_string($name)) {
                continue;
            }
            if (str_ends_with(strtolower($name), $suffixLower)) {
                return $spell;
            }
        }

        return null;
    }

    /**
     * Fallback label when config has no override: strip the `TFT{N}_`
     * prefix and `Trait` suffix, lowercase the rest.
     * E.g. "TFT17_ManaTrait" → "mana".
     */
    private function deriveLabel(string $apiName): string
    {
        $stripped = preg_replace('/^TFT\d+_/', '', $apiName);
        $stripped = preg_replace('/Trait$/', '', $stripped);

        return strtolower($stripped);
    }
}
