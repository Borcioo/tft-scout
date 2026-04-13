# TFT mechaniki variant — lokalizacja w plikach klienta

**Status:** zweryfikowane empirycznie (2026-04-13)
**Testcase:** Miss Fortune Set 17 (3 selectable trait variants)

---

## TL;DR

Variant mechanics (jak wybór traitu MF) żyją w **osobnych `_TraitClone` character records**, nie w głównym championie. Pliki dostępne przez HTTP pod:

```
https://raw.communitydragon.org/pbe/game/characters/{lowercase_api_name}.cdtb.bin.json
```

**Generyczny detektor** (działa dla MF i każdej przyszłej postaci z podobną mechaniką):

```
Dla każdego championa X w Set:
  jeśli istnieje plik {X}_TraitClone.cdtb.bin.json:
    to X ma mechanikę "choose variant"
    warianty = parsed mLinkedTraits[].TraitData z TraitClone recordu
```

Nie hardcode'ujemy nazw championów.

---

## Ścieżka do pliku

| Path | Co tam jest |
|---|---|
| `raw.communitydragon.org/pbe/game/characters/{name}.cdtb.bin.json` | **PRIMARY** — consolidated character data (25 KB). Ma `TFTCharacterRecord` z `mCharacterName`, `spellNames`, `mLinkedTraits`, stats |
| `raw.communitydragon.org/pbe/game/data/characters/{name}/skins/skin0.bin.json` | VFX only (~500 KB). IGNORE dla importera — tylko partykuły, materiały, tekstury. `Characters/{name}` pojawia się tylko w `__linked` na końcu |
| `raw.communitydragon.org/pbe/game/data/characters/{name}/skins/root.bin.json` | Mini meta (~500 B) — audio tags, animation graph link. IGNORE |
| `raw.communitydragon.org/pbe/game/data/characters/{name}/animations/skin0.bin.json` | Animation graph. IGNORE dla data importera |
| `raw.communitydragon.org/pbe/game/data/maps/shipping/map22/map22.bin.json` | Set index (53 MB) — tu są Hero Augments i globalny kontekst setu. Opcjonalne, do sprawdzenia czy zawiera dodatkowe metadane wariantów |

**Ważne:** ścieżka `game/characters/` (bez `data/`) była pomijana przez poprzednie researche. Pierwszy research próbował `game/data/characters/.../{name}.bin.json` (oficjalny docs pattern dla LoL) i nie znalazł. Drugi research cytował docs bez weryfikacji. **TFT17 championi mają swoje skonsolidowane BIN-y TYLKO w `game/characters/*.cdtb.bin.json`**, sufiks `.cdtb.bin.json` = "CDTB-generated consolidated binary".

---

## Struktura `TFTCharacterRecord`

Z `mf_character.pretty.json`:

```json
{
    "{46f9fa61}": {
        "mCharacterName": "TFT17_MissFortune",

        // Stats — klucze hashowane ({8662cf12} itd.), typowe są:
        // baseHP ~650, baseMana ~60, baseArmor ~70, baseMR ~70,
        // baseDamage ~70, baseCritChance 0.25, critDamageMultiplier 1.4,
        // attackRange ~500, baseAS ~0.9

        "{8662cf12}": { "{b35aa769}": 650.0 },   // likely baseHP
        "baseCritChance": 0.25,
        "critDamageMultiplier": 1.4,

        // Keystone fields (jawne, nie hashowane):
        "spellNames": [
            "TFT17_MissFortuneSpell",
            "",
            "",
            ""
        ],
        "mLinkedTraits": [
            { "TraitData": "{50b1701f}", "__type": "TFTTraitContributionData" },
            { "TraitData": "{97b1fb0a}", "__type": "TFTTraitContributionData" }
        ],
        "mShopData": "{a510e5f3}",           // link do shop entry (z costem, ikoną)
        "CharacterRole": "{53d104ac}",       // hash roli
        "mManaPerAttack": 5.0,
        "unitTagsString": "Champion",
        "flags": ...,
        "tier": ...,
        "__type": "TFTCharacterRecord"
    }
}
```

**Pola które musimy czytać:**
- `mCharacterName` (jawne) — `api_name` jak w obecnym DB
- `spellNames` (jawne, array of 4) — pierwszy niepusty = primary spell, reszta rezerwowana
- `mLinkedTraits` (jawne, array of `{TraitData: hash}`) — traity bazowe championa
- `mShopData` (hash) — link do shop entry (cost, tier, ikona) w innym pliku
- `mManaPerAttack` (jawne)
- `unitTagsString`, `flags`, `tier` — metadane

**Pola ze stats** mają hashowane klucze bo Riot nie eksportuje tej partii hashlisty publicznie. Trzeba je rozwiązać przez:
1. Cross-reference z [`CommunityDragon/Data`](https://github.com/CommunityDragon/Data) repo (tam są hashlisty community-maintained)
2. Lub: matching ze znanymi polami z `cdragon/tft/en_us.json` (ten ma rozwiązane `hp`, `mana`, `damage` itd.) — bierzemy wartości z jednego, mapujemy po value match do hashów w drugim

---

## Mechanika Miss Fortune: dual-record pattern

Miss Fortune Set 17 używa **dwóch character records**:

### `TFT17_MissFortune` (main, 25 KB)
```json
{
    "mCharacterName": "TFT17_MissFortune",
    "spellNames": ["TFT17_MissFortuneSpell", "", "", ""],
    "mLinkedTraits": [
        { "TraitData": "{50b1701f}" },       // trait #1 (bazowy)
        { "TraitData": "{97b1fb0a}" }        // trait #2 (bazowy — prawdopodobnie "Gun Goddess Unique")
    ],
    "mShopData": "{a510e5f3}",               // normal shop slot
    "MobileHealthBarHeightOverride": 135.0
}
```

### `TFT17_MissFortune_TraitClone` (variant template, 1.5 KB)
```json
{
    "mCharacterName": "TFT17_MissFortune_TraitClone",
    // brak `spellNames`
    "mLinkedTraits": [
        { "TraitData": "{c09777da}" },       // wariant 1
        { "TraitData": "{1d6a1207}" },       // wariant 2
        { "TraitData": "{8c63e914}" }        // wariant 3
    ],
    "tier": 3,
    "expGivenOnDeath": 0.0,                  // ← brak exp = nie-sprzedawalna unit
    "goldGivenOnDeath": 0.0,                 // ← brak gold = spawnowana przez mechanikę
    "mShopData": "{184e7eed}",               // inny hash niż main = nie pojawia się w shopie
    "unitTagsString": "Champion",
    "flags": 9446664
}
```

**Skin/model TraitClone:** używa `ASSETS/Characters/TestCube/Skins/Base/Cube.skl` + `Cube.skn` — czyli **dummy "cube" model**. Widać że to placeholder entity reprezentujący konceptualnie "MF w fazie wyboru wariantu", nie osobną grywalną postać.

**Szybka weryfikacja w particles** (`skin0.bin.json`):
- `TFT17_MissFortune_Base_R_ChannelerTrait_Mis_Child02` — wariant Channeler
- `TFT17_MissFortune_Base_Q_ASTrait_Mis` — wariant AS
- `sfx_tft17_MissFortune_Replicator_launch` — wariant Replicator
- `sfx_tft17_MissFortune_Challenger_hit` — wariant Challenger (?)

Nazewnictwo particles wspomina różne słowa kluczowe — **nie mapują się 1:1 na 3 traity z TraitClone**. Prawdopodobnie jeden wariant ma multiple kodowe nazwy (np. "Flex" = "Challenger"). Trzeba rozwiązać 3 hashe żeby mieć pewność.

### **BŁĄD w obecnym `MissFortuneVariantsHook`:**

`app/Services/Import/SetHooks/Set17/MissFortuneVariantsHook.php` ma hardcoded:
```php
private const MODES = [
    ['variant' => 'conduit',    'trait' => 'TFT17_ManaTrait', 'role' => 'APCaster'],
    ['variant' => 'challenger', 'trait' => 'TFT17_ASTrait',   'role' => 'ADCarry'],
    ['variant' => 'replicator', 'trait' => 'TFT17_APTrait',   'role' => 'APCaster'],
];
```

Te nazwy wariantów (`conduit/challenger/replicator`) i nazwy traitów (`ManaTrait/ASTrait/APTrait`) są **zgadywane** — nie ma potwierdzenia że matchują rzeczywiste hashe z BIN-a. Trzeba je zweryfikować przez FNV1a resolver.

---

## Generyczny pattern detekcji (dla każdej przyszłej postaci)

```
1. Pobierz listing: raw.communitydragon.org/json/{channel}/game/characters/
2. Filtruj po prefixie `tft{N}_`
3. Dla każdego championa X w tym Set:
   a. Pobierz {X}.cdtb.bin.json → main record
   b. Sprawdź czy istnieje {X}_traitclone.cdtb.bin.json (HEAD request)
   c. Jeśli TAK → champion ma mechanikę wyboru wariantu
      warianty = mLinkedTraits[] z TraitClone
   d. Zapisz flag `has_variant_choice = true` + listę trait hashes
4. Osobno: rozwiąż FNV1a hash → trait api_name przez matching z en_us.json traits
```

Dzięki temu wykrywamy **dowolną postać z "choose trait" mechaniką** w kolejnych setach bez modyfikacji kodu. Riot jeśli doda nową taką postać w Set 18, automatycznie ją znajdziemy.

---

## FNV1a hash resolution — ROZWIĄZANE (2026-04-13)

**Binpath pattern dla TFT trait data** (zweryfikowany empirycznie):
```
Maps/Shipping/Map22/Sets/TFTSet{N}/Traits/{trait_api_name}
```

Hash to FNV-1a 32 lowercase **tego binpath-a**, nie samego api_name. Żaden publiczny hashlist (CommunityDragon/Data) go nie rozwiązywał — brute-force z prawidłowym prefixem zadziałał. Walidacja na 5 MF hashach = 5/5 hits.

**Tabela rozwiązań MF Set 17:**

| Hash | Trait api_name | Tryb (user-facing) |
|---|---|---|
| `{50b1701f}` | `TFT17_MissFortuneUniqueTrait` | Main — Gun Goddess Unique (ability-enabling) |
| `{97b1fb0a}` | `TFT17_MissFortuneUndeterminedTrait` | Main — "Undetermined" placeholder (zamieniany po wyborze wariantu) |
| `{c09777da}` | `TFT17_ManaTrait` | TraitClone → **Conduit Mode** |
| `{1d6a1207}` | `TFT17_ASTrait` | TraitClone → **Challenger Mode** |
| `{8c63e914}` | `TFT17_APTrait` | TraitClone → **Replicator Mode** |

**Mechanika:**
1. MF wystawiona → ma `UniqueTrait` + `UndeterminedTrait` (placeholder)
2. Gracz wybiera jedno z 3 wariantów z TraitClone
3. `UndeterminedTrait` → zastąpiony wybranym wariantem
4. Finalnie MF ma `UniqueTrait` + `{wybrany wariant}` (`ManaTrait`/`ASTrait`/`APTrait`)

**Walidacja `MissFortuneVariantsHook`:** hook ma **poprawne dane** (`conduit/challenger/replicator` mapowane na `ManaTrait/ASTrait/APTrait`). Problem hooka to tylko że jest hardcoded pod MF — wartości są OK.

---

## FNV1a algorytm

```python
def fnv1a_32(s: str) -> str:
    h = 0x811c9dc5
    for c in s.lower().encode('utf-8'):
        h ^= c
        h = (h * 0x01000193) & 0xffffffff
    return f'{{{h:08x}}}'
```

W PHP:
```php
function fnv1a32(string $s): string {
    $hash = 0x811c9dc5;
    foreach (str_split(strtolower($s)) as $c) {
        $hash ^= ord($c);
        $hash = ($hash * 0x01000193) & 0xffffffff;
    }
    return sprintf('{%08x}', $hash);
}
```

**Jak to użyć (zweryfikowane):** iteruj po wszystkich znanych trait api_names z `cdragon/tft/en_us.json`, policz FNV1a dla `f"Maps/Shipping/Map22/Sets/TFTSet{setNumber}/Traits/{api_name}"`, zbuduj mapę `hash → api_name`. Lookup hashy z `TraitData` references w BIN-ach. Hashy których nie ma w mapie = nowy trait nieobecny jeszcze w `en_us.json` (loguj do inspection).

**Ważne o wersjach językowych:** hashe BIN-ów są **language-independent** — to są strukturalne referencje do obiektów game data, nie tłumaczenia. Ten sam `TraitData: "{c09777da}"` pojawi się identycznie w każdej wersji językowej. Pliki `game/characters/*.cdtb.bin.json` **nie mają wariantów per locale** (to nie stringi). Stringtable to osobna sprawa, ale z perspektywy importera struktur danych — locale nieistotny.

---

## Implikacje dla architektury importera

### Nowa warstwa: Character BIN importer

```
Layer 1 (obecny): cdragon/tft/en_us.json  → champions, traits, items, augments (80% danych)
Layer 2 (nowy):   game/characters/*.cdtb.bin.json  → stats surowe, spellNames, mLinkedTraits, variant clone detection
Layer 3 (opc):    map22.bin.json          → Hero Augments, Champion Choice metadata
```

### Co Layer 2 robi konkretnie

1. **Pre-cache:** listing wszystkich championów Set'a:
   ```
   GET raw.communitydragon.org/json/pbe/game/characters/
   filter name startswith "tft17_"
   ```

2. **Per-champion fetch:**
   ```
   GET raw.communitydragon.org/pbe/game/characters/{name}.cdtb.bin.json
   GET raw.communitydragon.org/pbe/game/characters/{name}_traitclone.cdtb.bin.json  (404 tolerable)
   ```

3. **Parser:** wyjmuje `TFTCharacterRecord` → mapuje jawne pola → rozwiązuje FNV hashe → wypełnia/uzupełnia istniejące Eloquent rekordy

4. **Variant detection:** jeśli traitclone.bin.json existed → flag `has_variant_choice = true` na championie, zapis trait hashes do oddzielnej tabeli `champion_variant_traits`

### Usunięcie `MissFortuneVariantsHook`

Obecny hook jest hardcoded i **zgaduje** nazwy wariantów. Po implementacji Layer 2:
- Hook staje się niepotrzebny — warianty są wykryte automatycznie z plików klienta
- Generyczny kod pokrywa MF + każdą przyszłą postać z tą mechaniką
- Można go odstrzelić

### Co zostaje w hookach

Hooki pozostają dla rzeczy których **nie da się wyciągnąć z plików klienta:**
- `MechaEnhancedHook` — jeśli "Mecha pairing" to pure game logic (runtime), nie ma go w BIN-ach
- `RemoveNonPlayableHook` — regułowe filtrowanie "dummy units", decyzja produktowa

---

## Rekomendowany next step

1. **Zaimplementować `FnvHasher` service** (PHP) — proste, ~10 linii
2. **Zaimplementować eksperymentalny `tft:inspect-character {apiName}` command** — który pobiera `game/characters/{name}.cdtb.bin.json`, parsuje, rozwiązuje hashe przez aktualny set traitów, dumpuje do stdout. Cel: zweryfikować że FNV1a na znanych trait api_names rzeczywiście matchuje hashe z BIN-a MF.
3. **Jeśli test przechodzi** — dodaj Layer 2 importer jako command `tft:import-character-bins`
4. **Odstrzel hardcoded `MissFortuneVariantsHook`** — zastąp generycznym variant extractorem
5. **Zweryfikuj na kilku innych TFT17 championach** — sprawdź czy są jeszcze postacie z `_traitclone` wariantem

Zapisane pliki w `storage/tft-bin-cache/` są zachowane jako referencja dla implementacji.

---

## Sources

- Lokalny cache: `storage/tft-bin-cache/`
  - `mf_character.pretty.json` — 1691 linii, main record
  - `mftc_character.pretty.json` — 97 linii, TraitClone record
  - `mf_skin0.pretty.json` — 44655 linii, VFX tylko (żeby nie używać)
  - `mf_root.json`, `mftc_root.json` — mini meta
- [`CommunityDragon/Docs/assets.md`](https://github.com/CommunityDragon/Docs/blob/master/assets.md) — oficjalny layout (pomija sufiks `.cdtb.bin.json`)
- [`CommunityDragon/Data`](https://github.com/CommunityDragon/Data) — hashlisty FNV1a do rozwiązywania kluczy
- [Hextechdocs: Resolving spell variables](https://hextechdocs.dev/resolving-variables-in-spell-textsa/) — ogólna mechanika FNV1a
