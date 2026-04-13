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

        $resolved = $this->abilityResolver->resolve(
            $locKeys,
            $primarySpell['data_values'] ?? [],
            starLevel: 0,
            calculations: $primarySpell['calculations'] ?? [],
        );

        $template = $resolved['template'] ?? null;
        if ($template === null) {
            // Loc key didn't resolve in the stringtable — stale cache? —
            // leave en_us.json data untouched.
            return;
        }

        $champion->update([
            'ability_desc' => $template,
            'ability_stats' => $resolved['merged_stats'] ?? [],
        ]);
    }

    /**
     * Match the primary spell by trimming the spellNames reference down
     * to its bare name and comparing against each SpellObject's script
     * name. spellNames entries are binpath-like
     * (`Characters/TFT17_Jinx/Spells/TFT17_JinxSpell`) so we take the
     * last path segment and compare case-insensitively.
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

        return null;
    }
}
