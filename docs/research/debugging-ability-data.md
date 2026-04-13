# Debug workflow — TFT ability data issues

**Purpose:** when a user reports an ability displaying wrong (wrong numbers,
unresolved placeholders, malformed formatting), this is the playbook for
finding and fixing the problem without rediscovering tools each time.

## 0. Triage — what layer is broken?

User reports typically look like one of these:

| Symptom | Likely layer |
|---|---|
| `[SomeName]` stub where a number should be | Frontend fallback — placeholder not matched in `ability_stats` |
| Number is wrong by factor of 100 / off-by-one | Evaluator math or frontend `formatStatValue` |
| Star-level values shifted (2★ shows 1★ number) | `detectStatOffset` / BIN array indexing |
| `%%` double percent, raw `<tag>` leaks, markup visible | Frontend `cleanDescription` or `renderAbilityTokens` |
| Calc renders as `0` across all stars | Evaluator returned null for a nested node — unsupported type |
| Variant (MF conduit/etc.) shows base meta-desc | `VariantChoiceHook` didn't match the stance spell |

Start narrow: identify which champion + which placeholder + what is shown vs expected.

## 1. Primary tool — `tft:inspect-character`

Single command that fetches the BIN, parses everything, resolves, and dumps
a complete report. **Always run this first.**

```bash
# Pretty output with stat + ability tables
php artisan tft:inspect-character TFT17_Caitlyn --star=2

# Full JSON for copy-paste into Python / jq
php artisan tft:inspect-character TFT17_Caitlyn --star=2 --json > /tmp/debug.json

# Different star level
php artisan tft:inspect-character TFT17_Jinx --star=3

# Historical set (unlikely, but supported)
php artisan tft:inspect-character TFT15_LeeSin --channel=latest
```

The report structures everything you care about under one champion:
- `main.spells[]` — every SpellObject with `data_values`, `calculations`,
  `loc_keys`, and a `resolved_ability` rendering at the requested star
- `main.resolved_stats` — the 9+ hashed stat fields with semantic names
- `trait_clone.*` — parallel tree if the champion has a `_TraitClone` sibling
- `has_variant_choice` — quick flag for the generic MF-style mechanic

**JSON output is the truth.** Tables in the formatted mode are summaries.
When diagnosing a subtle bug, pipe to a file and grep.

## 2. When the command isn't enough — raw BIN dump

If the inspector's parsed view doesn't expose the bit you need (new
calculation node type, hashed field you want to FNV-verify, template
mismatch with stringtable), pull the raw file and grep it:

```bash
# Cached into storage/tft-bin-cache/ — gitignored, free to dump anything there
cd storage/tft-bin-cache
curl -sS -o jinx_raw.json \
  https://raw.communitydragon.org/pbe/game/characters/tft17_jinx.cdtb.bin.json

# Pretty-print so grep has something to chew on
python -m json.tool jinx_raw.json > jinx.pretty.json
wc -l jinx.pretty.json

# Inspect the TFTCharacterRecord directly
PYTHONIOENCODING=utf-8 python << 'PYEOF'
import json
d = json.load(open('jinx.pretty.json', encoding='utf-8'))
for k, v in d.items():
    if isinstance(v, dict) and v.get('__type') == 'TFTCharacterRecord':
        print(json.dumps(v, indent=2)[:4000])
PYEOF
```

### Finding a specific SpellObject

```python
# Inside a PYTHONIOENCODING=utf-8 python heredoc
import json
d = json.load(open('jinx.pretty.json', encoding='utf-8'))
for k, v in d.items():
    if isinstance(v, dict) and v.get('__type') == 'SpellObject':
        if v.get('mScriptName') == 'TFT17_JinxSpell':
            spell = v['mSpell']
            print('DataValues:', json.dumps(spell.get('DataValues', []), indent=2))
            print('Calcs:', json.dumps(spell.get('mSpellCalculations', {}), indent=2))
            print('LocKeys:', spell.get('mClientData', {}).get('mTooltipData', {}).get('mLocKeys'))
```

### Common grep targets

```bash
# Find which calc uses what sub-parts
grep -A 5 '"ModifiedHeal"' jinx.pretty.json

# Find a hashed field
grep '"{8662cf12}"' mf_character.pretty.json

# Find all SpellObjects
grep -c '"__type": "SpellObject"' jinx.pretty.json
```

## 3. FNV-1a reverse lookup for unknown hashes

When a hashed key `{hhhhhhhh}` appears in a record and you want to know what
plaintext name it corresponds to:

```bash
# From the repo root — uses App\Services\Tft\FnvHasher
cat > /tmp/hashguess.php << 'PHP'
<?php
require_once 'app/Services/Tft/FnvHasher.php';
use App\Services\Tft\FnvHasher;

$candidates = ['baseHP', 'BaseHP', 'mBaseHP', 'attackSpeed', 'ModifiedNumRockets'];
$targets = ['8662cf12', '4af40dc3', 'c30d568b'];

foreach ($candidates as $c) {
    $h = FnvHasher::hash($c);
    $match = in_array($h, $targets) ? ' <<< MATCH' : '';
    echo sprintf("%-30s %s%s\n", $c, $h, $match);
}
PHP
php /tmp/hashguess.php
```

For RST hashes (stringtable, 10-hex chars, 38-bit mask):

```bash
php -r "
require 'app/Services/Tft/RstHasher.php';
\$k = 'Spell_TFT17_MissFortuneSpell_ManaTraitStance_Desc';
echo App\Services\Tft\RstHasher::key(\$k) . PHP_EOL;
"
# → {0644ef3f06}
```

## 4. Stringtable lookups

```bash
# Fetch once per session, cache under storage/tft-bin-cache/
curl -sS -o tft_stringtable_en.json \
  https://raw.communitydragon.org/pbe/game/en_us/data/menu/en_us/tft.stringtable.json

# Grep plaintext values (useful for TFT17 which has few plaintext keys)
PYTHONIOENCODING=utf-8 python -c "
import json
d = json.load(open('tft_stringtable_en.json', encoding='utf-8'))
for k, v in d['entries'].items():
    if isinstance(v, str) and 'Conduit Mode' in v:
        print(k, '→', v[:120])
"
```

**Hashed keys in TFT17 stringtable:** community hashlist doesn't cover TFT17
spell descriptions yet, so plaintext keys like
`Spell_TFT17_MissFortuneSpell_ManaTraitStance_Desc` resolve via `RstHasher`
to `{0644ef3f06}`. Forward-hash is the way — reverse search by value rarely
finds what you want.

## 5. DB inspection

```bash
# Quick look at a champion's stored ability data
cd /path/to/tft-scout
echo "
\$c = App\Models\Champion::where('api_name', 'TFT17_Caitlyn')->first();
echo substr(\$c->ability_desc, 0, 300) . PHP_EOL;
foreach (\$c->ability_stats as \$s) {
    \$k = \$s['kind'] ?? 'data';
    echo sprintf('  [%-10s] %-25s = %s', \$k, \$s['name'], json_encode(\$s['value'])) . PHP_EOL;
}
" | php artisan tinker 2>&1 | tail -40
```

## 6. Known bug patterns (this session)

| Pattern | Fix location | Detection |
|---|---|---|
| AP sub-part underscales ×100 | `SpellCalculationEvaluator::evaluatePart` | Compare evaluated value to MetaTFT; if 1% of expected → missing 100× |
| Frontend `isPercentStat` over-matches | `Champions/Show.tsx:isPercentStat` | User sees `1500%%` — duplicate `%` on a flat-percent stat |
| Malformed `%i:scaleAP)` in Riot template | `Champions/Show.tsx:parseAbilityDescription` (regex pre-pass) | Literal `%i:scaleX` visible in rendered text |
| `detectStatOffset` missed a convention | `Champions/Show.tsx:detectStatOffset` (now constant=1) | Star levels shifted by 1 — 2★ matches 1★ MetaTFT |
| Placeholder stub `[Name]` in render | `CharacterAbilityEnrichHook` didn't fetch, or calc node unsupported | Run inspector — check `merged_stats` for the calc |
| Variant has base champion's description | `VariantChoiceHook::findStanceSpell` mismatch or config missing | Check `config/tft.php` `stance_spell` mapping |
| Calc returns `[0, 0, 0, ...]` | Unsupported formula node in `SpellCalculationEvaluator` | Dump raw mSpellCalculations, look for new `__type` values |

## 7. mSpellCalculations node types reference

The evaluator handles these today. When you see a new `__type` in a raw
dump, start by recognising where it fits in the table below, then extend
`SpellCalculationEvaluator::evaluatePart`.

| Type | Shape | Behaviour |
|---|---|---|
| `SumOfSubPartsCalculationPart` | `{mSubparts: []}` | Recursive sum |
| `SubPartScaledProportionalToStat` | `{mSubpart: {mDataValue}, mRatio, mStat?}` | `dataValue × mRatio`; ×100 if `mStat` absent (AP scaling) |
| `NamedDataValueCalculationPart` | `{mDataValue}` | Direct DataValue lookup (name or hash) |
| `NumberCalculationPart` | `{mNumber}` | Literal constant |
| `ProductOfSubPartsCalculationPart` | `{mPart1, mPart2}` | Binary multiplication |
| `ExponentSubPartsCalculationPart` | `{part1, part2}` (lowercase!) | `part1 ^ part2` |
| `ClampSubPartsCalculationPart` | `{mSubparts, mFloor, mCeiling}` | Clamp summed children |
| `StatByCoefficientCalculationPart` | `{mStat, mStatFormula, mCoefficient}` | `mCoefficient × championStats[mStat]` |
| `ByNamedSpellCalculationSubPart` (detected by `mSpellCalculationKey`) | — | Recursive lookup of another calc in the same `mSpellCalculations` map |
| Unknown `__type` | — | Return `null` — whole calc drops so frontend shows `[Stub]` |

### mStat enum (empirical)

| Enum | Stat | Source |
|---|---|---|
| `4` | attack_speed / attack_speed_ratio | Jinx NumRockets verified |

Everything else is unmapped. When a spell uses a new `mStat`, add it to:
- `CharacterAbilityEnrichHook::buildChampionStatsForEvaluator`
- `VariantChoiceHook::createVariant` (inline map)
- `InspectCharacterBin::buildChampionStatsFromResolved`

Three places. Worth refactoring into a shared helper if this happens again.

## 8. Typical debug session

A complete example walk-through (the one we did for Jinx NumRockets):

```bash
# 1. User reports "[NumRockets] (AS) rockets" stub
# 2. Inspect
php artisan tft:inspect-character TFT17_Jinx --star=2 --json > /tmp/jinx.json

# 3. Check merged_stats for the expected name
PYTHONIOENCODING=utf-8 python -c "
import json
d = json.load(open('/tmp/jinx.json'))
for sp in d['main']['spells']:
    if sp.get('script_name') == 'TFT17_JinxSpell':
        for s in sp['resolved_ability']['merged_stats']:
            print(s['name'], s.get('kind', 'data'))
"
# → No 'ModifiedNumRockets' entry → evaluator dropped the calc

# 4. Pull raw BIN to see what we're up against
cd storage/tft-bin-cache
curl -sS -o jinx_raw.json https://raw.communitydragon.org/pbe/game/characters/tft17_jinx.cdtb.bin.json
python -m json.tool jinx_raw.json > jinx.pretty.json

# 5. Find the relevant calc
grep -n -A 30 '"ModifiedNumRockets"\|"{c30d568b}"' jinx.pretty.json
# → sees ProductOfSubPartsCalculationPart with mPart1/mPart2 which evaluator didn't support

# 6. Implement missing types in SpellCalculationEvaluator::evaluatePart
# 7. Re-run step 2 until merged_stats includes the calc
# 8. php artisan tft:import  (re-enrich DB)
# 9. Verify in frontend
```

## 9. Files map

| What | Where |
|---|---|
| Inspector command | `app/Console/Commands/InspectCharacterBin.php` |
| Character bin fetch + parse | `app/Services/Tft/CharacterBinInspector.php` |
| mSpellCalculations evaluator | `app/Services/Tft/SpellCalculationEvaluator.php` |
| RST + stringtable + template render | `app/Services/Tft/AbilityDescriptionResolver.php`, `StringtableCache.php` |
| Stat hash registry | `app/Services/Tft/TftStatHashRegistry.php` |
| Value-match stat resolver | `app/Services/Tft/StatHashResolver.php` |
| FNV-1a 32 | `app/Services/Tft/FnvHasher.php` |
| XXH3-64 wrapper for RST | `app/Services/Tft/RstHasher.php` |
| Enrichment hook (all base champs) | `app/Services/Import/SetHooks/Shared/CharacterAbilityEnrichHook.php` |
| Variant creation hook | `app/Services/Import/SetHooks/Shared/VariantChoiceHook.php` |
| Main importer | `app/Services/Import/CDragonImporter.php` |
| Variant UX config | `config/tft.php` (`variant_overrides.*.stance_spell`) |
| Frontend renderer | `resources/js/pages/Champions/Show.tsx` (search for `parseAbilityDescription`, `formatStatValue`, `isPercentStat`) |
| Local research cache (gitignored) | `storage/tft-bin-cache/` — raw BIN dumps, stringtable, hash lists, pretty JSON |

## 10. Deeper research trail

Other research docs this setup grew from — read when touching a new aspect:

- `docs/research/tft-data-sources.md` — where CDragon lives, what endpoints exist
- `docs/research/cdtb-vs-http.md` — why we don't mirror CDTB locally
- `docs/research/tft-character-bins-mechanics.md` — variant detection logic, TraitClone discovery
- `docs/research/tft-hash-discovery.md` — FNV-1a / XXH3 algorithms, hashlists, stat hash registry, ability flow

If a layer isn't covered above, it almost certainly lives in one of those four.
