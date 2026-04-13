<?php

namespace App\Services\Tft;

use App\Models\TftTrait;
use Illuminate\Http\Client\Factory as HttpFactory;
use RuntimeException;

/**
 * Read-only inspector for CommunityDragon character BIN files.
 *
 * Fetches `game/characters/{apiName}.cdtb.bin.json` (and its `_traitclone`
 * sibling if present) from CDragon, extracts the TFTCharacterRecord, and
 * resolves `mLinkedTraits[].TraitData` hash references back to trait
 * api_names by brute-forcing FNV-1a 32 on the known binpath pattern.
 *
 * This is a diagnostic tool — it does not touch the DB aside from reading
 * trait api_names to seed the hash lookup table. Use it to verify a new
 * character's variant mechanic before writing a proper importer for it.
 *
 * See docs/research/tft-character-bins-mechanics.md for the full context,
 * including why `game/characters/*.cdtb.bin.json` is the right path and
 * why the binpath pattern is `Maps/Shipping/Map22/Sets/TFTSet{N}/Traits/*`.
 */
class CharacterBinInspector
{
    private const CDRAGON_BASE = 'https://raw.communitydragon.org';

    public function __construct(
        private readonly HttpFactory $http,
    ) {}

    /**
     * Inspect a champion by its api_name (e.g. "TFT17_MissFortune").
     *
     * Returns a structured report including both main and traitclone records
     * (if present), with all trait hashes resolved to api_names.
     *
     * @param  string  $channel  'pbe' or 'latest' — PBE for unreleased content
     */
    public function inspect(string $apiName, string $channel = 'pbe'): array
    {
        $setNumber = $this->extractSetNumber($apiName);
        $traitHashMap = $this->buildTraitHashMap($setNumber);

        $main = $this->fetchAndParseCharacter($apiName, $channel, $traitHashMap);
        if ($main === null) {
            throw new RuntimeException("Main character file not found for {$apiName} on channel '{$channel}'");
        }

        // Variant mechanic: detected by existence of {name}_TraitClone sibling.
        // 404 is expected and non-fatal — most champions don't have variants.
        $traitCloneApiName = $apiName.'_TraitClone';
        $traitClone = $this->fetchAndParseCharacter($traitCloneApiName, $channel, $traitHashMap);

        return [
            'api_name' => $apiName,
            'set_number' => $setNumber,
            'channel' => $channel,
            'trait_map_size' => count($traitHashMap),
            'main' => $main,
            'has_variant_choice' => $traitClone !== null,
            'trait_clone' => $traitClone,
        ];
    }

    /**
     * Build a hash → api_name lookup for all traits in a given set.
     *
     * The binpath pattern was discovered empirically; see research doc.
     * It's not in any public hashlist but matches deterministically when
     * you know the template.
     */
    public function buildTraitHashMap(int $setNumber): array
    {
        $pathTemplate = "Maps/Shipping/Map22/Sets/TFTSet{$setNumber}/Traits/";

        return TftTrait::query()
            ->pluck('api_name')
            ->mapWithKeys(fn (string $apiName) => [
                FnvHasher::wrapped($pathTemplate.$apiName) => $apiName,
            ])
            ->all();
    }

    /**
     * Fetch and parse one character bin file. Returns null on 404, which is
     * the expected signal for "no such variant exists".
     */
    private function fetchAndParseCharacter(
        string $apiName,
        string $channel,
        array $traitHashMap,
    ): ?array {
        $url = sprintf(
            '%s/%s/game/characters/%s.cdtb.bin.json',
            self::CDRAGON_BASE,
            $channel,
            strtolower($apiName),
        );

        $response = $this->http->timeout(30)->get($url);

        if ($response->status() === 404) {
            return null;
        }

        if ($response->failed()) {
            throw new RuntimeException("Fetch failed for {$url}: HTTP {$response->status()}");
        }

        $data = $response->json();
        $record = $this->findCharacterRecord($data);

        if ($record === null) {
            throw new RuntimeException("No TFTCharacterRecord found in {$url}");
        }

        return [
            'url' => $url,
            'character_name' => $record['mCharacterName'] ?? null,
            'spell_names' => array_values(array_filter($record['spellNames'] ?? [])),
            'linked_traits' => $this->resolveLinkedTraits(
                $record['mLinkedTraits'] ?? [],
                $traitHashMap,
            ),
            'raw_hash_keys' => $this->collectRawHashStats($record),
            'hashed_stats' => $this->extractHashedNumericStats($record),
            'spells' => $this->extractSpellObjects($data),
        ];
    }

    /**
     * Extract all SpellObject entries from a character bin dump. Each
     * SpellObject represents one spell, basic attack, or stance variant
     * (e.g. Miss Fortune's ManaTraitStance for Conduit Mode).
     *
     * For each spell we capture everything that's useful for the importer:
     *   - mScriptName (plaintext identifier used to match primary spell)
     *   - mSpell.DataValues — variable name/values[] pairs (per star level)
     *   - mSpell.cooldownTime[], castRange[], castConeDistance, mCastTime
     *   - mSpell.mClientData.mTooltipData.mLocKeys — plaintext RST keys
     *     pointing at the tft.stringtable.json entry for description/name.
     *     NB: resolving those keys to actual text needs xxh3 + stringtable,
     *     handled by AbilityDescriptionResolver downstream.
     *
     * @return list<array<string, mixed>>
     */
    private function extractSpellObjects(array $data): array
    {
        $spells = [];

        foreach ($data as $topKey => $value) {
            if (! is_array($value)) {
                continue;
            }
            if (($value['__type'] ?? null) !== 'SpellObject') {
                continue;
            }

            $mSpell = $value['mSpell'] ?? [];
            if (! is_array($mSpell)) {
                $mSpell = [];
            }

            $spells[] = [
                'bin_key' => $topKey,
                'script_name' => $value['mScriptName'] ?? null,
                'object_name' => $value['ObjectName'] ?? null,
                'animation' => $mSpell['mAnimationName'] ?? null,
                'cast_time' => $mSpell['mCastTime'] ?? null,
                'cooldown_time' => $mSpell['cooldownTime'] ?? [],
                'cast_range' => $mSpell['castRange'] ?? [],
                'cast_cone_distance' => $mSpell['castConeDistance'] ?? null,
                'missile_speed' => $mSpell['missileSpeed'] ?? null,
                'data_values' => $this->extractDataValues($mSpell),
                'calculations' => is_array($mSpell['mSpellCalculations'] ?? null)
                    ? $mSpell['mSpellCalculations']
                    : [],
                'loc_keys' => $this->extractLocKeys($mSpell),
            ];
        }

        return $spells;
    }

    /**
     * Extract ability variable definitions from mSpell.DataValues. Each
     * entry has a `name` (or legacy `mName`) and `values` (or legacy
     * `mValues`) — a 7-element array covering all star/level tiers.
     * These are the numbers that fill `@VarName@` placeholders in the
     * description template.
     *
     * @return list<array{name: string|null, values: array<int, int|float>}>
     */
    private function extractDataValues(array $mSpell): array
    {
        // New field name is `DataValues`, legacy is `mDataValues`. Riot
        // flipped this at some point — cdtb checks both, so do we.
        $raw = $mSpell['DataValues'] ?? $mSpell['mDataValues'] ?? [];
        if (! is_array($raw)) {
            return [];
        }

        $out = [];
        foreach ($raw as $entry) {
            if (! is_array($entry)) {
                continue;
            }
            $name = $entry['name'] ?? $entry['mName'] ?? null;
            $values = $entry['values'] ?? $entry['mValues'] ?? [];
            if ($name === null || ! is_array($values)) {
                continue;
            }
            $out[] = [
                'name' => $name,
                'values' => array_values($values),
            ];
        }

        return $out;
    }

    /**
     * Extract localisation keys from mSpell.mClientData.mTooltipData.mLocKeys.
     * These are plaintext RST key strings like
     *   "Spell_TFT17_MissFortuneSpell_ManaTraitStance_Desc"
     * that later get resolved against the xxh3-hashed stringtable.
     *
     * Returns nulls when the structure is absent rather than throwing —
     * not every spell has localisation data (e.g. basic attack helpers).
     *
     * @return array{key_name: string|null, key_tooltip: string|null}
     */
    private function extractLocKeys(array $mSpell): array
    {
        $clientData = $mSpell['mClientData'] ?? null;
        $tooltipData = is_array($clientData) ? ($clientData['mTooltipData'] ?? null) : null;
        $locKeys = is_array($tooltipData) ? ($tooltipData['mLocKeys'] ?? null) : null;

        if (! is_array($locKeys)) {
            return ['key_name' => null, 'key_tooltip' => null];
        }

        return [
            'key_name' => $locKeys['keyName'] ?? null,
            'key_tooltip' => $locKeys['keyTooltip'] ?? null,
        ];
    }

    /**
     * Pull numeric stat values out of hashed fields. CDragon wraps each
     * stat in a `{ce9b917b}` (CharacterStatOverrideDef?) object containing
     * a single inner hashed field `{b35aa769}` holding the actual value.
     * We reach through the wrapper to expose `hash → value`.
     *
     * @return array<string, int|float>
     */
    private function extractHashedNumericStats(array $record): array
    {
        $stats = [];
        foreach ($record as $key => $value) {
            if (! is_string($key) || ! str_starts_with($key, '{') || ! str_ends_with($key, '}')) {
                continue;
            }
            if (! is_array($value)) {
                continue;
            }

            // Wrapper pattern: object has __type and one other hashed key
            // whose value is numeric. Skip boolean flags and complex objects.
            $inner = array_diff_key($value, ['__type' => true]);
            if (count($inner) !== 1) {
                continue;
            }
            $innerValue = reset($inner);
            if (is_int($innerValue) || is_float($innerValue)) {
                $stats[$key] = $innerValue;
            }
        }

        return $stats;
    }

    /**
     * Find the TFTCharacterRecord object inside a cdtb.bin.json dump.
     * The top-level object is a map of hashed keys to various record types;
     * we search for the one whose __type marks it as the character record.
     */
    private function findCharacterRecord(array $data): ?array
    {
        foreach ($data as $key => $value) {
            if (is_array($value) && ($value['__type'] ?? null) === 'TFTCharacterRecord') {
                return $value;
            }
        }

        return null;
    }

    /**
     * Resolve each TraitData hash to a human-readable api_name by lookup in
     * the pre-computed map. Unresolved hashes are preserved with a null
     * api_name so we can spot traits missing from the DB.
     */
    private function resolveLinkedTraits(array $linkedTraits, array $traitHashMap): array
    {
        return array_map(function (array $entry) use ($traitHashMap) {
            $hash = $entry['TraitData'] ?? null;

            return [
                'hash' => $hash,
                'api_name' => $hash !== null ? ($traitHashMap[$hash] ?? null) : null,
            ];
        }, $linkedTraits);
    }

    /**
     * Count unresolved hash-like field keys in the record for diagnostics.
     * These are Riot fields whose names CDragon's hashlist hasn't cracked
     * yet. Low count = good import coverage, high count = consider updating
     * hashlists or adding manual decodes.
     */
    private function collectRawHashStats(array $record): array
    {
        $hashedKeys = 0;
        $namedKeys = 0;

        foreach (array_keys($record) as $key) {
            if (is_string($key) && str_starts_with($key, '{') && str_ends_with($key, '}')) {
                $hashedKeys++;
            } else {
                $namedKeys++;
            }
        }

        return [
            'named_fields' => $namedKeys,
            'hashed_fields' => $hashedKeys,
        ];
    }

    /**
     * Extract the set number from an api_name like "TFT17_MissFortune" → 17.
     * Falls back to 17 for set-less api_names since Set 17 is the current
     * focus; callers can override by fetching from DB if they know better.
     */
    private function extractSetNumber(string $apiName): int
    {
        if (preg_match('/^TFT(\d+)_/', $apiName, $matches)) {
            return (int) $matches[1];
        }

        return 17;
    }
}
