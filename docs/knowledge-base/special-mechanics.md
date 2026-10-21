# TFT Set 18 — Special Mechanics

> Mechaniki, które wpływają na budowanie drużyn i jak tft-scout je modeluje.
> Źródła: CDragon `latest` (16.20) — `en_us.json`, character biny, `map22.bin.json`; MetaTFT ranked.
> Set 17 (Mecha, hero augmenty, MF): `set17/special-mechanics.md`.

---

## 1. Avatar — Lux i jego formy (×2 do traitu)

**Mechanika:** Lux występuje w 9 formach żywiołów: Coven, Elderwood, Fae, Inferno, Lunar
(`DA_18_Lux_Moonbeam`), Primal, Solar (`DA_18_Lux_Sunbeam`), Blackthorn, Blossom. Posiadanie Avatara na
ławce/planszy zamienia pozostałe Avatary w sklepie na ten sam żywioł. **Wybrany trait liczy się podwójnie.**

**Dane:** każda forma to osobny champion w CDragon (`Lux (Coven)` itd.) + rekord bazowy `DA_Lux18_Base`
("Lux", tylko trait Avatar). Podwójne liczenie jest w binie: `mLinkedTraits[{TraitData: …DA_18_Coven, Amount: 2}]`.
MetaTFT raportuje wszystkie formy jako `DA_Lux18_Base`.

**Modelowanie:**
- `DisplayNameVariantHook` — formy "X (Y)" → warianty bazy "X" (`base_champion_id`, `variant_label = coven`…),
  baza `is_playable = false`, formy dziedziczą planner code bazy i statystyki umiejętności (biny form nie mają SpellObject).
- `TraitContributionHook` — `Amount` → `champion_trait.amount = 2` → kontekst scouta `traitAmounts: {DA_18_Coven: 2}`.
- Formy wykluczają się (wspólny `base_champion_id` → exclusion group). Ratingi/affinity/companions przez `baseApiName`.

## 2. Apex Predator — Elder Dragon (2 sloty, ×2 Riftbeast)

**Mechanika:** "Elder Dragon takes up 2 team slots and grants +2 to the Riftbeast trait."

**Dane:** +2 Riftbeast = bin `mLinkedTraits[{…DA_Riftbeast18, Amount: 2}]` (Elder Dragon liczy się jako 2, nie 3).
2 sloty nie są nigdzie w danych → `config/tft.php` `sets.18.slots_by_trait = ['DA_18_ApexPredator' => 2]`.

**Modelowanie:** `TraitSlotOverrideHook` → `slots_used = 2`; amount z `TraitContributionHook`. Scorer mnoży wartość
championa przez `slotsUsed` (jak Mecha Enhanced w Set 17), team-builder liczy budżet slotów.

## 3. Riftbeast 10 — +2 maksymalnego rozmiaru drużyny

**Mechanika:** Riftbeast (3/5/7/10) — przy 10: "+2 maximum team size".

**Dane:** zmienna `TeamSize: 2` w efekcie breakpointu 10. Uwaga: w Set 17 Mecha miała `TeamSize: 1` na
**każdym** breakpoincie, a bonus dawał tylko wiersz 6 — dlatego źródłem prawdy jest wiersz opisu (`@MinUnits@`)
który wspomina `@TeamSize@` (`App\Services\Tft\TraitTeamSize`).

**Modelowanie:** `ScoutContextBuilder` → `breakpoint.teamSizeBonus`; worker `trait-rules.ts`
(`buildTeamSizeRules` / `teamSizeBonus`) zamiast hardkodu `TFT17_Mecha`. Lock `Riftbeast:10` na lvl 9 → 11 slotów.
Riftbeast 10 wymaga Elder Dragona (5-cost), więc poniżej lvl 9 jest nieosiągalny (shop odds).

## 4. Adaptor — formy AD/AP

**Mechanika:** "Adaptor abilities change depending on if their Attack Damage or Ability Power is higher."
Akali, Master Yi, Kog'Maw (`_AD`), Gromp, Nidalee (`_AP`).

**Dane:** CDragon ma jedną formę na championa; MetaTFT czasem raportuje drugą (`DA_18_MasterYi_AP` — 12 gier,
`DA_Gromp18_AD` — 291, `DA_NidaleeCougar18_AD` — 15, wobec 600k–1M gier formy z CDragon).

**Modelowanie:** `SetProfile::canonicalUnit` — rodzeństwo `_AD`/`_AP` i aliasy z configu (`metatft_unit_aliases`)
składane do championa z CDragon w ratingach jednostek, companions i meta compach (ważone grami).

## 5. Rival — Kha'Zix / Rengar

**Mechanika:** breakpointy `[1, 1, 2]` — "Only active while fielding 1 Rival" oraz przy 2: "Rivals can be
fielded together, and their abilities grant each other bonuses". Co odblokowuje wariant z dwoma Rivalami, z danych
nie wynika. Kha'Zix ewoluuje (wybór Executioner/Rapidfire/Ravager/Spellweaver), Rengar daje gold i AD.

**Modelowanie:** trait `public` z breakpointem 1 — traktowany jak unikat. Ewolucje Kha'Zixa: bin linkuje tylko
Rival, wybór jest wyłącznie w opisie traita → `config/tft.php` `sets.18.evolutions` + `TraitEvolutionHook` tworzy
4 formy (`DA_18_KhaZix_Executioner|Rapidfire|Ravager|Spellweaver`, base + trait wyboru). Base zostaje grywalny
(nieewoluowany Kha'Zix jest legalny), formy są w jednej grupie wykluczeń z basem; ratingi MetaTFT idą po base.
Warunek odblokowania 2 Rivali dalej nie wynika z danych.

## 6. Pozostałe unikalne traity (1 champion)

Attuned (Alune), Bounty Seeker (Draven), Emerald Aspect (Taric), Greenfather (Ivern), Old Growth (Maokai),
Thornmaiden (Zyra), Monolith (Malphite, `DA_18_Battlemage`), Caustic (Kog'Maw) — zwykłe unikaty, bez specjalnej
obsługi. Flora Fatalis (Fiddlesticks, Soraka; 1/2) — zwykły trait.

## 7. Eclipse

Trait bez championa i bez breakpointu (`minUnits = null`) — aktywowany inną drogą niż liczbą jednostek.
Importer oznacza go `hidden` (zostaje w DB dla ratingów MetaTFT, znika z pickerów i kontekstu scouta).

## 8. Itemy Set 18

- Cała pula w przestrzeni `DA_`: komponenty `DA_Component_*`, itemy `DA_InfinityEdge`, radianty
  `DA_InfinityEdgeRadiant` / `DA_AdaptiveHelm_Radiant`, artefakty `DA_Artifact_*`, emblematy `DA_18_Emblem*`.
  `TFT_Item_*` nie są używane w meczach (`evergreen_items = false`) i nie są listowane w UI.
- Mikstury (`DA_HealthPotion18`, `DA_ManaPotion18`, `DA_BlastPotion18` + radianty) — typ `mechanic`.
- ~350 jednorazowych "zapów" z różdżek (`assets/ux/tft/hud/zaps/wands`, np. Minor Polymorph, Phantom Emblem)
  i consumables (Boostery, Duplicatory, Reforger) — pomijane przy imporcie.
- Augmenty bez markera `_Augment_` — rozpoznawane po ikonie w `icons/augments/`; tier z hashowanego tagu
  (`{d11fd6d5}` silver, `{ce1fd21c}` gold, `{cf1fd3af}` prismatic). Hero augmentów w Set 18 brak.

## 9. Role championów (inferowane)

Set 18 nie ma ról w danych (`role = null` w `en_us.json`, brak `CharacterRole` w binach). `RoleInferenceHook`:
- typ obrażeń: więcej "physical damage" czy "magic damage" w opisie umiejętności → AD/AP; remis → ikony skalowania;
  dalej remis → H (hybrid),
- kategoria: zasięg ≥ 4 → Carry (AD) / Caster (AP, H); bliżej → Fighter jeśli ma trait z `fighter_traits`
  (Ravager, Adaptor, Rival), inaczej Tank.

To heurystyka — role są nasze, nie Riot. Sprawdzenie na 60 meta compach MetaTFT: minimum 2 efektywnych
frontline'ów na comp, więc kara za brak frontline'u w scorerze została podniesiona (0 → 30 pkt, < 2 → 10 pkt).
