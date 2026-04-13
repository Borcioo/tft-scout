# TFT hash discovery — pełny obraz

**Status:** zweryfikowane empirycznie + cross-reference z CDTB master source (2026-04-13)
**Zakres:** BIN field hashes, RST stringtable hashes, strategie discovery, kompletny mapping dla TFT17

---

## TL;DR

1. **BIN field hashes** = FNV-1a 32 lowercase. Mamy własną implementację (`app/Services/Tft/FnvHasher.php`).
2. **RST stringtable hashes** = **XXH3-64 lowercase masked to 38 bits** dla `game_version ≥ 15.02` (TFT17 jest w tym zakresie). Dla starszych wersji: 39 bitów albo XXH64.
3. **Community NIE ROZWIĄZAŁA nazw pól** dla universal LoL CharacterRecord stat fields. CDTB hardcoduje magic numbers (`record.getv(0x8662cf12).getv("BaseValue")`) znalezione przez value matching. Nasz `StatHashResolver` robi dokładnie to samo.
4. **Opisy ability** można rozwiązać przez **plaintext RST keys** w `SpellObject.mSpell.mClientData.mTooltipData.mLocKeys.{keyName,keyTooltip}` → lookup w `tft.stringtable.json` po obliczonym hash.
5. **Dla wariantów (MF) każdy stance spell ma własne loc keys** — dostajemy osobne opisy per wariant bez dodatkowego wysiłku.

---

## 1. BIN field hash algorithm (FNV-1a 32)

Z `cdtb/binfile.py:22-30`:

```python
def compute_binhash(s):
    """Compute a hash used in BIN files — FNV-1a hash on lowercased input"""
    h = 0x811c9dc5
    for b in s.encode('ascii').lower():
        h = ((h ^ b) * 0x01000193) % 0x100000000
    return h
```

**Nasze PHP implementation** (już zrobione): `app/Services/Tft/FnvHasher.php`

Wiemy że algorytm jest poprawny bo zweryfikowaliśmy na 8 kontrolnych `baseHP`, `baseArmor`, `attackRange`, etc. z publicznego hashlisty `hashes.binfields.txt`.

**Namespacy hashów BIN** — każdy używa tego samego FNV-1a ale w osobnym hashliście:
- `hashes.binentries.txt` — top-level binpaths (28 MB)
- `hashes.binfields.txt` — field names na klasach (243 KB, ~9k wpisów)
- `hashes.binhashes.txt` — wartości hash-typed fields (4.8 MB)
- `hashes.bintypes.txt` — nazwy typów/klas (117 KB)
- `hashes.game.txt` — XXH64 ścieżki plików w WAD archives

**Zasady które musimy znać:**
- **Top-level keys w `.cdtb.bin.json`** = FNV-1a 32 na binpath np. `Characters/TFT17_MissFortune/CharacterRecords/Root` → `{afc82e49}`
- **Field names w obiektach** = FNV-1a 32 na pojedynczej nazwie pola np. `mCharacterName` → `{c9f96e46}` (to już jest w hashliście, pojawia się jako plaintext)
- **TraitData binpath pattern** (nasz) = `Maps/Shipping/Map22/Sets/TFTSet{N}/Traits/{api_name}` — brute-force matching, nie w publicznej hashliście

---

## 2. RST stringtable hash algorithm (XXH3-64 truncated)

Z `cdtb/rstfile.py:13-19`:

```python
def key_to_hash(key, bits=64, rsthash_version=1415):
    if isinstance(key, str):
        if rsthash_version >= 1415:
            key = xxh3_64_intdigest(key.lower())
        else:
            key = xxh64_intdigest(key.lower())
    return key & ((1 << bits) - 1)
```

**Mask size per game version** (z `rstfile.py:60-88`):
```python
elif version in (4, 5):
    self.hash_bits = 39
    if self.game_version >= 1502:  # patch 15.02+
        self.hash_bits = 38
```

**Zweryfikowane dla TFT17 PBE empirycznie:** `bits = 38` daje 8/8 hitów dla MF loc keys. `bits = 39` daje 1/8, `bits = 40` daje 0/8.

**PHP implementation (do zrobienia):**
- PHP 8.1+ ma `hash('xxh3', $str)` ale zwraca **128-bit**, nie 64
- Opcja 1: paczka composer `cooosilee/xxh3-php` lub podobna
- Opcja 2: PECL `ext-xxhash` ze wsparciem `xxh3_64`
- Opcja 3: Pure PHP implementation (XXH3 jest skomplikowany — dużo kodu)
- **Zalecane:** Composer paczka + fallback na subprocess do Python `xxhash` jeśli paczka się nie buduje na Windows/Herd

```php
function rstHash(string $key, int $bits = 38): int {
    $h = Xxh3::hash64(strtolower($key));
    return $h & ((1 << $bits) - 1);
}
```

---

## 3. TFTCharacterRecord stat fields — hardcoded mapping

Z `cdtb/tftdata.py:318-329` (master branch):

```python
"stats": {
    "hp":          hp_struct.getv("BaseValue")          if (hp_struct := record.getv(0x8662cf12)) is not None else record.getv("baseHP"),
    "damage":      damage_struct.getv("BaseValue")      if (damage_struct := record.getv(0x4af40dc3)) is not None else record.getv("BaseDamage"),
    "armor":       armor_struct.getv("BaseValue")       if (armor_struct := record.getv(0xea6100d5)) is not None else record.getv("baseArmor"),
    "magicResist": mr_struct.getv("BaseValue")          if (mr_struct := record.getv(0x33c0bf27)) is not None else record.getv("baseSpellBlock"),
    "attackSpeed": attackspeed_struct.getv("BaseValue") if (attackspeed_struct := record.getv(0x836cc82a)) is not None else record.getv("attackSpeed"),
    "range": (range_struct.getv("BaseValue", 0) if (range_struct := record.getv(0x7bd4b298)) is not None else record.getv("attackRange", 0)) // 180,
    "critMultiplier": record.getv("critDamageMultiplier"),
    "critChance": record.getv("baseCritChance"),
}
```

**Struktura stat wrapper:**
- Każde stat field na `TFTCharacterRecord` jest typu `{ce9b917b}` (unresolved class name, nieznane plaintext)
- Ten wrapper ma pole `BaseValue` → `{b35aa769}` (confirmed przez FNV-1a)
- Wartość jest pod `record[{hash}].{b35aa769}` jako float

**Pełny registry (zweryfikowany empirycznie na Ahri + MF):**

| Hash | Semantic name | Ahri value | MF value |
|---|---|---|---|
| `0x8662cf12` | **baseHP** | 590 | 650 |
| `0x4d37af28` | hpPerLevel | 104 | — |
| `0x9eedebad` | hpRegen | 0.5 | 0 |
| `0x913157bb` | hpRegenPerLevel | 0.12 | — |
| `0x4af40dc3` | **baseAD** | 53 | 50 |
| `0xe2b5d80d` | adPerLevel | 3 | — |
| `0xea6100d5` | **baseArmor** | 21 | 30 |
| `0x18956a21` | armorPerLevel | 4.2 | — |
| `0x33c0bf27` | **baseMr** (= magicResist) | 30 | 30 |
| `0x01262a25` | mrPerLevel | 1.3 | — |
| `0xe62d9d92` | **baseMoveSpeed** | 330 | 500 |
| `0x7bd4b298` | **attackRange** (÷180 = hexes) | 550 | 1080 (6 hex) |
| `0x836cc82a` | **attackSpeedRatio** | 0.668 | 0.75 |
| `0x4f89c991` | **baseAttackSpeed** | 0.625 | 0.7 |
| `0xb9f2b365` | attackSpeedPerLevel | 2.2 | — |

**Pogrubione** = używane przez CDTB do generowania `en_us.json` dla TFT. Te 6 + crit fields są wszystkim co potrzeba dla naszego importera.

**Inne resolved hashes** (fallback w razie re-orderingu / patcha):
- `{b35aa769}` = **`baseValue`** (inner wrapper field, plaintext name zweryfikowany FNV-1a)
- `{ce9b917b}` = wrapper type name (nieznany plaintext, ale znamy jego strukturę)
- `{053a1f33}` = `TraitData`

**Uwaga o range:** BIN zwraca range w "units" — trzeba podzielić przez 180 żeby dostać hex count (CDTB `// 180`). Dla MF: 1080 ÷ 180 = 6 hex ✅

---

## 4. SpellObject / ability data extraction

Z `cdtb/tftdata.py` master:

```python
# Find the main spell by matching spellNames[0] to mScriptName
spell_name = record.getv("spellNames")[0].rsplit("/", 1)[-1].lower()
for entry in tft_bin.entries:
    if entry.type == "SpellObject" and entry.getv("mScriptName", "").lower() == spell_name:
        ability = entry.getv("mSpell")
        
        # Variables (numbers per star level)
        ability_variables = [
            {"name": v.getv("name", v.getv("mName")), 
             "value": v.getv("values", v.getv("mValues"))}
            for v in ability.getv("DataValues", ability.getv("mDataValues", []))
        ]
        
        # Localization keys (PLAINTEXT strings pointing to stringtable)
        if loc_keys := ability.get_path("mClientData", "mTooltipData", "mLocKeys"):
            spell_key_name = loc_keys.get("keyName")       # → RST key
            spell_key_tooltip = loc_keys.get("keyTooltip") # → RST key
        break
```

**Kluczowe obserwacje:**

1. **DataValues** (nazwy pól: `name`/`mName`, `values`/`mValues` — nazewnictwo zmieniło się w TFT17) są **plaintext** w BIN i zawierają:
   - `name`: nazwa zmiennej (np. `Tier1Damage`, `ModifiedDamagePerSecond`, `DamageFalloff`)
   - `values`: array 7 liczb — jeden per star level (indeks 0 = baza, 1-3 = stars, 4-6 = wyższe tiery/upgrades)

2. **mClientData.mTooltipData.mLocKeys** ma **plaintext RST keys** typu `Spell_TFT17_MissFortuneSpell_ManaTraitStance_Name`. Te klucze są zapisane jako literalne stringi w BIN (bo game engine musi je znać w runtime do lookup).

3. **Każdy SpellObject (w tym stance variants)** ma własne `mLocKeys` → **per-variant descriptions są darmowe**. Zweryfikowane na MF: 4 spelle (main + 3 stance) mają 8 różnych kluczy, wszystkie resolve do stringtable.

---

## 5. RST lookup flow

**Algorytm rozwiązania opisu ability:**

```python
# 1. Get plaintext RST key from BIN SpellObject
key = spell_object['mSpell']['mClientData']['mTooltipData']['mLocKeys']['keyTooltip']
# np. "Spell_TFT17_MissFortuneSpell_ManaTraitStance_Desc"

# 2. Compute RST hash
hash = xxh3_64(key.lower()) & ((1 << 38) - 1)
# np. 0x0644ef3f06

# 3. Lookup in stringtable
description = tft_stringtable[f'{{{hash:010x}}}']
# "Channel a volley of bullets at the nearest two enemies for @Duration@ seconds..."

# 4. Render template with DataValues
for var_name, var_values in ability_variables:
    description = description.replace(f'@{var_name}@', f'{var_values[star_level]}')
```

**Template syntax w opisach:**
- `@VarName@` — prosta substytucja
- `@VarName*100@` — mnożenie (np. `@DamageFalloff*100@%` dla procentów)
- `<physicalDamage>...</physicalDamage>` — kolorowanie (AD dmg, AP dmg, TrueDmg)
- `%i:scaleAD%`, `%i:scaleAP%` — inline icons dla scaling indicator
- `&nbsp;` — non-breaking space

---

## 6. Complete ability extraction example — Miss Fortune Set 17

**Dla każdego z 4 spellów MF** pobieramy (z `mf_character.cdtb.bin.json`):

### Main spell (Gun Goddess Arsenal)
```
mScriptName:         TFT17_MissFortuneSpell
DataValues:          Tier1Damage/Tier2Damage/Tier3Damage/Tier4Damage/Tier5Damage  (arrays of 7)
cooldownTime:        [1,1,1,1,1,1,1]
castRange:           [2500,2500,2500,2500,2500,2500,2500]
mCastTime:           0.25
loc keyName:         Spell_TFT17_MissFortuneSpell_Name       → "Gun Goddess Arsenal"
loc keyTooltip:      Spell_TFT17_MissFortuneSpell_Tooltip    → "Field Miss Fortune to choose..."
```

### Conduit Mode (TFT17_MissFortuneSpell_ManaTraitStance)
```
loc keyName:         Spell_TFT17_MissFortuneSpell_ManaTraitStance_Name  → "Conduit Mode"
loc keyTooltip:      Spell_TFT17_MissFortuneSpell_ManaTraitStance_Desc  → "Channel a volley of bullets..."
```

### Challenger Mode (TFT17_MissFortuneSpell_ASTraitStance)
```
loc keyName:         Spell_TFT17_MissFortuneSpell_ASTraitStance_Name    → "Challenger Mode"
loc keyTooltip:      Spell_TFT17_MissFortuneSpell_ASTraitStance_Desc    → "Fire a shot at the target..."
```

### Replicator Mode (TFT17_MissFortuneSpell_FlexTraitStance)
```
loc keyName:         Spell_TFT17_MissFortuneSpell_FlexTraitStance_Name  → "Replicator Mode"
loc keyTooltip:      Spell_TFT17_MissFortuneSpell_FlexTraitStance_Desc  → "Rain down bullets through a line..."
```

**Potwierdzone wszystkie 8 kluczy rozwiązują się przez xxh3 38-bit.**

---

## 7. Hash discovery strategies (future-proofing)

Community używa tych strategii do rozwiązywania nowych hashów. Możemy je zaimplementować dla ciągłego pokrycia przyszłych setów bez czekania.

### 7.1 String extraction z client binary

**Najsilniejsza metoda** dla BIN field names:
```bash
# lub equivalent w Python/PHP
strings "League of Legends.exe" | grep -E '^[A-Za-z_][A-Za-z0-9_]{3,63}$' > candidates.txt
```
Następnie FNV-1a 32 każdy kandydat i match z unknown hashes.

**Próbowaliśmy to już** (wczytanie 33 MB exe, 57k identifiers) — **0/9 matchów dla naszych stat fields**. Znaczy że te pola:
- Albo są w innej DLL (do sprawdzenia: WAD client binaries, server-only DLLs)
- Albo w Lua bytecode (ale DATA/FINAL w PBE to głównie .bin w WAD, mało Lua)
- Albo są generowane dynamicznie z templata (`baseHP{variant}`)
- Albo po prostu ich jeszcze nikt nie rozwiązał i są compilowane away w release builds

**Do dalszej eksploracji** — można przepuścić `strings` na `lol_game_client.dll` po rozpakowaniu WAD, jeśli taki plik istnieje w Map22.wad.client.

### 7.2 Cross-reference z en_us.json (dla RST)

Wszystkie klucze z `cdragon/tft/en_us.json` są kandydatami do RST:
```php
$enUs = json_decode(file_get_contents('cdragon/tft/en_us.json'), true);
$candidates = [];
array_walk_recursive($enUs, function($v, $k) use (&$candidates) {
    if (is_string($k)) $candidates[] = $k;
    if (is_string($v)) $candidates[] = $v;
});
// + pattern generation:
// generatedtip_{...}, tft{n}_item_name_{...}, Spell_TFT{n}_...
```

Dla TFT15 (stary set) daje ~90% pokrycie stringtable. Dla TFT17 mniejsze bo wiele kluczy jest dynamicznie generowanych (`Spell_TFT17_MissFortuneSpell_ManaTraitStance_Desc` — generated od character name + spell variant).

### 7.3 Pattern-based brute force

Znane wzorce Riot:
- `base{Stat}`, `m{Stat}`, `Initial{Stat}`, `{Stat}PerLevel`
- `Characters/{apiName}/Spells/{spellName}`
- `Spell_{apiName}_{suffix}`, `generatedtip_spelltft_{apiName}_{tooltiptype}`
- `Maps/Shipping/Map22/Sets/TFTSet{N}/Traits/{api_name}` ← to już mamy

Iteracja przez kombinacje + FNV-1a/XXH3 + match. Dla TFT17 trait binpath pattern zadziałało — dla stat field names NIE działa (pewnie używają mniej przewidywalnych nazw).

### 7.4 Ręczny research z CDTB commits

Monitorowanie commits w `CommunityDragon/Data` repo pokazuje gdzie maintainerzy (głównie Morilli, Canisback) dodają nowe hashe. Źródło wiedzy o konwencjach nazewnictwa Riota.

---

## 8. Complete import pipeline dla TFT character

```
1. FETCH champion bin:
   GET raw.communitydragon.org/{channel}/game/characters/{lower_api_name}.cdtb.bin.json

2. PARSE TFTCharacterRecord:
   - mCharacterName, tier, flags, unitTagsString → direct
   - stats: iterate hashed fields, apply TftStatHashes::MAP
   - mLinkedTraits: resolve via TraitHashResolver (our existing)
   - spellNames[0] → primary spell reference

3. PARSE SpellObjects in same file:
   - Filter __type == 'SpellObject'
   - For primary: find by mScriptName matching spellNames[0]
   - Extract mSpell.DataValues (name, values[7])
   - Extract mSpell.cooldownTime, castRange, mCastTime, etc.
   - Extract mSpell.mClientData.mTooltipData.mLocKeys.{keyName, keyTooltip}

4. DETECT variants (our existing):
   - HEAD raw.communitydragon.org/.../{name}_traitclone.cdtb.bin.json
   - If exists → variant champion; main + variant records

5. FETCH stringtable (once per import):
   GET raw.communitydragon.org/{channel}/game/en_us/data/menu/en_us/tft.stringtable.json
   Parse JSON, cache in-process

6. RESOLVE descriptions:
   For each SpellObject.mLocKeys:
     hash = xxh3_64(key.lower()) & ((1 << 38) - 1)
     description = stringtable.entries[f'{{{hash:010x}}}']
   
7. RENDER per star level:
   For star_level in 0..6:
     for each @var@ in description:
       replace with DataValues[var_name].values[star_level]
```

**Output dla MF** (przykład):
```json
{
  "api_name": "TFT17_MissFortune",
  "stats": {"hp": 650, "mana": 100, "armor": 30, ...},
  "ability": {
    "name": "Gun Goddess Arsenal",
    "description_template": "Field Miss Fortune to choose whether...",
    "variants": [
      {
        "spell_name": "TFT17_MissFortuneSpell_ManaTraitStance",
        "variant_label": "conduit",
        "name": "Conduit Mode",
        "description_template": "Channel a volley of bullets...",
        "data_values": {
          "ModifiedDamagePerSecond": [0, 2.0, 2.5, 3.3, ...],
          "Duration": [0, 2.0, 2.0, 2.0, ...]
        }
      },
      // ... Challenger, Replicator
    ]
  }
}
```

---

## 9. PHP implementation plan

### Services structure
```
app/Services/Tft/
├── FnvHasher.php                    # ✅ DONE — lowercase FNV-1a 32
├── Xxh3Hasher.php                   # TODO — xxh3_64 via composer package
├── RstHashResolver.php              # TODO — wraps Xxh3Hasher with mask logic
├── CharacterBinInspector.php        # ✅ DONE — will be extended
├── StatHashResolver.php             # ✅ DONE — value-matching (Rosetta Stone)
├── TftStatHashRegistry.php          # TODO — hardcoded hash → stat_name (from CDTB)
├── SpellObjectParser.php            # TODO — extract DataValues, mLocKeys from spells
├── AbilityDescriptionResolver.php   # TODO — RST lookup + template render
└── StringtableCache.php             # TODO — lazy load + memory cache of 21MB file
```

### Registry (`TftStatHashRegistry.php`)

```php
final class TftStatHashRegistry
{
    public const MAP = [
        0x8662cf12 => 'hp',
        0x4d37af28 => 'hp_per_level',
        0x9eedebad => 'hp_regen',
        0x913157bb => 'hp_regen_per_level',
        0x4af40dc3 => 'attack_damage',
        0xe2b5d80d => 'ad_per_level',
        0xea6100d5 => 'armor',
        0x18956a21 => 'armor_per_level',
        0x33c0bf27 => 'magic_resist',
        0x01262a25 => 'mr_per_level',
        0xe62d9d92 => 'move_speed',
        0x7bd4b298 => 'range_units', // ÷ 180 = hexes
        0x836cc82a => 'attack_speed_ratio',
        0x4f89c991 => 'base_attack_speed',
        0xb9f2b365 => 'attack_speed_per_level',
    ];

    public static function lookup(int $hash): ?string
    {
        return self::MAP[$hash] ?? null;
    }
}
```

### XXH3 strategy

1. **Composer package:** `composer require cooosilee/xxh3-php` (preferowane) lub `nicoswd/php-xxh3`
2. **Fallback:** PHP `hash('xxh3', $str, true)` zwraca binary, ale to jest **xxh3_128**. Możemy wziąć low 8 bytes, bo xxh3_64 to **niestety** inna funkcja (różne mixing) — NIE działa
3. **Ostateczność:** subprocess do Python `python -c "import xxhash; print(xxhash.xxh3_64_intdigest('$str'))"` — wolne, ale niezawodne dla proof-of-concept

---

## 10. Status checklist

### Już działa
- [x] FnvHasher (PHP)
- [x] TraitHashResolver (brute force binpath pattern)
- [x] CharacterBinInspector z variant detection
- [x] StatHashResolver (value matching, 6/9 dla MF)
- [x] Generic VariantChoiceHook
- [x] FnvHasher PHP implementation

### Do zrobienia
- [ ] TftStatHashRegistry — hardcoded 15 stat hashes (quick win: 9/9 resolution dla dowolnego TFT17 championa)
- [ ] Xxh3Hasher PHP (composer dependency research + fallback)
- [ ] RstHashResolver z mask logic (38/39/40 bits per game version)
- [ ] SpellObjectParser extension do CharacterBinInspector
- [ ] StringtableCache service (lazy fetch 21 MB, cache w `storage/app/tft-cache/`)
- [ ] AbilityDescriptionResolver (RST lookup + template render)
- [ ] Rozszerzenie importera o ability import per champion + per variant
- [ ] Update DB schema jeśli potrzebne (champion_abilities table albo JSONB columns)

### Long-term (future-proofing)
- [ ] BinaryStringExtractor service (strings na client binaries)
- [ ] HashDiscoveryPipeline command (`tft:discover-hashes`)
- [ ] Auto-cache discovered hashes w `storage/app/tft-cache/custom_hashes.txt`

---

## Sources

- [CDTB binfile.py — compute_binhash](https://github.com/CommunityDragon/CDTB/blob/master/cdtb/binfile.py#L22-L30)
- [CDTB rstfile.py — key_to_hash](https://github.com/CommunityDragon/CDTB/blob/master/cdtb/rstfile.py#L13-L19)
- [CDTB tftdata.py — stats with hardcoded magic numbers](https://github.com/CommunityDragon/CDTB/blob/master/cdtb/tftdata.py#L318-L329)
- [CDTB hashes.py — HashGuesser (path discovery only, not fields)](https://github.com/CommunityDragon/CDTB/blob/master/cdtb/hashes.py)
- [CommunityDragon Data — hashlists](https://raw.communitydragon.org/data/hashes/lol/)
- Ahri empirical mapping: `https://raw.communitydragon.org/latest/game/data/characters/ahri/ahri.bin.json`
- MF empirical mapping: `https://raw.communitydragon.org/pbe/game/characters/tft17_missfortune.cdtb.bin.json`
- Local cache of verification data: `storage/tft-bin-cache/`
