# Champion Ability Pipeline — End-to-End Walkthrough

> Reference documentation for how TFT Scout resolves champion abilities from
> CommunityDragon's raw BIN files all the way to the rendered React UI.
> Read this when you need to understand how the system produces what the
> user sees on `/champions/{api_name}` — including special cases like
> Miss Fortune's three variant forms and Aatrox's "Hero Augment" form.
>
> For *debugging* a specific bug, jump straight to
> [`docs/research/debugging-ability-data.md`](research/debugging-ability-data.md).
> For the empirical *research* that shaped this pipeline, see the four
> `docs/research/tft-*` documents.

---

## Table of Contents

1. [Why this is hard](#why-this-is-hard)
2. [Pipeline at a glance](#pipeline-at-a-glance)
3. [Stage 1 — Import entry point](#stage-1--import-entry-point)
4. [Stage 2 — Base data from `cdragon/tft/en_us.json`](#stage-2--base-data-from-cdragontften_usjson)
5. [Stage 3 — Character BIN inspection](#stage-3--character-bin-inspection)
6. [Stage 4 — Trait reference resolution (FNV-1a 32)](#stage-4--trait-reference-resolution-fnv-1a-32)
7. [Stage 5 — SpellObject extraction](#stage-5--spellobject-extraction)
8. [Stage 6 — Champion stat resolution](#stage-6--champion-stat-resolution)
9. [Stage 7 — Stringtable + RST hash (xxh3)](#stage-7--stringtable--rst-hash-xxh3)
10. [Stage 8 — Spell calculation evaluation](#stage-8--spell-calculation-evaluation)
11. [Stage 9 — Storage via hooks](#stage-9--storage-via-hooks)
12. [Stage 10 — Backend serialization](#stage-10--backend-serialization)
13. [Stage 11 — Frontend rendering](#stage-11--frontend-rendering)
14. [Worked example #1 — Aatrox base + Hero "Stellar Combo"](#worked-example-1--aatrox-base--hero-stellar-combo)
15. [Worked example #2 — Miss Fortune + 3 mode variants](#worked-example-2--miss-fortune--3-mode-variants)
16. [Variant pattern matrix](#variant-pattern-matrix)
17. [Full file map](#full-file-map)
18. [Glossary](#glossary)

---

## Why this is hard

Riot's TFT data ships in **BIN** files: a typed structured format where
every field name is a 32-bit FNV-1a hash, every cross-reference is a hash
or hashed binpath, and every conditional value lives in a tree of
`CalculationPart` nodes.

CommunityDragon (CDTB) decodes most of this and exposes a derived JSON
(`raw.communitydragon.org/{channel}/cdragon/tft/en_us.json`), but that
output is *minimal* — it's good enough for "what trait does this champion
belong to" and "what cost is it", but it strips a lot of what makes the
description text meaningful. In particular:

- Variant champions like Miss Fortune (Conduit / Challenger / Replicator
  forms) appear as a single base entry with a meta-description.
- Hero Augment champions like Aatrox don't expose their alternate spell
  ("Stellar Combo") at all.
- Calculated values like `@TotalDamage@` or `@ModifiedNumRockets@` aren't
  evaluated — placeholders sit unresolved in the description text.
- Conditional `<ShowIf.X>` blocks (N.O.V.A. Strike passive when DRX
  capstone active, Fateweaver Lucky keyword) are present in template but
  most consumers strip them.

This pipeline pulls the **raw** BIN data, walks it ourselves, and lands
fully-resolved templates in the database so the React frontend can render
them with no `[Stub]` fallbacks. Same code path handles every champion
shape — base-only, base + hero variant, base + traitclone forms,
Mecha-paired siblings — through three composable hooks plus a generic
inspector and resolver layer.

---

## Pipeline at a glance

```
                  ┌──────────────────────────────────────────────────┐
                  │              raw.communitydragon.org             │
                  │  cdragon/tft/en_us.json    game/characters/*     │
                  │  game/{locale}/data/menu/en_us/tft.stringtable   │
                  └────────────────┬─────────────────────────────────┘
                                   │ HTTP
                                   ▼
   ┌───────────────────────────────────────────────────────────────────┐
   │                       PHP services (app/Services/Tft)             │
   │                                                                   │
   │   FnvHasher  ◄── RstHasher ─── StringtableCache                   │
   │       │                          │                                │
   │       ▼                          ▼                                │
   │   CharacterBinInspector       AbilityDescriptionResolver          │
   │       │                          │                                │
   │       │                          ▼                                │
   │       │              SpellCalculationEvaluator                    │
   │       │                                                           │
   │       │              StatHashResolver  ──  TftStatHashRegistry    │
   │       └─────────────────────┬─────────────────────────────────────┘
   │                             │
   │                             ▼
   │           ┌──────────────────────────────────────────┐
   │           │           Import hooks (orchestrator)    │
   │           │                                          │
   │           │   1. RemoveNonPlayableHook (Set17)       │
   │           │   2. CharacterAbilityEnrichHook          │
   │           │   3. VariantChoiceHook                   │
   │           │   4. HeroAbilityVariantHook              │
   │           │   5. MechaEnhancedHook   (Set17)         │
   │           └──────────────────────┬───────────────────┘
   │                                  │ Eloquent writes
   │                                  ▼
   └──────────────────────────────────┬────────────────────────────────┘
                                      │
                                      ▼
                       ┌──────────────────────────────┐
                       │   PostgreSQL `champions`     │
                       │  ability_desc, ability_stats │
                       │  base_champion_id (variants) │
                       └──────────────┬───────────────┘
                                      │
                                      ▼
                  ChampionsController::show → Inertia props
                                      │
                                      ▼
                       Champions/Show.tsx
                       (parseAbilityDescription, renderAbilityTokens)
```

---

## Stage 1 — Import entry point

**File:** `app/Console/Commands/ImportCDragon.php` → `app/Services/Import/CDragonImporter.php`

The CLI command `php artisan tft:import [--set=17]` is a thin wrapper over
the importer service. CDragonImporter wraps the entire run in a single
DB transaction so a failed hook rolls back the whole import:

```php
DB::transaction(function () use ($setNumber, ...) {
    $set = $this->upsertSet($setNumber, $setData);
    $this->clearSetData($set);

    $traitMap = $this->importTraits($set, $setData['traits']);
    $this->importChampions($set, $setData['champions'], $traitMap, ...);
    $this->importItems(...);
    $this->resolveItemComponents();

    $this->runHooks($set);

    $set->update(['imported_at' => now()]);
});
```

**Hook execution order** is defined in `CDragonImporter::SET_HOOKS`:

```php
private const SET_HOOKS = [
    17 => [
        RemoveNonPlayableHook::class,         // 1. Set17 cleanup
        CharacterAbilityEnrichHook::class,    // 2. enrich every base champion
        VariantChoiceHook::class,             // 3. MF-style traitclone variants
        HeroAbilityVariantHook::class,        // 4. hero augment variants
        MechaEnhancedHook::class,             // 5. Mecha pairings
    ],
];
```

Order matters because hooks 3 and 4 both call the inspector — running
enrichment first warms the in-memory cache so variants don't re-fetch the
same BIN file.

---

## Stage 2 — Base data from `cdragon/tft/en_us.json`

**File:** `CDragonImporter::importChampions()`

The first import pass pulls each champion from CDragon's aggregated TFT
JSON. This gives us:

- `apiName` (`TFT17_Aatrox`), `name`, `cost`, `slots_used`
- Base stats: `hp`, `mana`, `armor`, `magic_resist`, `attack_damage`,
  `attack_speed`, `range`, `crit_chance`, `crit_multiplier`
- A trait list (resolved by name against the trait map built earlier)
- A *placeholder* `ability_desc` and `ability_stats` derived from
  CDragon's own decoder — usually a meta description that doesn't
  contain the real per-spell text we want.

This first pass creates the `champions` row but its `ability_desc` is
about to be **overwritten by the enrichment hook in Stage 9**.

---

## Stage 3 — Character BIN inspection

**File:** `app/Services/Tft/CharacterBinInspector.php`

The inspector is the only piece of code that talks to CDragon for
character-level data. Every hook that needs spell information goes
through it:

```php
$report = $this->inspector->inspect('TFT17_Aatrox');
```

### What it fetches

```
GET https://raw.communitydragon.org/pbe/game/characters/tft17_aatrox.cdtb.bin.json
```

This URL pattern (`game/characters/{api_name_lower}.cdtb.bin.json`) is
the **non-obvious** one — CommunityDragon's official docs point at
`game/data/characters/{name}/{name}.bin.json` for LoL champions, but
TFT17 puts everything in the parallel `game/characters/` tree under a
`.cdtb.bin.json` filename. See `docs/research/tft-character-bins-mechanics.md`
for the discovery story.

### What it returns

A normalized report:

```php
[
    'api_name' => 'TFT17_Aatrox',
    'set_number' => 17,
    'channel' => 'pbe',
    'main' => [
        'url' => 'https://raw.communitydragon.org/pbe/...',
        'character_name' => 'TFT17_Aatrox',
        'spell_names' => ['TFT17_Aatrox', '', '', ''],
        'linked_traits' => [
            ['hash' => '{e57dbbed}', 'api_name' => 'TFT17_DRX'],
            ['hash' => '{15312cd7}', 'api_name' => 'TFT17_ResistTank'],
        ],
        'hashed_stats' => [
            '{8662cf12}' => 590, '{4af40dc3}' => 53, ...
        ],
        'spells' => [/* every SpellObject in the bin, see Stage 5 */],
    ],
    'has_variant_choice' => false,    // true if {name}_TraitClone exists
    'trait_clone' => null,            // populated for MF
]
```

### In-memory cache

```php
private array $reportCache = [];   // keyed by "{channel}:{apiName}"
```

`CharacterAbilityEnrichHook` is the first hook to call `inspect()` for
every base champion. By the time `VariantChoiceHook` and
`HeroAbilityVariantHook` run, every base BIN is already cached, so they
re-use the parsed reports without HTTP overhead.

### Methods worth knowing

| Method | Role |
|---|---|
| `inspect()` | Public entry, builds full report, populates cache |
| `fetchAndParseCharacter()` | Single HTTP fetch + record extraction (called twice in `inspect` — once for main, once for `_TraitClone` sibling) |
| `findCharacterRecord()` | Locates the `TFTCharacterRecord` entry inside the bin's hash map |
| `buildTraitHashMap()` | Stage 4 helper |
| `extractSpellObjects()` | Stage 5 helper |
| `extractDataValues()` | Pulls `mSpell.DataValues` (handles old `mDataValues` / new `DataValues` rename) |
| `extractLocKeys()` | Pulls `mSpell.mClientData.mTooltipData.mLocKeys` |
| `extractHashedNumericStats()` | Stage 6 helper |
| `resolveLinkedTraits()` | Stage 4 helper |

---

## Stage 4 — Trait reference resolution (FNV-1a 32)

**Files:** `app/Services/Tft/FnvHasher.php`, `CharacterBinInspector::buildTraitHashMap()` + `resolveLinkedTraits()`

The `TFTCharacterRecord` includes a `mLinkedTraits` array of
`TFTTraitContributionData` entries. Each entry's `TraitData` field is a
hashed reference to a trait object that lives somewhere else in the
game data:

```json
"mLinkedTraits": [
    { "TraitData": "{e57dbbed}", "__type": "TFTTraitContributionData" },
    { "TraitData": "{15312cd7}", "__type": "TFTTraitContributionData" }
]
```

These hashes are *not* in any public CommunityDragon hashlist — we had
to reverse them ourselves. The empirical pattern that works:

```
FNV-1a 32 (lowercase) of  Maps/Shipping/Map22/Sets/TFTSet{N}/Traits/{trait_api_name}
```

`buildTraitHashMap()` builds a forward dict for every TFT17 trait we
already know about (44 entries from the en_us.json import in Stage 2):

```php
foreach (TftTrait::pluck('api_name') as $apiName) {
    $binpath = "Maps/Shipping/Map22/Sets/TFTSet{$setNumber}/Traits/{$apiName}";
    $map[FnvHasher::wrapped($binpath)] = $apiName;
}
```

`FnvHasher::hash()` is the canonical 8-line implementation:

```php
public static function hash(string $input): string
{
    $hash = self::OFFSET_BASIS;          // 0x811c9dc5
    foreach (unpack('C*', strtolower($input)) as $byte) {
        $hash ^= $byte;
        $hash = ($hash * self::PRIME) & self::MASK_32;   // 0x01000193 & 0xffffffff
    }
    return sprintf('%08x', $hash);
}
```

`resolveLinkedTraits()` then looks each `TraitData` hash up against the
map and returns `[{hash, api_name}, ...]`. Anything that doesn't resolve
gets `api_name => null` so we can spot brand-new traits introduced by
later patches.

---

## Stage 5 — SpellObject extraction

**File:** `CharacterBinInspector::extractSpellObjects()`

A character BIN contains many `SpellObject` entries side-by-side with
the `TFTCharacterRecord`. For Aatrox there are five:

```
TFT17_AatroxSpell           ← primary (Stellar Slash)
TFT17_AatroxSpellHero       ← hero variant (Stellar Combo)
TFT17_AatroxBasicAttack     ← basic attack helper
TFT17_AatroxCritAttack
TFT17_AatroxBasicAttack2
```

For each spell, the inspector pulls:

```php
[
    'bin_key'          => '{...}',                  // top-level FNV1a binpath hash
    'script_name'      => 'TFT17_AatroxSpell',      // mScriptName, used for matching
    'object_name'      => 'TFT17_AatroxSpell',      // ObjectName
    'animation'        => 'Spell',                  // mSpell.mAnimationName
    'cast_time'        => 0.25,                     // mSpell.mCastTime
    'cooldown_time'    => [1,1,1,1,1,1,1],          // per star level
    'cast_range'       => [2500,2500,...],
    'cast_cone_distance' => 100,
    'missile_speed'    => 1400,
    'data_values'      => [/* see below */],
    'calculations'     => [/* see Stage 8 */],
    'loc_keys'         => ['key_name' => 'Spell_TFT17_AatroxSpell_Name',
                           'key_tooltip' => 'Spell_TFT17_AatroxSpell_Tooltip'],
]
```

### `extractDataValues()`

`mSpell.DataValues` (or legacy `mDataValues`) is a list of
`{name, values}` objects. The `values` array always has 7 slots — the
TFT BIN convention is **slot 0 placeholder, slots 1–3 stars 1–3,
slot 4 hero augment / 4-star, slots 5–6 unused trail**. The inspector
preserves all 7 slots verbatim so the frontend can index into them
later via the constant `detectStatOffset() = 1` (`Champions/Show.tsx`).

For Aatrox primary:
```
HealHP                  [0.1,  0.1,  0.1,  0.1,  0.1,  0.1,  0.1]
HealAP                  [200,  300,  450,  675,  1125, 850,  850]
DamageAD                [200,  80,   120,  180,  300,  600,  600]
DamagePercentArmor      [1.0,  1.8,  2.7,  4.05, 6.9,  3.0,  3.0]
NOVAModifier            [0.5,  0.5,  0.5,  0.5,  0.5,  0.5,  0.5]
```

### `extractLocKeys()`

`mSpell.mClientData.mTooltipData.mLocKeys` carries **plaintext** RST
keys that point into the stringtable. These strings are NOT hashed in
the BIN — they appear as-is, which is critical because we use them as
input for the RST hasher in Stage 7.

For Aatrox primary:
```
keyName    = 'Spell_TFT17_AatroxSpell_Name'
keyTooltip = 'Spell_TFT17_AatroxSpell_Tooltip'
```

### Calculations passthrough

`mSpell.mSpellCalculations` is forwarded **raw** (no parsing) to the
spell entry. The actual evaluation happens in
`SpellCalculationEvaluator` (Stage 8) when the resolver needs the
final per-star numeric values.

---

## Stage 6 — Champion stat resolution

**Files:** `app/Services/Tft/TftStatHashRegistry.php`, `app/Services/Tft/StatHashResolver.php`

The `TFTCharacterRecord` has 9-15 hashed stat fields (HP, AD, armor,
move speed, attack range, …) wrapped in a `{ce9b917b}` container with a
single inner `{b35aa769}` (`baseValue`) field. The plaintext field names
are *not* publicly known — CDTB itself hardcodes magic numbers in
`tftdata.py` for them, and that's exactly what we do in
`TftStatHashRegistry`:

```php
public const MAP = [
    0x8662cf12 => 'hp',
    0x4af40dc3 => 'attack_damage',
    0xea6100d5 => 'armor',
    0x33c0bf27 => 'magic_resist',
    0x836cc82a => 'attack_speed_ratio',
    0x7bd4b298 => 'attack_range_units',  // ÷ 180 = hexes
    // ... 15 entries total, see file
];
```

`StatHashResolver::resolve()` first hits this hardcoded registry. For
any hash *not* in the registry, it falls back to **value matching**
against a reference champion (Miss Fortune, whose en_us.json stats we
trust): fetch her BIN, find which of her hashed values match her known
DB stats, build a runtime hash → stat name map, use that as a second
layer.

The combined output is `[{hash, stat, value, source}, ...]` where
`source` is `registry`, `value-match`, or `unresolved`.

The base import in Stage 2 already wrote the *interpreted* stats to the
champion row (because en_us.json gives clean names like `hp`, `mana`).
Stage 6's resolution is mostly used by the standalone inspector command
(`tft:inspect-character`) and to expose the registry to the frontend
debug table — not on the import write path.

---

## Stage 7 — Stringtable + RST hash (xxh3)

**Files:** `app/Services/Tft/StringtableCache.php`, `app/Services/Tft/RstHasher.php`, `app/Services/Tft/AbilityDescriptionResolver.php`

The plaintext loc keys we extracted in Stage 5
(`Spell_TFT17_AatroxSpell_Tooltip`) need to be resolved against
`tft.stringtable.json` to get the actual description template. The
stringtable is keyed by **xxh3_64 lowercase masked to 38 bits** for
TFT17 (game version >= 15.02).

### `StringtableCache`

Lazy-loads `tft.stringtable.json` (~21 MB) on first access:

```
GET https://raw.communitydragon.org/pbe/game/en_us/data/menu/en_us/tft.stringtable.json
```

Cached on disk under `storage/app/tft-cache/stringtable-pbe-en_us.json`
(gitignored) so subsequent imports skip the download. In-process
memoization avoids reparsing the JSON across hooks in the same import
transaction.

### `RstHasher`

The full algorithm in 6 lines:

```php
public static function hash(string $input, int $bits = 38): int
{
    $binary = hash('xxh3', strtolower($input), true);   // PHP 8.1+ native xxh3_64
    ['full' => $full] = unpack('Jfull', $binary);       // big-endian unsigned 64
    return $full & ((1 << $bits) - 1);
}
```

PHP's `hash('xxh3', ...)` returns 8 bytes (xxh3_64), not the 16-byte
xxh3_128 we initially thought — no composer dependency required.

`unpack('J')` is critical because `hexdec` falls back to float for
values larger than `PHP_INT_MAX` and silently loses the low bits we
actually need.

`formatAsKey()` wraps an int as `{0a82ed3819}` so it matches CDragon's
JSON dump format directly.

### `AbilityDescriptionResolver::resolve()`

The orchestrator. Inputs: a spell's `loc_keys`, its `data_values`,
optional `calculations`, and optional `championStats`. Output:

```php
[
    'name'         => 'Stellar Slash',          // from key_name lookup
    'template'     => '<scaleHealth>@ModifiedHeal@...',  // from key_tooltip lookup
    'rendered'     => '<scaleHealth>305...',    // template rendered at given star
    'merged_stats' => [                         // data + calc merged
        ['name' => 'HealHP',         'value' => [...]],
        ['name' => 'HealAP',         'value' => [...]],
        ['name' => 'ModifiedHeal',   'value' => [...], 'kind' => 'calculated'],
        ['name' => 'ModifiedDamage', 'value' => [...], 'kind' => 'calculated'],
        ['name' => 'ModifiedNovaDamage', 'value' => [...], 'kind' => 'calculated'],
    ],
]
```

The resolver:

1. Calls `StringtableCache::entries()` once.
2. RST-hashes both `key_name` and `key_tooltip`, looks them up in the
   entries dict.
3. Calls `mergeDataValuesWithCalculations()` — see Stage 8 for the
   merge logic.
4. Renders the template via `renderTemplate()` — substitutes
   `@VarName@` and `@VarName*N@` placeholders against the merged stats
   at the requested star level.
5. Returns the bundle above.

When the import hooks call `resolve()`, they pass `starLevel: 0` and
ignore the `rendered` field — only the template + merged_stats land in
the database, and the frontend renders per star at view time.

---

## Stage 8 — Spell calculation evaluation

**File:** `app/Services/Tft/SpellCalculationEvaluator.php`

The hardest part of the pipeline. `mSpellCalculations` is a tree of
typed nodes that implement Riot's runtime damage / heal / scaling
formulas. Some are simple (sum two data values), others are recursive
(reference other entries by hash), conditional, or tied to champion
stats.

### Supported node types

| Type | Shape | Behaviour |
|---|---|---|
| `SumOfSubPartsCalculationPart` | `{mSubparts: [...]}` | Recursive sum over children |
| `SubPartScaledProportionalToStat` | `{mSubpart, mRatio, mStat?}` | `dataValue × mRatio`. **No mStat** → multiply by 100 (implicit AP base). **mStat present** → flat (already in display units) |
| `NamedDataValueCalculationPart` | `{mDataValue}` | Direct DataValue lookup (by name OR by FNV-1a 32 hash) |
| `NumberCalculationPart` | `{mNumber}` | Literal constant |
| `ProductOfSubPartsCalculationPart` | `{mPart1, mPart2}` | `mPart1 × mPart2` (Riot uses `mPart1`/`mPart2` here, **not** `mSubparts`) |
| `ExponentSubPartsCalculationPart` | `{part1, part2}` (lowercase!) | `part1 ^ part2`. Returns null on `0 ** -n` to avoid div by zero |
| `ClampSubPartsCalculationPart` | `{mSubparts, mFloor, mCeiling}` | Sum then clamp; null bounds → ±∞ |
| `StatByCoefficientCalculationPart` | `{mStat, mStatFormula, mCoefficient}` | `mCoefficient × championStats[mStat]` |
| `BuffCounterByNamedDataValueCalculationPart` | `{mBuffName, mDataValue}` | Returns dataValue directly (per-stack display value, ignoring runtime buff count) |
| `ByNamedSpellCalculationSubPart` (detected by `mSpellCalculationKey` presence) | `{mSpellCalculationKey}` | Recursive lookup of another calc in the same `mSpellCalculations` map |

Anything else returns `null`, which propagates up the tree. If a calc's
top level evaluates to null, the whole calc is dropped from the output —
the frontend then falls back to its `[Stub]` placeholder behaviour
rather than rendering a wrong number.

### `championStats` and `mStat` enum

`StatByCoefficientCalculationPart` looks champion stats up by an
`mStat` enum value. Only one mapping is empirically confirmed so far:

```
4  →  attack_speed (Jinx NumRockets verified)
```

`CharacterAbilityEnrichHook`, `VariantChoiceHook`, `HeroAbilityVariantHook`,
and `InspectCharacterBin` each build the championStats dict before
calling the resolver. Adding a new mStat means updating those four call
sites — there's a TODO to extract this into a shared helper once a
second enum value gets confirmed.

### Plaintext vs hashed calc keys

A calc dict can contain both:

```
"ModifiedDamage": { ... }            ← plaintext, matches @ModifiedDamage@ directly
"{507ceefd}":     { ... }            ← hashed, plaintext name unknown to CDragon
```

The hashed ones are still useful: the resolver extracts every `@Name@`
placeholder from the description template, FNV-1a 32 hashes those names,
and reverse-matches against the calc dict's hashed keys. So if the
template references `@ModifiedNovaDamage@` and `fnv1a32('ModifiedNovaDamage')
== 507ceefd`, that calc gets emitted under the plaintext name even though
its dict key is hashed.

This is how Aatrox's `ModifiedNovaDamage` (DRX N.O.V.A. Strike damage)
resolves despite Riot using a hashed key for it.

### `mergeDataValuesWithCalculations()`

The output list interleaves DataValues and calculation results:

```
[
    {name: 'HealHP', value: [...]},                 // raw DataValue
    {name: 'HealAP', value: [...]},
    {name: 'DamageAD', value: [...]},
    ...
    {name: 'ModifiedHeal', value: [...], kind: 'calculated'},
    {name: 'ModifiedDamage', value: [...], kind: 'calculated'},
    {name: 'ModifiedNovaDamage', value: [...], kind: 'calculated'},
]
```

`kind: 'calculated'` is the only marker distinguishing computed values
from raw DataValues — used by the frontend to render an `fx` badge in
the debug table.

---

## Stage 9 — Storage via hooks

Three hooks write the actual ability data into the database. They all
call the same inspector + resolver but make different decisions about
what ends up in the `champions` table.

### 9a. CharacterAbilityEnrichHook

**File:** `app/Services/Import/SetHooks/Shared/CharacterAbilityEnrichHook.php`

Runs for every base champion. Resolves the **primary spell** and
overwrites the placeholder data that Stage 2 wrote.

```php
foreach ($baseChampions as $champion) {
    $report = $this->inspector->inspect($champion->api_name);    // ← cache miss, HTTP fetch
    $primary = $this->findPrimarySpell($report['main']['spells'], $report['main']['spell_names'][0]);

    $resolved = $this->abilityResolver->resolve(
        $primary['loc_keys'],
        $primary['data_values'],
        starLevel: 0,
        calculations: $primary['calculations'],
        championStats: $this->buildChampionStatsForEvaluator($champion),
    );

    $champion->update([
        'ability_desc'  => $resolved['template'],
        'ability_stats' => $resolved['merged_stats'],
    ]);
}
```

**`findPrimarySpell()`** has a fallback ladder:

1. Exact `script_name` match against `spellNames[0]` basename.
2. If miss, try with `'spell'` appended — handles champions like
   Aatrox whose `spellNames[0]` is just `'TFT17_Aatrox'` without the
   `Spell` suffix.

### 9b. VariantChoiceHook

**File:** `app/Services/Import/SetHooks/Shared/VariantChoiceHook.php`

Handles the **TraitClone** mechanic. Detection:
`{api_name}_TraitClone.cdtb.bin.json` exists as a sibling file with its
own `TFTCharacterRecord`.

In TFT17 only Miss Fortune uses this mechanic (TFT15 Lee Sin was the
historical precedent). The character clone is a "virtual" entity Riot
uses to encode the three selectable mode traits — Conduit/Challenger/
Replicator. The clone's `mLinkedTraits` lists the three variant traits
as resolved hashes.

For each variant trait, the hook creates a new `Champion` row:

```php
$variant = Champion::create([
    'set_id'           => $base->set_id,
    'api_name'         => $base->api_name . '_' . $variantLabel,
    'name'             => $base->name . ' (' . ucfirst($variantLabel) . ')',
    // copy stats from base
    'hp' => $base->hp, ... ,
    'ability_desc'     => $variantAbility['desc'],
    'ability_stats'    => $variantAbility['stats'],
    'base_champion_id' => $base->id,
    'variant_label'    => $variantLabel,
    'role'             => $override['role'],
    // ... role metadata from config/tft.php
]);
```

Crucially, the hook **demotes the base** (`is_playable = false`) because
in-game you can't field "raw" Miss Fortune — you must pick one of the
three modes.

The **stance spell** for each variant is found in the main BIN via
`{primary_spell}_{StanceName}` (e.g. `TFT17_MissFortuneSpell_ManaTraitStance`
for Conduit). The mapping from variant trait api_name to stance suffix
lives in `config/tft.php`:

```php
'TFT17_ManaTrait' => [
    'variant_label' => 'conduit',
    'role'          => 'APCaster',
    ...
    'stance_spell'  => 'ManaTraitStance',
],
```

This is the *only* hardcoded knowledge in the variant pipeline — the
detection itself is fully generic.

### 9c. HeroAbilityVariantHook

**File:** `app/Services/Import/SetHooks/Shared/HeroAbilityVariantHook.php`

Handles the **Hero Augment** mechanic. Detection: a sibling SpellObject
inside the **same character bin** named `{primary_script_name}Hero`
(e.g. `TFT17_AatroxSpellHero` next to `TFT17_AatroxSpell`).

For each champion that has one, creates a variant Champion row exactly
like VariantChoiceHook, with `variant_label = 'hero'`. The hero
ability's resolved name (`'Stellar Combo'` from the stringtable) is
used in the variant's display name: `Aatrox (Stellar Combo)`.

**Unlike VariantChoiceHook, this hook does NOT demote the base.** Hero
Augments are an optional pickup, not a mandatory form selection — the
base champion stays playable and the hero variant is shown alongside it
in the variant selector.

In TFT17 six champions get hero variants this way: Aatrox, Gragas,
Jax, Nasus, Poppy, and Meepsie (TFT17_IvernMinion).

### 9d. MechaEnhancedHook (Set17 specific)

**File:** `app/Services/Import/SetHooks/Set17/MechaEnhancedHook.php`

Hardcoded list of base ↔ enhanced champion pairings (Galio + Galio Enhanced
etc.). Same variant row pattern but the trait/role data is hardcoded
because the BIN doesn't expose the relationship cleanly.

---

## Stage 10 — Backend serialization

**File:** `app/Http/Controllers/ChampionsController.php`

`ChampionsController::show($apiName)` loads the champion plus its
variants and serializes them for Inertia:

```php
public function show(string $apiName): Response
{
    $champion = Champion::query()
        ->with([
            'traits' => fn ($q) => $q->orderBy('category')->orderBy('api_name'),
            'variants.traits',
            'baseChampion.variants.traits',
            'baseChampion.traits',
        ])
        ->where('api_name', $apiName)
        ->firstOrFail();

    // Build variant selector list — base + all variants
    $baseChampion = $champion->base_champion_id === null
        ? $champion
        : $champion->baseChampion;

    $forms = collect();
    if ($baseChampion->is_playable) {
        $forms->push($baseChampion);
    }
    foreach ($baseChampion->variants as $variant) {
        $forms->push($variant);
    }

    return Inertia::render('Champions/Show', [
        'champion' => $this->serializeChampion($champion),
        'variants' => $forms->map(fn ($v) => $this->serializeChampion($v))->all(),
        'rating'   => null,    // MetaTFT placeholder
    ]);
}
```

`serializeChampion()` returns:

```php
[
    'id', 'api_name', 'name', 'cost', 'role', 'damage_type', 'role_category',
    'is_playable', 'variant_label', 'base_champion_api_name',
    'stats' => [hp, armor, magic_resist, attack_damage, attack_speed,
                mana, start_mana, range, crit_chance, crit_multiplier],
    'ability_desc',     // template with @placeholders@
    'ability_stats',    // merged data + calculated
    'traits' => [{api_name, name, category}, ...],
]
```

Variants and base share the same shape — the frontend doesn't need
special-case logic.

---

## Stage 11 — Frontend rendering

**File:** `resources/js/pages/Champions/Show.tsx`

The React component renders the champion detail page. Key bits:

### Variant selector

```tsx
<VariantList variants={variants} currentApiName={champion.api_name} />
```

Same component handles MF forms (Conduit/Challenger/Replicator), Mecha
pairs, and hero variants — they all live in the `variants` array with
distinct `variant_label` values. Clicking a variant triggers Inertia
navigation to `/champions/{variant_api_name}`, and the controller
reloads with that variant as the focused champion.

### Star level state

```tsx
const [starLevel, setStarLevel] = useState(1);   // 1 by default
```

User toggles between 1/2/3 via a button group; rendering re-runs
through `useMemo` whenever it changes.

### Template parsing pipeline

```tsx
const parsedAbility = useMemo(
    () => parseAbilityDescription(
        champion.ability_desc,
        champion.ability_stats,
        starLevel,
        statOffset,    // always 1 — see detectStatOffset comment
    ),
    [champion.ability_desc, champion.ability_stats, starLevel, statOffset],
);
```

### `parseAbilityDescription()`

Composes three steps:

1. **`cleanDescription()`** — preprocesses the raw template:
   - Converts `<br>` → newlines
   - Inserts missing `%` on `%i:scaleX)` markers (Riot bug)
   - Replaces consecutive `%i:scaleX%` markers with `(AD+AP)` style labels
   - Strips `&nbsp;`, collapses whitespace
   - **Preserves** `<ShowIf.X>` blocks — they're handled in the tokenizer

2. **`renderAbilityTokens()`** — recursive regex tokenizer:

   ```js
   /<([\w.]+)(?:\s[^>]*)?>([\s\S]*?)<\/\1>|@([A-Za-z][A-Za-z0-9_]*)(?:\*(\d+(?:\.\d+)?))?@/g
   ```

   Matches either an HTML-like tag (`<physicalDamage>X</physicalDamage>`)
   or a placeholder (`@VarName@` or `@VarName*N@`).

   - **Tag branch**:
     - `<ShowIf.TFT17_DRX_CapstoneActive>` → italic muted span with
       `title="Only active when DRX active"`. Inner content is
       recursively tokenised so any nested `<scaleLevel>` /
       `@Modified...@` still renders correctly.
     - `<physicalDamage>`, `<scaleHealth>`, `<TFTBonus>`, etc. → mapped
       to Tailwind colour classes via `TAG_CLASS_MAP`.
     - Unknown tags → unwrapped (content rendered without a wrapper).

   - **Placeholder branch**:
     - `resolvePlaceholderStat(varName, stats)` searches the merged
       stats list:
       1. Exact match (case-insensitive, also tries with `Modified`
          prefix stripped).
       2. Prefix match (`@Damage@` finds `DamageAD`, `DamagePercentArmor`).
       3. Substring match.
       4. `@Modified*@` fallback to any `*Scaling$` stat.
     - `getStarValue(stat, starLevel, offset=1)` indexes
       `stat.value[offset + starLevel - 1]`.
     - `formatStatValue(value, {stat, suppressUnitSuffix: true})`
       returns the display string. Treats values < 1 as ratios (× 100,
       `0.3 → '30'`); integer-ish values render as ints; the
       `suppressUnitSuffix` flag prevents double `%` when the template
       carries a literal `%` after the placeholder.
     - `autoColorForStat()` adds an inline color class when the
       placeholder isn't already inside a known color tag.

3. **JSX assembly** — the recursive tokenizer accumulates a list of
   either plain text fragments or `<span>` React elements with the
   appropriate Tailwind classes. The whole thing renders inside a
   `whitespace-pre-wrap` paragraph so the `\n` from `<br>` conversion
   becomes visible line breaks.

---

## Worked example #1 — Aatrox base + Hero "Stellar Combo"

### Run

```
php artisan tft:import
```

### Stage 2 (en_us.json import)

Creates row `champions: TFT17_Aatrox` with:
- cost = 5
- hp/mana/etc. from en_us.json stats
- A bare-bones `ability_desc` from CDragon's decoder (often a meta
  description that doesn't reference the spell text)

### Stage 3 — Inspector fetches BIN

`CharacterBinInspector::inspect('TFT17_Aatrox')`:

```
GET https://raw.communitydragon.org/pbe/game/characters/tft17_aatrox.cdtb.bin.json
```

Caches the parsed report under `'pbe:TFT17_Aatrox'`.

### Stage 4 — Trait resolution

`mLinkedTraits` resolves to:
- `{e57dbbed}` → `TFT17_DRX`
- `{15312cd7}` → `TFT17_ResistTank`

### Stage 5 — Five SpellObjects

Inspector returns five spells:
- `TFT17_AatroxSpell` (primary, Stellar Slash)
- `TFT17_AatroxSpellHero` (hero, Stellar Combo)
- `TFT17_AatroxBasicAttack` / `Attack2` / `CritAttack`

### Stage 9a — CharacterAbilityEnrichHook (primary)

`spellNames[0] = 'TFT17_Aatrox'` (no Spell suffix → fallback ladder).

`findPrimarySpell()` exact-match on `'tft17_aatrox'` misses; retry with
`'tft17_aatroxspell'` matches `TFT17_AatroxSpell`.

`AbilityDescriptionResolver::resolve()`:

1. Stringtable lookup for `Spell_TFT17_AatroxSpell_Tooltip`:
   - `RstHasher::key(...)` → e.g. `{0a82ed3819}`
   - `entries[$key]` → template text:
     ```
     "Heal <scaleHealth>@ModifiedHeal@&nbsp;(%i:scaleAP%)</scaleHealth>,
      then deal <physicalDamage>@ModifiedDamage@&nbsp;(%i:scaleAD%%i:scaleArmor%)</physicalDamage>
      physical damage to the target. The first time this hits a target,
      deal <magicDamage>@ModifiedNovaDamage@</magicDamage> bonus magic
      damage to nearby enemies."
     ```

2. `SpellCalculationEvaluator::evaluate(calculations, dataValues, ['ModifiedHeal','ModifiedDamage','ModifiedNovaDamage'], championStats)`:

   - `ModifiedHeal` (plaintext key) → walk formula, returns
     `[200, 300, 450, 675, 1125, 850, 850]`
   - `ModifiedDamage` (plaintext key) →
     `SumOfSubParts(SubPartScaledProportionalToStat(DamageAD, 1.0, mStat=3),
                    SubPartScaledProportionalToStat(DamagePercentArmor, 1.0, mStat=1))`
     evaluates to `DamageAD + DamagePercentArmor` = `[201, 81.8, 122.7, 184.05, 306.9, 603, 603]`
     (mStat=1 currently treated as flat — known limitation)
   - `{507ceefd}` (hashed key) → reverse-resolve via
     `fnv1a32('modifiednovadamage') == 507ceefd` →
     `Product(ByNamedSpellCalculationKey('ModifiedDamage'),
              NamedDataValueCalculationPart({ef3f3046}))`
     where `{ef3f3046} = NOVAModifier = 0.5`. Recursive sub-call to
     `ModifiedDamage` then `× 0.5` → `[100.5, 40.9, 61.35, 92.025, ...]`.

3. `mergeDataValuesWithCalculations()` produces a 8-entry list:
   raw `HealHP/HealAP/DamageAD/DamagePercentArmor/NOVAModifier` + calculated
   `ModifiedHeal/ModifiedDamage/ModifiedNovaDamage`.

4. Hook writes:
   ```php
   $champion->update([
       'ability_desc'  => $template,         // raw with @placeholders@
       'ability_stats' => $merged_stats,     // 8 entries
   ]);
   ```

### Stage 9c — HeroAbilityVariantHook (Stellar Combo)

`inspector->inspect('TFT17_Aatrox')` → **cache hit**, no second HTTP.

`findHeroSibling($spells, 'TFT17_AatroxSpell')` → looks for
`'tft17_aatroxspellhero'` → matches `TFT17_AatroxSpellHero`.

Resolver call with hero spell's data:
- Loc keys: `Spell_TFT17_AatroxSpellHero_Name`, `..._Tooltip`
- Stringtable returns name `'Stellar Combo'` and a much longer
  template with rotating Strike/Sweep/Slam sections.
- Hero spell has 9 DataValues and 5 calculations
  (`ModifiedStrikeDamage`, `ModifiedSweepDamage`, `ModifiedSlamDamage`,
  `ModifiedNovaDamage`, `ModifiedSweepArmor`).

Hook creates a new Champion row:

```php
Champion::create([
    'api_name'         => 'TFT17_Aatrox_hero',
    'name'             => 'Aatrox (Stellar Combo)',
    'cost'             => 5,             // copied
    'role'             => $base->role,   // copied
    // all stats copied from base
    'ability_desc'     => $heroTemplate,
    'ability_stats'    => $heroMergedStats,
    'base_champion_id' => $base->id,
    'variant_label'    => 'hero',
]);

// pivot copies base's traits
$variant->traits()->sync($base->traits()->pluck('traits.id')->all());
```

Base Aatrox stays `is_playable = true`.

### Stage 10/11 — User visits /champions/TFT17_Aatrox

Controller serializes base + variants. Frontend renders:

- **Header**: Aatrox, 5-cost, traits `DRX`, `ResistTank`
- **Variant selector**: `Aatrox` ⟷ `Aatrox (Stellar Combo)`
- **Stats card**: hp/ad/etc. from base
- **Ability card**:
  ```
  Heal 305, then deal 82 physical damage to the target. The first
  time this hits a target, deal 41 bonus magic damage to nearby
  enemies.
  ```
  (with color tags rendered, `@ModifiedHeal@` → 305 etc.)

Click the variant selector → navigate to `/champions/TFT17_Aatrox_hero`.
Same component, different `champion` prop, renders the Stellar Combo
template instead with all five Modified* placeholders populated.

---

## Worked example #2 — Miss Fortune + 3 mode variants

### Stage 2 — base import

Creates `champions: TFT17_MissFortune` with bare en_us.json data and
default ability_desc (a meta "choose one of three modes" text).

### Stage 3 — Inspector

`inspect('TFT17_MissFortune')` fetches the main BIN and **also** tries
`inspect('TFT17_MissFortune_TraitClone')` — that file exists, so
`has_variant_choice = true` and the report includes a `trait_clone`
section with its own `mLinkedTraits`.

The clone's linked traits list contains three trait references which
resolve via the Stage 4 binpath pattern:
- `TFT17_ManaTrait` (Conduit Mode)
- `TFT17_ASTrait` (Challenger Mode)
- `TFT17_APTrait` (Replicator Mode)

### Stage 9a — Primary enrichment (base MF spell)

`CharacterAbilityEnrichHook` resolves the base spell
`TFT17_MissFortuneSpell` via the same resolver flow as Aatrox, writes
the meta template to `champions.ability_desc`. This is the "Field Miss
Fortune to choose..." text — short, meta-level.

### Stage 9b — VariantChoiceHook creates three variant rows

```php
foreach ($variantTraitApiNames as $variantTraitApiName) {
    // ['TFT17_ManaTrait', 'TFT17_ASTrait', 'TFT17_APTrait']

    $override = config("tft.variant_overrides.{$variantTraitApiName}");
    // For TFT17_ManaTrait:
    //   variant_label = 'conduit'
    //   role          = 'APCaster'
    //   damage_type   = 'AP'
    //   role_category = 'Caster'
    //   stance_spell  = 'ManaTraitStance'

    // Find the matching stance spell in the BIN's spells list
    $stanceSpell = $this->findStanceSpell($mainSpells, 'ManaTraitStance');
    // Looks for script_name ending with 'ManaTraitStance'
    // → TFT17_MissFortuneSpell_ManaTraitStance

    // Resolve THAT spell (its own loc keys + calcs)
    $resolved = $this->abilityResolver->resolve(
        $stanceSpell['loc_keys'],
        $stanceSpell['data_values'],
        starLevel: 0,
        calculations: $stanceSpell['calculations'],
        championStats: [4 => $base->attack_speed],
    );

    Champion::create([
        'api_name'         => 'TFT17_MissFortune_conduit',
        'name'             => 'Miss Fortune (Conduit)',
        'role'             => 'APCaster',
        'damage_type'      => 'AP',
        'role_category'    => 'Caster',
        // base stats copied
        'ability_desc'     => $resolved['template'],     // Conduit Mode template
        'ability_stats'    => $resolved['merged_stats'], // Conduit-specific calcs
        'base_champion_id' => $base->id,
        'variant_label'    => 'conduit',
    ]);

    // Trait pivot: keep base's UniqueTrait, drop hidden Undetermined,
    // add the variant trait (TFT17_ManaTrait for Conduit)
    $variant->traits()->sync(/* combined trait IDs */);
}

// Crucially:
$base->update(['is_playable' => false]);
```

The base champion is demoted because in-game you can never field
"plain" Miss Fortune — you must pick a mode at the start of combat.

After this hook three variants exist:
- `TFT17_MissFortune_conduit` — Conduit Mode template + Mana trait
- `TFT17_MissFortune_challenger` — Challenger Mode template + AS trait
- `TFT17_MissFortune_replicator` — Replicator Mode template + AP trait

Each has a fully different `ability_desc` template resolved from a
different stance spell's loc keys, so the player sees three distinct
descriptions in the variant selector.

### Stage 9c — HeroAbilityVariantHook

Iterates over base champions. MF base has no `_Hero` sibling spell, so
the hook is a no-op for MF. (The three MF variants aren't iterated
because they have `base_champion_id != null`.)

### Stage 10/11 — User visits /champions/TFT17_MissFortune

Controller's `show()` follows the variant relationship:

```php
$baseChampion = $champion->base_champion_id === null
    ? $champion        // direct visit
    : $champion->baseChampion;

$forms = collect();
if ($baseChampion->is_playable) {       // false for MF
    $forms->push($baseChampion);
}
foreach ($baseChampion->variants as $variant) {
    $forms->push($variant);             // pushes 3 MF mode variants
}
```

Because MF base is non-playable, the user lands on one of the variants
(typically the first one in `variants`) — or the controller could be
extended to redirect. The variant selector shows three buttons:
**Conduit / Challenger / Replicator**.

Each variant renders its mode-specific ability description via the same
React pipeline as Aatrox.

---

## Variant pattern matrix

| Champion shape | Detection signal | Hook | Demotes base? | Example |
|---|---|---|---|---|
| Plain champion | none (default) | CharacterAbilityEnrichHook only | n/a | Akali, Caitlyn |
| Hero augment | `{primary_script_name}Hero` SpellObject in main bin | HeroAbilityVariantHook | No | Aatrox, Gragas, Jax, Nasus, Poppy, Meepsie |
| TraitClone (mode select) | `{api_name}_TraitClone.cdtb.bin.json` sibling file | VariantChoiceHook | **Yes** | Miss Fortune (Conduit/Challenger/Replicator) |
| Mecha pair | hardcoded in MechaEnhancedHook | MechaEnhancedHook | No | Galio + Galio Enhanced |

All four shapes use the **same** database schema:
- `champions.base_champion_id` foreign key links variants to base
- `champions.variant_label` distinguishes them (`conduit`, `hero`,
  `enhanced`, etc.)
- `champions.ability_desc` and `champions.ability_stats` are
  variant-specific
- The `champions.is_playable` flag is the only thing that varies per
  pattern

The frontend doesn't need to know which pattern produced a variant —
it just renders whatever rows the controller hands back.

---

## Full file map

In execution order on a single ability render path:

| # | File | Role |
|---|---|---|
| 1 | `app/Console/Commands/ImportCDragon.php` | CLI command `tft:import` |
| 2 | `app/Services/Import/CDragonImporter.php` | Transaction orchestration, hook order |
| 3 | `app/Models/Set.php` / `Champion.php` / `TftTrait.php` / `Item.php` etc. | Eloquent models |
| 4 | `app/Casts/PostgresArray.php` | Cast for Postgres `text[]` columns |
| 5 | `app/Services/Tft/FnvHasher.php` | FNV-1a 32 lowercase (BIN field/path hashes) |
| 6 | `app/Services/Tft/RstHasher.php` | xxh3_64 lowercase + 38-bit mask (RST stringtable keys) |
| 7 | `app/Services/Tft/StringtableCache.php` | Lazy 21 MB stringtable fetch + on-disk cache |
| 8 | `app/Services/Tft/CharacterBinInspector.php` | HTTP fetch of `game/characters/*.cdtb.bin.json`, parse, cache |
| 9 | `app/Services/Tft/SpellCalculationEvaluator.php` | mSpellCalculations formula tree walker |
| 10 | `app/Services/Tft/AbilityDescriptionResolver.php` | RST lookup + DataValues/calc merge + template render |
| 11 | `app/Services/Tft/StatHashResolver.php` | Hashed stat → semantic name (registry + value-match fallback) |
| 12 | `app/Services/Tft/TftStatHashRegistry.php` | Hardcoded 15 stat hashes (CDTB-style magic numbers) |
| 13 | `app/Services/Import/Contracts/PostImportHook.php` | Hook interface |
| 14 | `app/Services/Import/SetHooks/Set17/RemoveNonPlayableHook.php` | Set17 cleanup |
| 15 | `app/Services/Import/SetHooks/Shared/CharacterAbilityEnrichHook.php` | Base champion ability enrichment (every champion) |
| 16 | `app/Services/Import/SetHooks/Shared/VariantChoiceHook.php` | TraitClone variants (MF) |
| 17 | `app/Services/Import/SetHooks/Shared/HeroAbilityVariantHook.php` | Hero Augment variants (Aatrox etc.) |
| 18 | `app/Services/Import/SetHooks/Set17/MechaEnhancedHook.php` | Hardcoded Mecha pairings |
| 19 | `config/tft.php` | `variant_overrides` — UX metadata for MF variants |
| 20 | `app/Http/Controllers/ChampionsController.php` | `show()` serialization, variant list |
| 21 | `resources/js/pages/Champions/Show.tsx` | React page, variant selector, ability rendering |
| 22 | `resources/js/pages/Champions/Index.tsx` | Champion browser, links into Show |
| 23 | `app/Console/Commands/InspectCharacterBin.php` | Standalone debug command (`tft:inspect-character`) |
| 24 | `database/migrations/2026_04_09_120005_create_champions_table.php` | Champions schema |

Plus persistent storage:
- `champions` table — `ability_desc text`, `ability_stats jsonb`,
  `base_champion_id bigint references champions(id)`, `variant_label
  varchar`
- `storage/app/tft-cache/stringtable-{channel}-{locale}.json` — lazy
  stringtable cache (gitignored)
- `storage/tft-bin-cache/` — local research dumps (gitignored)

---

## Glossary

**BIN file** — Riot's typed structured data format. Field names are
FNV-1a 32 hashes; CommunityDragon decodes them to `*.bin.json` and
publishes both the LoL convention (`game/data/characters/{name}/{name}.bin.json`)
and a TFT-specific consolidated form
(`game/characters/{name}.cdtb.bin.json`).

**FNV-1a 32** — The hash function used for every field name, type
name, and binpath inside BIN files. Always computed on the **lowercased**
input.

**RST** — Riot String Table. Binary format Riot uses to ship localised
strings; CDragon converts to JSON. Keys are hashed via xxh3_64 truncated
to 38 bits (TFT 15.02+) or 39 bits (earlier TFT).

**Loc key** — A plaintext string like
`Spell_TFT17_AatroxSpell_Tooltip` stored as a literal value inside
`mClientData.mTooltipData.mLocKeys`. Hashes via `RstHasher::key()` to
look up the actual translated text.

**DataValue** — Static per-spell variable, named (`ADDamage`,
`DamageFalloff`) with a 7-element array of values across star levels.
Stored under `mSpell.DataValues[]`.

**Calculation** — Computed variable (e.g. `TotalDamage`,
`ModifiedNumRockets`) defined as a formula tree under
`mSpell.mSpellCalculations`. Tree nodes are listed in [Stage 8](#stage-8--spell-calculation-evaluation).

**TraitClone** — A separate `TFTCharacterRecord` shipped in a sibling
bin (`{api_name}_TraitClone.cdtb.bin.json`). Used as a virtual entity
to encode "pick one of N traits" mechanics. TFT15 Lee Sin and TFT17
Miss Fortune are the two confirmed cases.

**Hero Augment** — A separate `SpellObject` shipped inside the same
character bin under `{primary_script_name}Hero`. Replaces the primary
spell when the player picks up a specific Hero Augment in-game. TFT17
ships 6 of these.

**Stance spell** — Riot's internal name for a per-variant SpellObject
within Miss Fortune's bin (`TFT17_MissFortuneSpell_ManaTraitStance`,
etc.). Mapped to user-facing variants via `config/tft.php`.

**Variant Champion row** — A row in the `champions` table with
`base_champion_id` set. Stores its own `ability_desc` and
`ability_stats` while inheriting most other data from the base. Created
by VariantChoiceHook, HeroAbilityVariantHook, or MechaEnhancedHook.

---

## When something breaks

Use `tft:inspect-character {api_name}` first — it runs the entire
pipeline read-only and dumps a structured report:

```bash
php artisan tft:inspect-character TFT17_Aatrox --star=2 --json > /tmp/debug.json
```

Then consult [`docs/research/debugging-ability-data.md`](research/debugging-ability-data.md)
for the symptom → layer → fix lookup table and the playbook for adding
new mSpellCalculations node types or mStat enum values.

For deeper background on individual algorithmic decisions:
- `docs/research/tft-data-sources.md` — where CDragon hosts what
- `docs/research/cdtb-vs-http.md` — why we don't mirror CDTB locally
- `docs/research/tft-character-bins-mechanics.md` — variant detection,
  TraitClone discovery
- `docs/research/tft-hash-discovery.md` — FNV-1a / xxh3 algorithm
  derivation, stat hash registry origin
