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
     * Note: VariantChoiceHook is generic and runs for every set — it
     * detects variant-choice champions (like Miss Fortune Set 17) from
     * CDragon BIN files dynamically. The remaining hooks are set-specific
     * quirks that can't be data-driven.
     */
    private const SET_HOOKS = [
        17 => [
            RemoveNonPlayableHook::class,
            VariantChoiceHook::class,
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
        $this->downloadTraitIcons($set);

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

            // Breakpoints + effects JSONB
            foreach ($breakpoints as $i => $bp) {
                $trait->breakpoints()->create([
                    'position' => $i + 1,
                    'min_units' => $bp['minUnits'],
                    'max_units' => $bp['maxUnits'] ?? 25000,
                    'style_id' => $bp['style'] ?? 1,
                    'effects' => $this->filterHashKeys($bp['variables'] ?? []),
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
        $tags = $itemData['tags'] ?? [];
        $associatedTraits = $itemData['associatedTraits'] ?? [];

        // Emblems can have non-standard apiName prefixes — let them through
        // regardless. Excludes augments explicitly because trait-gated augments
        // ALSO carry associatedTraits but must follow the per-set whitelist.
        $isAugmentName = str_contains($apiName, '_Augment_');
        $looksLikeEmblem = ! $isAugmentName
            && (in_array('Emblem', $tags, true) || ! empty($associatedTraits));
        if ($looksLikeEmblem) {
            return false;
        }

        // Evergreen base items (BFSword, Rod, Bloodthirster, IE, ...)
        if (str_starts_with($apiName, 'TFT_Item_')) {
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
        $associated = $itemData['associatedTraits'] ?? [];

        return in_array('Emblem', $tags, true) || ! empty($associated);
    }

    private function createItem(array $itemData, Set $set): void
    {
        $apiName = $itemData['apiName'];
        $isEvergreen = str_starts_with($apiName, 'TFT_Item_');

        $item = Item::updateOrCreate(
            ['api_name' => $apiName],
            [
                'set_id' => $isEvergreen ? null : $set->id,
                'name' => $itemData['name'],
                'type' => $this->determineItemType($itemData),
                'effects' => $itemData['effects'] ?? [],
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

        if (in_array('Radiant', $tags, true) || str_contains($apiName, 'Radiant')) {
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
        $associatedTraits = $itemData['associatedTraits'] ?? [];
        $traitApiName = $associatedTraits[0] ?? null;

        if (! $traitApiName) {
            return; // Emblem without a trait → nonsense, skip
        }

        $traitId = TftTrait::query()
            ->where('set_id', $set->id)
            ->where('api_name', $traitApiName)
            ->value('id');

        if (! $traitId) {
            return; // Trait not in current set → wrong-set emblem, skip
        }

        Emblem::create([
            'set_id' => $set->id,
            'api_name' => $itemData['apiName'],
            'name' => $itemData['name'],
            'trait_id' => $traitId,
            'icon_path' => $itemData['icon'] ?? null,
        ]);
    }

    /**
     * Second pass: resolve item component FKs now that all items are inserted.
     * First pass queued [component1ApiName, component2ApiName] per item that had composition.
     */
    private function resolveItemComponents(): void
    {
        if (empty($this->pendingComponents)) {
            return;
        }

        // Preload all referenced component items in 1 query
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
