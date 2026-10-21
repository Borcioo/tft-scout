# Set 18 — kształt danych CDragon / MetaTFT

**Status:** zbadane 2026-10-20 na CDragon `latest` = 16.20 (Set 18 live, PBE 16.22) i MetaTFT ranked
(`latest_cluster_id` → `tft_set: TFTSet18`). Co z tego wynika dla importu i scouta:
`docs/knowledge-base/special-mechanics.md`.

## Co się zmieniło względem Set 17

| Obszar | Set 17 | Set 18 | Obsługa |
|---|---|---|---|
| Prefiks api_name | `TFT17_*` | `DA_*`, numer setu w dowolnym miejscu: `DA_18_Ahri`, `DA_Amumu18`, `DA_Gromp18_AP`; summony MetaTFT `TFT18_*` | `config/tft.php` `sets.{N}.prefixes`, `App\Support\SetProfile` |
| Nazwa setu w `setData` | `Set17` | `Set10` (błąd w danych) | importer ufa nazwie tylko gdy zawiera numer |
| Itemy | wspólna pula `TFT_Item_*` + `TFT5_*Radiant` | własne rekordy: `DA_Component_*`, `DA_InfinityEdge`, `DA_*Radiant` / `DA_*_Radiant`, `DA_Artifact_*` | `evergreen_items = false`; `shouldSkipNamespacedItem()` |
| Augmenty | `TFT17_Augment_*` | brak markera (`DA_Kingslayer`, `DA_18_RiftbeastTraitAugment`) | rozpoznanie po ikonie `icons/augments/`, tier z tagu |
| Mechanika setu | — | ~350 "zapów" z różdżek (tag `{5b609ae2}`, ikony `hud/zaps/wands`) | pomijane |
| Role championów | `role` w `en_us.json` (z `CharacterRole` w binie) | `role = null`, brak `CharacterRole`; `TFTCharacterRoleData` istnieje w `map22`, ale nic do niego nie linkuje | `RoleInferenceHook` |
| Liczność traitu | — | `mLinkedTraits[].Amount` (Lux ×2, Elder Dragon ×2) | `TraitContributionHook` → `champion_trait.amount` |
| Rozmiar drużyny | Mecha: `TeamSize` na każdym bp | Riftbeast: `TeamSize` tylko na bp 10 | `TraitTeamSize` (wiersz opisu z `@TeamSize@`) |
| Nazwy spelli w binach | `{apiName}Spell` | `TFT18_{Postać}Spell` (`DA_18_Ahri` → `TFT18_AhriSpell`), `spellNames` puste | fallback: jedyny zlokalizowany `*Spell` |
| Ikony umiejętności | ścieżka `.tex` | dosłowny string `"None"` (73/74) | traktowane jak brak ikony |

## Stringtable — klucze plaintext (dotyczy wszystkich setów)

`game/en_us/data/menu/en_us/tft.stringtable.json` trzyma teraz klucze, które CDragon umie odhashować, jako
**lowercase plaintext** (`spell_tft18_ahrispell_tooltip`), resztę dalej jako `{xxh3 & mask(38)}`. Resolver szukał
tylko po hashu, więc **wszystkie** opisy umiejętności (też Set 17) przestały się rozwiązywać.
`StringtableCache::find()` sprawdza plaintext, potem hash.

## Ograniczenia (nie do obejścia po naszej stronie)

- **Liczby umiejętności:** `en_us.json` ma puste `ability.variables` dla Set 18, a wiele binów ma zaciemnione
  DataValues (`DataValue`, `OtherValue`, kalkulacje pod hashami `{d678dbfb}`). Szablony typu `@MagicDamageCalc1@`
  zostają bez wartości dla części championów (np. Ahri). Pełne liczby mają m.in. Alune, Kobuko.
- **Placeholdery:** Lux i Mama Beak wskazują w binie na stub "Placeholder Tooltip" — zostaje tekst z `en_us.json`.
- **Warunek odblokowania 2 Rivali** nie jest w danych. (Ewolucje Kha'Zixa są — tylko w opisie traita Rival, nie w
  binie; modelowane przez `sets.18.evolutions`, patrz knowledge-base/special-mechanics.md.)
- **Itemy Set 18** (`DA_InfinityEdge`, komponenty, emblematy) to w `map22.bin.json` stuby: `TftItemData` bez
  `mDescriptionNameTra` i bez `constants` (evergreen `TFT_Item_*` ma oba), w `en_us.json` `desc: null`,
  `effects: {}`, w stringtable tylko `*_name`. Opisów i statystyk nie ma skąd wziąć; kopiowanie z evergreen
  bliźniaków byłoby zgadywaniem (zweryfikowane 2026-10-21).
- **Formy Adaptor** po stronie MetaTFT to promil gier — scalane, ale realnie bez wpływu na ratingi.

## Weryfikacja na żywych danych (2026-10-20)

- `tft:import --set=18`: 36 traitów (Eclipse hidden), 74 championów (73 grywalne, 9 form Lux), 121 itemów,
  250 augmentów, 20 emblematów; Elder Dragon `slots_used = 2`, Riftbeast ×2; formy Lux ×2 na żywioł.
- `metatft:sync --set=18`: 65 unitów, 91 breakpointów traitów, 5911 affinity, 4160 companions, 60 meta compów.
- Scout CLI: lock `Riftbeast:10` na lvl 9 → drużyna 11 slotów (9 + 2); `Coven:5` + emblemat → Lux (Coven) liczony ×2.
