<?php

namespace App\Services\Import;

use App\Models\Augment;
use App\Models\Champion;
use App\Models\Emblem;
use App\Models\Item;
use App\Models\Set;
use App\Models\TftTrait;
use App\Services\Import\Contracts\PostImportHook;
use App\Services\Import\SetHooks\Set17\MechaEnhancedHook;
use App\Services\Import\SetHooks\Set17\RemoveNonPlayableHook;
use App\Services\Import\SetHooks\Shared\CharacterAbilityEnrichHook;
use App\Services\Import\SetHooks\Shared\HeroAbilityVariantHook;
use App\Services\Import\SetHooks\Shared\VariantChoiceHook;
use Illuminate\Contracts\Console\Kernel as ConsoleKernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * Imports TFT data from CommunityDragon PBE endpoint.
 *
 * Flow:
 *   1. Fetch CDragon JSON + planner codes (HTTP, no DB)
 *   2. Open transaction
 *   3. Upsert Set record
 *   4. Clear existing set-scoped data (champions/traits/items/augments/emblems)
 *   5. Import traits + breakpoints
 *   6. Import base champions with their pivoted traits
 *   7. Import items (split into items/augments/emblems, filter historical cruft)
 *   8. Run set-specific PostImportHooks (variants, enhanced forms)
 *   9. Mark Set.imported_at
 *  10. Return counts
 *
 * All DB work is in a single transaction — a failure rolls back everything,
 * no partial state. Hooks run inside the same transaction for consistency.
 */
class CDragonImporter
{
    private const CDRAGON_BASE = 'https://raw.communitydragon.org/pbe';

    private const DATA_URL = self::CDRAGON_BASE.'/cdragon/tft/en_us.json';

    private const PLANNER_URL = self::CDRAGON_BASE.'/plugins/rcp-be-lol-game-data/global/default/v1/tftchampions-teamplanner.json';

    /**
     * Set number → array of PostImportHook class names, in execution order.
     * Add new sets here when they release.
     */
    /**
     * Hook order matters — run CharacterAbilityEnrichHook BEFORE
     * VariantChoiceHook so the inspector's in-memory report cache is
     * warm by the time variants need the same character data; this
     * halves HTTP traffic for variant champions.
     *
     * CharacterAbilityEnrichHook and VariantChoiceHook are both generic
     * and run for every set. The remaining hooks are set-specific
     * quirks that can't be data-driven yet.
     */
    private const SET_HOOKS = [
        17 => [
            RemoveNonPlayableHook::class,
            CharacterAbilityEnrichHook::class,
            VariantChoiceHook::class,
            HeroAbilityVariantHook::class,
            MechaEnhancedHook::class,
        ],
    ];

    /**
     * Hidden trait api_name patterns — traits that exist in CDragon data but
     * should NOT be shown in UI as selectable/displayable traits.
     *
     * CORRECTION from schema-plan.md Problem #8: earlier heuristic wrongly
     * classified game-internal api_names like TFT17_FlexTrait (display name
     * "Voyager"), TFT17_HPTank ("Brawler"), TFT17_ResistTank ("Bastion") as
     * hidden. These are REAL player-facing traits — Riot just uses different
     * internal api_names than display names. After this fix they stay public.
     *
     * Only genuine non-player traits are hidden:
     *  - Undetermined: placeholder for "pick your form" mechanic (MF's Choose Trait)
     *  - CarouselMarket: Carousel mechanic hex effects (God-Blessed)
     *  - Stargazer_X: runtime sign variants of base Stargazer
     *    (Wolf/Serpent/Huntress/Medallion/Shield/Fountain/Mountain) —
     *    pattern ends with underscore so it matches TFT17_Stargazer_Wolf
     *    but NOT base TFT17_Stargazer
     */
    private const HIDDEN_TRAIT_PATTERNS = [
        'Undetermined',
        'CarouselMarket',
        'Stargazer_',
    ];

    /** Components pending resolution in second pass: itemId → [c1ApiName, c2ApiName] */
    private array $pendingComponents = [];

    /** @var array<int, array{string, string}>  emblem_id → [c1_apiName, c2_apiName] */
    private array $pendingEmblemComponents = [];

    public function __construct(private readonly ConsoleKernel $console) {}

    /**
     * Main entry point. Runs the full import flow for a set.
     *
     * @return array<string, int> Counts per entity
     */
    public function import(int $setNumber): array
    {
        $data = $this->fetchData();
        $plannerCodes = $this->fetchPlannerCodes($setNumber);

        if (! isset($data['sets'][(string) $setNumber])) {
            throw new RuntimeException("Set {$setNumber} not found in CDragon data");
        }

        $setData = $data['sets'][(string) $setNumber];

        $set = DB::transaction(function () use ($setNumber, $setData, $data, $plannerCodes) {
            $set = $this->upsertSet($setNumber, $setData);
            $this->clearSetData($set);

            $traitMap = $this->importTraits($set, $setData['traits'] ?? []);
            $this->importChampions($set, $setData['champions'] ?? [], $traitMap, $plannerCodes, $setNumber);
            $this->importItems($data['items'] ?? [], $setNumber, $set);
            $this->resolveItemComponents();

            $this->runHooks($set);

            $set->update(['imported_at' => now()]);

            return $set;
        });

        // Icon downloads run AFTER the transaction — HTTP is slow and unpredictable,
        // and failed downloads should never roll back imported data. Existing icons
        // are skipped, so re-runs are fast (HEAD-check on filesystem only).
        $this->downloadChampionIcons($set);
        $this->downloadAbilityIcons($set);
        $this->downloadTraitIcons($set);
        $this->downloadItemIcons();

        return $this->getCounts($set);
    }

    // ── HTTP fetching ───────────────────────────────────────

    private function fetchData(): array
    {
        $response = Http::timeout(60)->get(self::DATA_URL);

        if ($response->failed()) {
            throw new RuntimeException('CDragon data fetch failed: HTTP '.$response->status());
        }

        return $response->json();
    }

    /**
     * Planner codes map champion apiName → numeric code used by TFT Team Planner
     * for share URLs. Separate endpoint from the main CDragon data.
     */
    private function fetchPlannerCodes(int $setNumber): array
    {
        $response = Http::timeout(30)->get(self::PLANNER_URL);

        if ($response->failed()) {
            return []; // Planner codes are optional; import continues without them
        }

        $data = $response->json();
        $setChamps = $data['TFTSet'.$setNumber] ?? [];

        $codes = [];
        foreach ($setChamps as $champ) {
            if (isset($champ['character_id'], $champ['team_planner_code'])) {
                $codes[$champ['character_id']] = $champ['team_planner_code'];
            }
        }

        return $codes;
    }

    // ── Set record ──────────────────────────────────────────

    private function upsertSet(int $setNumber, array $setData): Set
    {
        return Set::updateOrCreate(
            ['number' => $setNumber],
            [
                'name' => $setData['name'] ?? "Set {$setNumber}",
                'mutator' => $setData['mutator'] ?? null,
                'is_active' => true, // Current import is always active set
            ]
        );
    }

    private function clearSetData(Set $set): void
    {
        // Order matters for FK constraints, though cascades handle most children.
        // Champions first (pivot to traits cascades), then traits (breakpoints cascade).
        Champion::where('set_id', $set->id)->delete();
        TftTrait::where('set_id', $set->id)->delete();
        Augment::where('set_id', $set->id)->delete();
        Emblem::where('set_id', $set->id)->delete();
        Item::where('set_id', $set->id)->delete(); // set-scoped only; cross-set items upserted

        // Stale evergreen rows from previous imports that are now skipped.
        // updateOrCreate doesn't delete rows we no longer want, so we
        // explicitly drop the patterns shouldSkipItem() filters out:
        //   - `TFT_Item_Corrupted*` byte-identical duplicates
        //   - `TFT5_Item_*SpatulaItem_Radiant` Set 5 spatula radiants
        //     that don't link to any current-set base item
        Item::where('api_name', 'like', 'TFT_Item_Corrupted%')->delete();
        Item::where('api_name', 'like', 'TFT5_Item_%SpatulaItem_Radiant')->delete();
        Item::where('name', 'like', 'tft_item_name_%')->delete();

        // Older imports populated the items table with cross-set junk
        // (TFT13_Crime_*, TFT13_ChampionItem_*, TFT16_Item_*) before
        // shouldSkipItem was tightened. Those rows never get re-imported
        // but also never get cleared by `where(set_id)`, so wipe every
        // legacy `TFT{N}_*` row that doesn't belong to the current set
        // or to the cross-set radiant whitelist.
        $current = "TFT{$set->number}_";
        Item::query()
            ->where('api_name', 'like', 'TFT%')
            ->where('api_name', 'not like', 'TFT_Item_%')
            ->where('api_name', 'not like', $current.'%')
            ->where('api_name', 'not like', 'TFT5_Item_%Radiant')
            ->delete();
    }

    // ── Traits import ───────────────────────────────────────

    /**
     * @return array<string, int> Trait lookup map: apiName AND name → trait ID.
     *                            Dual indexing allows champion.traits array (which
     *                            uses names, not apiNames) to resolve to IDs.
     */
    private function importTraits(Set $set, array $traitsData): array
    {
        $map = [];

        foreach ($traitsData as $traitData) {
            $apiName = $traitData['apiName'] ?? null;
            $name = $traitData['name'] ?? null;

            if (! $apiName || ! $name) {
                continue;
            }

            $category = $this->determineTraitCategory($apiName, $name);
            $breakpoints = array_values(array_filter(
                $traitData['effects'] ?? [],
                fn ($effect) => isset($effect['minUnits'])
            ));

            $isUnique = count($breakpoints) === 1
                && ($breakpoints[0]['minUnits'] ?? 0) === 1;

            $trait = TftTrait::create([
                'set_id' => $set->id,
                'api_name' => $apiName,
                'name' => $name,
                'description' => $traitData['desc'] ?? '',
                'icon_path' => $traitData['icon'] ?? null,
                'category' => $category === 'unique' || $isUnique ? 'unique' : $category,
                'is_unique' => $category === 'unique' || $isUnique,
            ]);

            // Effects come from CDragon with hashed variable keys
            // ({c02c4568}) for many traits — Riot ships the BIN hashes
            // instead of plaintext names. We reverse-lookup the placeholder
            // names referenced in the description template (e.g.
            // `@InnateManaGain@`) via FNV-1a, same trick we use for
            // champion spell calculations. Keys that still don't match
            // any placeholder get dropped (pure noise), but resolved
            // keys survive with their human-readable names.
            $hashToName = $this->buildPlaceholderHashMap($traitData['desc'] ?? '');

            foreach ($breakpoints as $i => $bp) {
                $trait->breakpoints()->create([
                    'position' => $i + 1,
                    'min_units' => $bp['minUnits'],
                    'max_units' => $bp['maxUnits'] ?? 25000,
                    'style_id' => $bp['style'] ?? 1,
                    'effects' => $this->resolveTraitEffectKeys(
                        $bp['variables'] ?? [],
                        $hashToName,
                    ),
                ]);
            }

            // Dual indexing for champion.traits lookup
            $map[$apiName] = $trait->id;
            $map[$name] = $trait->id;
        }

        return $map;
    }

    /**
     * HEURISTIC: trait category detection.
     * - Contains "Unique" → unique (per-champion individual trait)
     * - Matches hidden patterns (HPTank, ResistTank, etc.) → hidden
     * - Otherwise → public
     */
    private function determineTraitCategory(string $apiName, string $name): string
    {
        if (str_contains($apiName, 'UniqueTrait') || str_contains($apiName, 'Unique')) {
            return 'unique';
        }

        foreach (self::HIDDEN_TRAIT_PATTERNS as $pattern) {
            if (str_contains($apiName, $pattern)) {
                return 'hidden';
            }
        }

        return 'public';
    }

    // ── Champions import ────────────────────────────────────

    private function importChampions(
        Set $set,
        array $champsData,
        array $traitMap,
        array $plannerCodes,
        int $setNumber
    ): void {
        $prefix = "TFT{$setNumber}_";

        foreach ($champsData as $champData) {
            $apiName = $champData['apiName'] ?? null;
            $cost = $champData['cost'] ?? 0;

            // Skip non-set champions and invalid cost
            if (! $apiName || ! str_starts_with($apiName, $prefix)) {
                continue;
            }
            if ($cost <= 0 || $cost > 10) {
                continue;
            }

            $roleInfo = $this->parseRole($champData['role'] ?? null);
            $stats = $champData['stats'] ?? [];

            $champion = Champion::create([
                'set_id' => $set->id,
                'api_name' => $apiName,
                'name' => $champData['name'] ?? $apiName,
                'cost' => $cost,
                'slots_used' => 1,
                'role' => $roleInfo['role'],
                'damage_type' => $roleInfo['damage_type'],
                'role_category' => $roleInfo['role_category'],
                'is_playable' => true,

                'hp' => $stats['hp'] ?? 0,
                'armor' => $stats['armor'] ?? 0,
                'magic_resist' => $stats['magicResist'] ?? 0,
                'attack_damage' => $stats['damage'] ?? 0,
                'attack_speed' => $stats['attackSpeed'] ?? 0,
                'mana' => $stats['mana'] ?? 0,
                'start_mana' => $stats['initialMana'] ?? 0,
                'range' => $stats['range'] ?? 0,
                'crit_chance' => $stats['critChance'] ?? 0.25,
                'crit_multiplier' => $stats['critMultiplier'] ?? 1.4,

                'ability_desc' => $champData['ability']['desc'] ?? null,
                'ability_name' => $champData['ability']['name'] ?? null,
                'ability_icon_path' => $champData['ability']['icon'] ?? null,
                'ability_stats' => $champData['ability']['variables'] ?? [],

                'planner_code' => $plannerCodes[$apiName] ?? null,
                'icon_path' => $champData['squareIcon'] ?? $champData['icon'] ?? null,
            ]);

            // Attach traits via pivot. CDragon champion.traits contains trait NAMES
            // ("Mecha", "Brawler"), not apiNames — traitMap handles both.
            $traitIds = [];
            foreach ($champData['traits'] ?? [] as $traitRef) {
                if (isset($traitMap[$traitRef])) {
                    $traitIds[] = $traitMap[$traitRef];
                }
            }

            if (! empty($traitIds)) {
                $champion->traits()->sync(array_unique($traitIds));
            }
        }
    }

    /**
     * Parse "ADFighter" → ["role" => "ADFighter", "damage_type" => "AD", "role_category" => "Fighter"]
     * Recognized damage types: AD (physical), AP (magic), H (hybrid)
     */
    private function parseRole(?string $role): array
    {
        if (! $role) {
            return ['role' => null, 'damage_type' => null, 'role_category' => null];
        }

        if (preg_match('/^(AD|AP|H)(.+)$/', $role, $m)) {
            return [
                'role' => $role,
                'damage_type' => $m[1],
                'role_category' => $m[2],
            ];
        }

        return ['role' => $role, 'damage_type' => null, 'role_category' => null];
    }

    // ── Items / Augments / Emblems import ───────────────────

    private function importItems(array $items, int $setNumber, Set $set): void
    {
        foreach ($items as $itemData) {
            $apiName = $itemData['apiName'] ?? null;
            $name = $itemData['name'] ?? null;

            if (! $apiName || ! $name) {
                continue;
            }

            if ($this->shouldSkipItem($itemData, $setNumber)) {
                continue;
            }

            // Classification: augment / emblem / regular item
            if ($this->isAugment($apiName)) {
                $this->createAugment($itemData, $set);

                continue;
            }

            if ($this->isEmblem($itemData)) {
                $this->createEmblem($itemData, $set);

                continue;
            }

            $this->createItem($itemData, $set);
        }
    }

    /**
     * HEURISTIC: filter out historical cruft (~84% of CDragon items data).
     *
     * Whitelist approach — we explicitly allow known good prefixes and
     * reject everything else. This excludes Set 17 mechanics like
     * TFT17_CarouselMarket_*, TFT17_TraitEffect_*, hex effects etc.
     * that pollute the items table with non-equipable "items".
     *
     * Exceptions: items with associatedTraits or Emblem tag pass regardless
     * of apiName prefix — they get routed to the emblems table downstream.
     */
    private function shouldSkipItem(array $itemData, int $setNumber): bool
    {
        $apiName = $itemData['apiName'] ?? '';
        $name = $itemData['name'] ?? '';
        $tags = $itemData['tags'] ?? [];
        $associatedTraits = $itemData['associatedTraits'] ?? [];

        // Untranslated stub items: Riot ships items whose display name
        // is still the raw localisation key (`tft_item_name_CursedBlade`,
        // `tft_item_name_HextechChestguard`). These are deprecated/hidden
        // items kept in the data file for engine compatibility but never
        // shown in-game — drop them so the UI doesn't render placeholder
        // names players have never seen.
        if (str_starts_with($name, 'tft_item_name_')) {
            return true;
        }

        // Emblems can have non-standard apiName prefixes — let them through
        // regardless. Excludes augments explicitly because trait-gated augments
        // ALSO carry associatedTraits but must follow the per-set whitelist.
        //
        // Scope check: historical sets ship their own emblems under
        // `TFT{N}_Item_*EmblemItem` and they all carry the Emblem tag +
        // associatedTraits, so a naive pass-through would import every
        // set's emblems (Duelist from Set 4/15 showing up in Set 17).
        // Restrict by requiring the api_name prefix or the associated
        // trait to point at the current set.
        $isAugmentName = str_contains($apiName, '_Augment_');
        $looksLikeEmblem = ! $isAugmentName
            && (in_array('Emblem', $tags, true) || ! empty($associatedTraits));
        if ($looksLikeEmblem) {
            $currentPrefix = "TFT{$setNumber}_";
            $fromCurrentSet = str_starts_with($apiName, $currentPrefix)
                || (isset($associatedTraits[0])
                    && is_string($associatedTraits[0])
                    && str_starts_with($associatedTraits[0], $currentPrefix));
            if ($fromCurrentSet) {
                return false;
            }
        }

        // Random Emblem (carousel pickup that grants a random trait)
        // lives under `TFT{N}_MarketOffering_RandomEmblem`. It has no
        // Emblem tag and no associated trait, so it falls through the
        // looksLikeEmblem check. Allow it explicitly by api_name so the
        // player still sees it in the emblems list.
        if ($apiName === "TFT{$setNumber}_MarketOffering_RandomEmblem") {
            return false;
        }

        // Evergreen base items (BFSword, Rod, Bloodthirster, IE, ...),
        // except the `Corrupted*` variants which are byte-identical
        // duplicates of their non-corrupted counterparts (verified: same
        // desc, composition, tags — see audit 2026-04-13). Likely legacy
        // from a deprecated augment; they'd otherwise double every
        // completed-item card.
        if (str_starts_with($apiName, 'TFT_Item_')) {
            if (str_starts_with($apiName, 'TFT_Item_Corrupted')) {
                return true;
            }

            return false;
        }

        // Set 13 leftover: champion summon items (1-star/2-star champion
        // tokens from Crime trait) are still in the data file but the
        // mechanic isn't in Set 17. Skip the whole `ChampionItem` family
        // so they don't pollute the items list with deprecated entries.
        if (str_contains($apiName, '_ChampionItem_') || str_starts_with($apiName, 'TFT17_ChampionItem_')) {
            return true;
        }

        // Set 5 radiant items are the upgraded variants of every evergreen
        // completed item (Radiant Infinity Edge, Radiant Bloodthirster,
        // etc.). Riot never re-namespaced them — they still ship under the
        // `TFT5_Item_*Radiant` prefix but are live in every current set.
        // We pull them in as cross-set items and link back to their base
        // via radiant_parent_id in the createItem second pass.
        if (str_starts_with($apiName, 'TFT5_Item_') && str_ends_with($apiName, 'Radiant')) {
            return false;
        }

        // Explicit skip: cross-set junk (consumables, hex effects, etc.)
        if (str_starts_with($apiName, 'TFT_')) {
            return true;
        }

        // Set-scoped whitelist: only real items and augments from current set
        $setPrefixes = [
            "TFT{$setNumber}_Item_",
            "TFT{$setNumber}_Augment_",
        ];
        foreach ($setPrefixes as $prefix) {
            if (str_starts_with($apiName, $prefix)) {
                return false;
            }
        }

        // Everything else (TFT17_CarouselMarket_*, TFT17_Trait_*, wrong-set items) → skip
        return true;
    }

    private function isAugment(string $apiName): bool
    {
        return str_contains($apiName, '_Augment_');
    }

    private function isEmblem(array $itemData): bool
    {
        $tags = $itemData['tags'] ?? [];
        $apiName = $itemData['apiName'] ?? '';
        $name = $itemData['name'] ?? '';

        // Real emblems (Spatula + reagent → grant a trait) have a
        // distinctive `EmblemItem` apiName suffix and "Emblem" in their
        // display name. Set 17 PBE leaves their `associatedTraits` empty
        // and stores the "Emblem" category tag as the hash `{ebcd1bac}`,
        // so we match on the apiName/name pattern instead of the tag.
        //
        // Important: do NOT use `!empty(associatedTraits)` here. Trait
        // items like Anima Squad weapons also carry associatedTraits
        // and would otherwise be misrouted to the emblems table — they
        // belong in items as `trait_item`, see isTraitItem().
        // Include `RandomEmblem` carousel variants — not `EmblemItem`
        // suffixed but still emblem-shaped items the player can equip.
        return in_array('Emblem', $tags, true)
            || str_ends_with($apiName, 'EmblemItem')
            || str_ends_with($apiName, 'RandomEmblem')
            || str_ends_with($name, ' Emblem')
            || $name === 'Random Emblem';
    }

    /**
     * Trait-granted items: weapons/relics that show up in your inventory
     * when you run a specific trait (Anima Squad weapons, future trait
     * loot pools). Distinct from emblems (which grant the trait) and
     * from craftables (which are built from components).
     */
    private function isTraitItem(array $itemData): bool
    {
        $apiName = $itemData['apiName'] ?? '';
        $associated = $itemData['associatedTraits'] ?? [];

        // Anima Squad pattern — confirmed in Set 17 PBE. Reuses the
        // `*SquadItem_*` substring that Riot stamps on every Anima
        // weapon (RocketSwarm, LionessLament, etc.).
        return ! empty($associated) && str_contains($apiName, 'SquadItem_');
    }

    private function createItem(array $itemData, Set $set): void
    {
        $apiName = $itemData['apiName'];
        $isEvergreen = str_starts_with($apiName, 'TFT_Item_');

        // Reverse-resolve hashed effect keys via FNV-1a against the
        // description template — same trick used for trait effects.
        // Items like TFT17_Item_PsyOps_* ship variables as `{b9c681e9}`
        // instead of plaintext names, but the description still uses
        // the plaintext placeholder (`@ResistReduce@`).
        $hashToName = $this->buildPlaceholderHashMap($itemData['desc'] ?? '');
        $effects = $this->resolveTraitEffectKeys(
            $itemData['effects'] ?? [],
            $hashToName,
        );

        $item = Item::updateOrCreate(
            ['api_name' => $apiName],
            [
                'set_id' => $isEvergreen ? null : $set->id,
                'name' => $itemData['name'],
                'description' => $itemData['desc'] ?? null,
                'type' => $this->determineItemType($itemData),
                'effects' => $effects,
                'tags' => $this->filterTags($itemData['tags'] ?? []),
                'icon_path' => $itemData['icon'] ?? null,
            ]
        );

        // Queue component resolution for 2nd pass (components might not exist yet)
        $composition = $itemData['composition'] ?? [];
        if (count($composition) >= 2) {
            $this->pendingComponents[$item->id] = [$composition[0], $composition[1]];
        }
    }

    /**
     * HEURISTIC: item type classification. CDragon doesn't expose this directly.
     * Order matters — first match wins.
     */
    private function determineItemType(array $itemData): string
    {
        $tags = $itemData['tags'] ?? [];
        $apiName = $itemData['apiName'] ?? '';

        // Trait-item check runs before radiant so Anima Squad weapons
        // (which Riot tags with their own trait, no composition) get
        // their own type instead of being misfiled as `base`.
        if ($this->isTraitItem($itemData)) {
            return 'trait_item';
        }
        // Radiant check runs first (after trait_item) because TFT5
        // radiants ALSO have a composition (inherited from their base)
        // and would otherwise be miscategorised as 'craftable'.
        if (in_array('Radiant', $tags, true)
            || str_ends_with($apiName, 'Radiant')
            || str_contains($apiName, '_Radiant')) {
            return 'radiant';
        }
        if (in_array('Artifact', $tags, true) || str_contains($apiName, 'Artifact')) {
            return 'artifact';
        }
        if (in_array('Support', $tags, true) || str_contains($apiName, 'Support')) {
            return 'support';
        }
        if (! empty($itemData['composition'])) {
            return 'craftable';
        }

        return 'base';
    }

    private function createAugment(array $itemData, Set $set): void
    {
        $associatedTraits = $itemData['associatedTraits'] ?? [];
        $traitId = null;

        if (! empty($associatedTraits)) {
            $traitId = TftTrait::query()
                ->where('set_id', $set->id)
                ->where('api_name', $associatedTraits[0])
                ->value('id');
        }

        Augment::create([
            'set_id' => $set->id,
            'api_name' => $itemData['apiName'],
            'name' => $itemData['name'],
            'description' => $itemData['desc'] ?? null,
            'tier' => $this->determineAugmentTier($itemData),
            'effects' => $itemData['effects'] ?? [],
            'associated_trait_id' => $traitId,
            'icon_path' => $itemData['icon'] ?? null,
        ]);
    }

    /**
     * HEURISTIC: augment tier from icon path conventions.
     *
     * Set 17 CDragon PBE snapshot exposes mostly Hero/God augments (Set 17's
     * signature mechanic). Regular silver/gold/prismatic augments (Best Friends,
     * Determined Investors, etc.) are either not exposed yet at PBE stage or
     * live under a different path — TODO revisit when they appear.
     *
     * Icon path patterns observed in real data:
     *   AatroxHero_I.TFT_Set17.tex                → tier 1 (silver)
     *   AnimaCommander_II.TFT_Set17.tex           → tier 2 (gold)
     *   Missing-T2.tex                            → tier 2 placeholder (PBE art not ready)
     *   Missing-T3.tex                            → tier 3 placeholder (prismatic)
     *   GodAugmentAurelionSol_II.TFT_Set17.tex    → hero tier 2
     *
     * Hero augments (Set 17 "God Augment" mechanic) are champion-specific and
     * get classified as 'hero' regardless of their internal tier. Regular
     * augments use silver/gold/prismatic.
     */
    private function determineAugmentTier(array $itemData): string
    {
        $apiName = $itemData['apiName'] ?? '';
        $iconLower = strtolower($itemData['icon'] ?? '');

        // Set 17 "God Augment" and champion "Carry" augments are hero-tier
        // mechanics — they're champion-specific upgrades, not generic pool augments.
        if (str_contains($apiName, 'GodAugment')
            || str_ends_with($apiName, 'Carry')
            || str_contains(strtolower($apiName), 'hero')) {
            return 'hero';
        }

        // Tier suffix patterns in icon paths (most reliable indicator)
        if (preg_match('#_iii[\\./]|missing-t3|-iii[\\./]#', $iconLower)) {
            return 'prismatic';
        }
        if (preg_match('#_ii[\\./]|missing-t2|-ii[\\./]#', $iconLower)) {
            return 'gold';
        }
        if (preg_match('#_i[\\./]|missing-t1|-i[\\./]#', $iconLower)) {
            return 'silver';
        }

        // Last resort: explicit tier name in icon path
        if (str_contains($iconLower, 'prismatic')) {
            return 'prismatic';
        }
        if (str_contains($iconLower, 'gold')) {
            return 'gold';
        }

        return 'silver';
    }

    private function createEmblem(array $itemData, Set $set): void
    {
        $apiName = $itemData['apiName'];
        $name = $itemData['name'] ?? '';
        $associatedTraits = $itemData['associatedTraits'] ?? [];
        $traitApiName = $associatedTraits[0] ?? null;

        // Resolve hashed effect keys via FNV-1a against the description
        // template, same trick as items/traits. Emblems for trait-gated
        // bonuses (DRX `{6b3a76bf}` = ASTeam, etc.) need this so the
        // stats badge can render plaintext labels.
        $hashToName = $this->buildPlaceholderHashMap($itemData['desc'] ?? '');
        $effects = $this->resolveTraitEffectKeys(
            $itemData['effects'] ?? [],
            $hashToName,
        );

        // PBE-stage emblems ship with empty associatedTraits — recover
        // the trait reference from the apiName pattern instead. Riot's
        // convention is `TFT{N}_Item_{TraitFragment}EmblemItem`, where
        // the fragment matches the trait's apiName *suffix* (sans the
        // `TFT{N}_` prefix). N.O.V.A. (`TFT17_DRX`) → `DRXEmblemItem`,
        // Brawler (`TFT17_HPTank`) → `HPTankEmblemItem`, etc.
        if ($traitApiName === null) {
            $traitApiName = $this->guessTraitApiNameFromEmblem($apiName, $set->number);
        }

        // Resolve trait_id via apiName first, then fall back to matching
        // the emblem's display name against the traits table. Riot uses
        // inconsistent api_name fragments — `FavoredEmblemItem` points at
        // the `TFT17_ADMIN` (Arbiter) trait, `PulsefireEmblemItem` at
        // `TFT17_Timebreaker` — so the only reliable bridge is the
        // human-readable "Arbiter Emblem" / "Timebreaker Emblem" name.
        $traitId = null;

        if ($traitApiName !== null) {
            $traitId = TftTrait::query()
                ->where('set_id', $set->id)
                ->where('api_name', $traitApiName)
                ->value('id');
        }

        if ($traitId === null && str_ends_with($name, ' Emblem')) {
            $traitName = substr($name, 0, -strlen(' Emblem'));
            $traitId = TftTrait::query()
                ->where('set_id', $set->id)
                ->where('name', $traitName)
                ->value('id');
        }

        // Random Emblem intentionally has trait_id = NULL (it grants a
        // random trait at equip time). Anything else that can't resolve
        // a trait is probably a cross-set emblem that slipped through —
        // skip it rather than storing a headless "[random]" row.
        if ($traitId === null && $name !== 'Random Emblem') {
            return;
        }

        $emblem = Emblem::create([
            'set_id' => $set->id,
            'api_name' => $apiName,
            'name' => $itemData['name'],
            'description' => $itemData['desc'] ?? null,
            'effects' => $effects,
            'trait_id' => $traitId,
            'icon_path' => $itemData['icon'] ?? null,
        ]);

        // Composition resolution rides the same second pass as item
        // recipes — emblems with a Spatula+X recipe (DRX, HPTank, ...)
        // queue here, then linkEmblemComponents() in resolveItemComponents
        // backfills the FKs once the base items table is populated.
        $composition = $itemData['composition'] ?? [];
        if (count($composition) >= 2) {
            $this->pendingEmblemComponents[$emblem->id] = [$composition[0], $composition[1]];
        }
    }

    /**
     * Strip the `TFT{N}_Item_` prefix and `EmblemItem` suffix from an
     * emblem apiName to recover the trait apiName fragment, then prefix
     * it back with `TFT{N}_` so it can be matched against the traits
     * table. Returns null for shapes that don't fit the pattern.
     */
    private function guessTraitApiNameFromEmblem(string $apiName, int $setNumber): ?string
    {
        $prefix = "TFT{$setNumber}_Item_";
        $suffix = 'EmblemItem';

        if (! str_starts_with($apiName, $prefix) || ! str_ends_with($apiName, $suffix)) {
            return null;
        }

        $fragment = substr($apiName, strlen($prefix), -strlen($suffix));
        if ($fragment === '') {
            return null;
        }

        return "TFT{$setNumber}_{$fragment}";
    }

    /**
     * Second pass: resolve item component FKs now that all items are inserted.
     * First pass queued [component1ApiName, component2ApiName] per item that had composition.
     */
    private function resolveItemComponents(): void
    {
        if (! empty($this->pendingComponents)) {
            $allApiNames = array_unique(array_merge(...array_values($this->pendingComponents)));
            $idByApiName = Item::query()
                ->whereIn('api_name', $allApiNames)
                ->pluck('id', 'api_name')
                ->all();

            foreach ($this->pendingComponents as $itemId => [$c1, $c2]) {
                Item::where('id', $itemId)->update([
                    'component_1_id' => $idByApiName[$c1] ?? null,
                    'component_2_id' => $idByApiName[$c2] ?? null,
                ]);
            }

            $this->pendingComponents = [];
        }

        $this->linkRadiantParents();
        $this->linkEmblemComponents();
    }

    /**
     * Backfill component FKs on emblems whose CDragon record carried a
     * 2-element composition (Spatula + reagent). Uses the same lookup
     * shape as the item recipe pass above — single batched query, then
     * one update per emblem.
     */
    private function linkEmblemComponents(): void
    {
        if (empty($this->pendingEmblemComponents)) {
            return;
        }

        $allApiNames = array_unique(array_merge(...array_values($this->pendingEmblemComponents)));
        $idByApiName = Item::query()
            ->whereIn('api_name', $allApiNames)
            ->pluck('id', 'api_name')
            ->all();

        foreach ($this->pendingEmblemComponents as $emblemId => [$c1, $c2]) {
            Emblem::where('id', $emblemId)->update([
                'component_1_id' => $idByApiName[$c1] ?? null,
                'component_2_id' => $idByApiName[$c2] ?? null,
            ]);
        }

        $this->pendingEmblemComponents = [];
    }

    /**
     * Link every radiant item to its base completed item via
     * `radiant_parent_id`. Relies on a deterministic naming bridge:
     *
     *   TFT5_Item_InfinityEdgeRadiant   → TFT_Item_InfinityEdge
     *   TFT5_Item_BloodthirsterRadiant  → TFT_Item_Bloodthirster
     *
     * Set 17's own radiant variants (TFT17_Item_PsyOps_*_Radiant) follow
     * a different pattern — chop the `_Radiant` suffix to recover the
     * base name. Unresolvable radiants stay with NULL parent rather than
     * being dropped, so we can see them in the UI and add rules for new
     * naming shapes as they appear.
     */
    private function linkRadiantParents(): void
    {
        $radiants = Item::query()
            ->where('type', 'radiant')
            ->whereNull('radiant_parent_id')
            ->get(['id', 'api_name', 'name']);

        if ($radiants->isEmpty()) {
            return;
        }

        // Pre-index every potential parent (non-radiant items) twice:
        //   - by exact api_name (fast path)
        //   - by lowercase api_name (case-insensitive fallback for
        //     `RapidFirecannon` vs `RapidFireCannon` style mismatches)
        //   - by lowercased display name with "Radiant " stripped, so
        //     `Radiant Sunfire Cape` matches `TFT_Item_RedBuff`'s
        //     display name "Sunfire Cape" even though Riot renamed
        //     the internal id between sets.
        $parents = Item::query()
            ->where('type', '!=', 'radiant')
            ->get(['id', 'api_name', 'name']);

        $byApiName = [];
        $byApiNameLower = [];
        $byDisplayName = [];
        foreach ($parents as $p) {
            $byApiName[$p->api_name] = $p->id;
            $byApiNameLower[strtolower($p->api_name)] = $p->id;
            $byDisplayName[strtolower($p->name)] = $p->id;
        }

        foreach ($radiants as $item) {
            $candidate = $this->radiantParentApiName($item->api_name);
            $parentId = null;

            if ($candidate !== null) {
                $parentId = $byApiName[$candidate]
                    ?? $byApiNameLower[strtolower($candidate)]
                    ?? null;
            }

            // Display-name fallback: `Radiant Infinity Edge` → `Infinity Edge`
            if ($parentId === null) {
                $stripped = preg_replace('/^Radiant\s+/i', '', $item->name);
                $parentId = $byDisplayName[strtolower($stripped)] ?? null;
            }

            if ($parentId !== null) {
                Item::where('id', $item->id)->update(['radiant_parent_id' => $parentId]);
            }
        }
    }

    /**
     * Derive the expected parent api_name for a radiant item. Returns
     * null for patterns we don't recognise yet — caller leaves the FK
     * unset rather than guessing.
     */
    private function radiantParentApiName(string $radiantApiName): ?string
    {
        // TFT5_Item_{Name}Radiant → TFT_Item_{Name}
        if (preg_match('/^TFT5_Item_(.+)Radiant$/', $radiantApiName, $m)) {
            return 'TFT_Item_'.$m[1];
        }

        // TFT{N}_Item_..._{Name}Mod_Radiant → TFT{N}_Item_..._{Name}Mod
        // (Set 17 PsyOps trait-item radiant variants share their base
        // name with a single `_Radiant` suffix to chop off.)
        if (str_ends_with($radiantApiName, '_Radiant')) {
            return substr($radiantApiName, 0, -strlen('_Radiant'));
        }

        return null;
    }

    // ── Icon downloads ──────────────────────────────────────

    /**
     * Convert CDragon .tex path to public PNG URL.
     * CDragon serves game assets at /game/ with lowercase paths and PNG
     * versions auto-generated from the source .tex files.
     *
     * Example:
     *   'ASSETS/Characters/TFT17_Aatrox/Skins/Base/Images/TFT17_Aatrox_splash_tile_30.TFT_Set17.tex'
     *   →
     *   'https://raw.communitydragon.org/pbe/game/assets/characters/tft17_aatrox/.../tft17_aatrox_splash_tile_30.tft_set17.png'
     */
    private function cdragonAssetUrl(string $texPath): string
    {
        $lower = strtolower(str_replace('.tex', '.png', $texPath));

        return self::CDRAGON_BASE.'/game/'.$lower;
    }

    private function downloadIconIfMissing(string $url, string $destPath): bool
    {
        if (file_exists($destPath)) {
            return false;
        }

        try {
            $response = Http::timeout(15)->get($url);
            if ($response->successful()) {
                file_put_contents($destPath, $response->body());

                return true;
            }
        } catch (\Throwable $e) {
            // Icon downloads are best-effort — failures don't break the import
        }

        return false;
    }

    private function downloadChampionIcons(Set $set): int
    {
        $dir = public_path('icons/champions');
        if (! is_dir($dir)) {
            mkdir($dir, 0755, true);
        }

        $downloaded = 0;
        $champions = Champion::query()
            ->where('set_id', $set->id)
            ->whereNotNull('icon_path')
            ->get(['id', 'api_name', 'icon_path', 'base_champion_id']);

        foreach ($champions as $champion) {
            $destPath = $dir.DIRECTORY_SEPARATOR.$champion->api_name.'.png';
            if ($this->downloadIconIfMissing($this->cdragonAssetUrl($champion->icon_path), $destPath)) {
                $downloaded++;
            }
        }

        return $downloaded;
    }

    private function downloadAbilityIcons(Set $set): int
    {
        $dir = public_path('icons/abilities');
        if (! is_dir($dir)) {
            mkdir($dir, 0755, true);
        }

        $downloaded = 0;
        $champions = Champion::query()
            ->where('set_id', $set->id)
            ->whereNotNull('ability_icon_path')
            ->get(['id', 'api_name', 'ability_icon_path']);

        foreach ($champions as $champion) {
            $destPath = $dir.DIRECTORY_SEPARATOR.$champion->api_name.'.png';
            if ($this->downloadIconIfMissing($this->cdragonAssetUrl($champion->ability_icon_path), $destPath)) {
                $downloaded++;
            }
        }

        return $downloaded;
    }

    /**
     * Download icons for every item with a CDragon icon_path that we
     * don't already have on disk. Items aren't set-scoped — base
     * (TFT_Item_*) and TFT5 radiant variants persist across imports —
     * so the query covers the whole table rather than a single set.
     * Existing files short-circuit via the HEAD-check in
     * downloadIconIfMissing, so re-runs only fetch newly-added items.
     */
    private function downloadItemIcons(): int
    {
        $dir = public_path('icons/items');
        if (! is_dir($dir)) {
            mkdir($dir, 0755, true);
        }

        $downloaded = 0;
        $items = Item::query()
            ->whereNotNull('icon_path')
            ->get(['id', 'api_name', 'icon_path']);

        foreach ($items as $item) {
            $destPath = $dir.DIRECTORY_SEPARATOR.$item->api_name.'.png';
            if ($this->downloadIconIfMissing($this->cdragonAssetUrl($item->icon_path), $destPath)) {
                $downloaded++;
            }
        }

        return $downloaded;
    }

    private function downloadTraitIcons(Set $set): int
    {
        $dir = public_path('icons/traits');
        if (! is_dir($dir)) {
            mkdir($dir, 0755, true);
        }

        $downloaded = 0;
        $traits = TftTrait::query()
            ->where('set_id', $set->id)
            ->whereNotNull('icon_path')
            ->get(['id', 'api_name', 'icon_path']);

        foreach ($traits as $trait) {
            $destPath = $dir.DIRECTORY_SEPARATOR.$trait->api_name.'.png';
            if ($this->downloadIconIfMissing($this->cdragonAssetUrl($trait->icon_path), $destPath)) {
                $downloaded++;
            }
        }

        return $downloaded;
    }

    // ── Hooks runner ────────────────────────────────────────

    private function runHooks(Set $set): void
    {
        $hooks = self::SET_HOOKS[$set->number] ?? [];

        foreach ($hooks as $hookClass) {
            /** @var PostImportHook $hook */
            $hook = app($hookClass);
            $hook->run($set);
        }
    }

    // ── Helpers ─────────────────────────────────────────────

    /**
     * Filter out CDragon hash-obfuscated translation keys like "{fefec6fb}".
     * These are ~121 of ~130 distinct tags in items.tags — pure noise.
     * Keeps only human-readable tags (AttackDamage, Health, Mana, etc.).
     */
    private function filterTags(array $tags): array
    {
        return array_values(array_filter($tags, fn ($tag) => ! $this->isHashKey($tag)));
    }

    /**
     * Same filtering for JSONB effects dicts — sometimes keys are hash-obfuscated.
     */
    /**
     * Build a `{hash} → plaintextName` map from every `@VarName@`
     * placeholder found in a trait description template. Used to
     * reverse-resolve CDragon's hashed effect variable keys back to
     * human-readable names when importing breakpoint effects.
     *
     * @return array<string, string>
     */
    private function buildPlaceholderHashMap(string $description): array
    {
        preg_match_all('/@([A-Za-z_][A-Za-z0-9_]*)/', $description, $matches);
        $map = [];
        foreach (array_unique($matches[1] ?? []) as $name) {
            $map[\App\Services\Tft\FnvHasher::wrapped($name)] = $name;
        }

        return $map;
    }

    /**
     * Rewrite a breakpoint's `variables` dict so hashed keys are replaced
     * with plaintext names drawn from the description template. Hashed
     * keys without a match in the placeholder set are dropped (they
     * carry runtime engine state the tooltip never shows), plaintext
     * keys pass through untouched.
     *
     * @param  array<string, mixed>  $effects
     * @param  array<string, string>  $hashToName
     * @return array<string, mixed>
     */
    private function resolveTraitEffectKeys(array $effects, array $hashToName): array
    {
        $resolved = [];
        foreach ($effects as $key => $value) {
            if ($value === null) {
                continue;
            }
            if ($this->isHashKey((string) $key)) {
                if (isset($hashToName[$key])) {
                    $resolved[$hashToName[$key]] = $value;
                }

                continue;
            }
            $resolved[$key] = $value;
        }

        return $resolved;
    }

    private function filterHashKeys(array $dict): array
    {
        return array_filter(
            $dict,
            fn ($key) => ! $this->isHashKey((string) $key),
            ARRAY_FILTER_USE_KEY
        );
    }

    private function isHashKey(string $s): bool
    {
        return str_starts_with($s, '{') && str_ends_with($s, '}');
    }

    private function getCounts(Set $set): array
    {
        return [
            'traits' => TftTrait::where('set_id', $set->id)->count(),
            'trait_breakpoints' => \DB::table('trait_breakpoints')
                ->join('traits', 'trait_breakpoints.trait_id', '=', 'traits.id')
                ->where('traits.set_id', $set->id)
                ->count(),
            'champions (all)' => Champion::where('set_id', $set->id)->count(),
            'champions (playable)' => Champion::where('set_id', $set->id)->where('is_playable', true)->count(),
            'champions (variants)' => Champion::where('set_id', $set->id)->whereNotNull('base_champion_id')->count(),
            'items' => Item::count(),
            'augments' => Augment::where('set_id', $set->id)->count(),
            'emblems' => Emblem::where('set_id', $set->id)->count(),
        ];
    }
}
