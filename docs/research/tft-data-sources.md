# Źródła danych TFT — research

**Status:** research complete (2026-04-12)
**Cel:** ustalić skąd brać dane o championach/traitach/itemach/augmentach/mechanikach do importera Laravel
**Kontekst:** stary projekt używał SQLite + MetaTFT cache; nowy projekt buduje własny pipeline importu

---

## TL;DR

- **Data Dragon dla TFT jest ubogi z zamiaru** — Riot tego nie rozwija (issue `RiotGames/developer-relations#138`). Używaj tylko do detekcji wersji patcha i oficjalnych tłumaczeń nazw.
- **CommunityDragon = primary source.** Wszystkie agregatory (MetaTFT, tactics.tools, MobaLytics, TFTacademy, Metabot) zaczynają tutaj.
- **Zagregowany JSON** `raw.communitydragon.org/latest/cdragon/tft/en_us.json` (~20 MB) pokrywa ~80% potrzeb: `setData[]`, `items`, `champions[] {apiName, cost, traits, stats, ability}`. Polska lokalizacja dostępna jako `pl_pl.json`.
- **Mechaniki niestandardowe** (Headliner, Hero Augments, wybory traitów jak Miss Fortune Set 17) siedzą w raw binach: `game/data/characters/tft17_{name}/skins/skin0.bin.json` + indeks w `game/data/maps/shipping/map22/map22.bin.json`.
- **TFT17 jest aktualnie na `/pbe/`**, nie `/latest/`. Na `/latest/` są tylko TFT3–TFT16 (kwiecień 2026).

---

## 1. Riot Data Dragon (`ddragon.leagueoflegends.com`)

Oficjalne, ale ubogie dla TFT.

**Użyteczne endpointy:**
- `https://ddragon.leagueoflegends.com/api/versions.json` — pierwszy element = latest patch
- `https://ddragon.leagueoflegends.com/cdn/languages.json`
- `https://ddragon.leagueoflegends.com/cdn/{version}/data/{lang}/tft-champion.json`
- `.../tft-trait.json`, `.../tft-item.json`, `.../tft-augments.json`
- `.../tft-queues.json`, `.../tft-arena.json`, `.../tft-tactician.json`

**Co tam jest:** `id`, `name` (przetłumaczona), `tier`, `image`. Koniec.

**Czego nie ma:** statów, spelli, mechanik, variables, trait breakpointów, formuł scalingu.

**Zastosowanie w pipeline:**
- Detekcja nowego patcha (cron co 1h: `GET api/versions.json`, compare z ostatnim znanym)
- Fallback dla oficjalnych tłumaczeń nazw w 20+ językach, jeśli CDragon ma opóźnienie lokalizacji

---

## 2. CommunityDragon (`raw.communitydragon.org`) — główne źródło

Dwa różne zasoby pod jedną domeną.

### A) Zagregowany JSON TFT

`https://raw.communitydragon.org/latest/cdragon/tft/en_us.json` (~20.8 MiB, zweryfikowane 2026-04-08)

**Lokalizacje dostępne:** `ar_ae, cs_cz, de_de, el_gr, en_au, en_gb, en_ph, en_sg, en_us, es_ar, es_es, es_mx, fr_fr, hu_hu, id_id, it_it, ja_jp, ko_kr, pl_pl, pt_br, ro_ro, ru_ru, th_th, tr_tr, vi_vn, zh_cn, zh_my, zh_tw`

**Struktura top-level:** `items`, `setData[]` (lista setów), `sets` (mapa po numerze), `heroAugments`, `tacticians`, `arenas`.

**Champion schema (fragment):**
```json
{
  "apiName": "TFT17_MissFortune",
  "characterName": "...",
  "name": "Miss Fortune",
  "cost": 5,
  "traits": ["Syndicate", "Gunner"],
  "stats": { "hp": 1000, "mana": 60, "initialMana": 30, "damage": 100, "armor": 40, "magicResist": 40, "critChance": 0.25, "critMultiplier": 1.4, "attackSpeed": 0.8, "range": 4 },
  "ability": {
    "name": "...",
    "desc": "Miss Fortune channels @Damage@ damage over @Duration@ seconds",
    "variables": [
      { "name": "Damage", "value": [0, 100, 150, 225] },
      { "name": "Duration", "value": [0, 2, 2, 2] }
    ]
  }
}
```

Template rendering: `ability.desc` ma `@variableName@` placeholdery, `variables[].value[starLevel]` (index 0 = bazowy, 1/2/3 = gwiazdki). Zasady resolucji opisane w [hextechdocs — Resolving spell variables](https://hextechdocs.dev/resolving-variables-in-spell-textsa/).

**CDragon buduje ten plik codziennie** dla live + PBE.

### B) Raw bin-y klienta (`/game/data/...`)

Potrzebne dla mechanik niestandardowych.

- **Champion root:** `https://raw.communitydragon.org/pbe/game/data/characters/tft17_{name}/`
  - `skins/root.bin.json` — główny rekord, linkuje do character data
  - `skins/skin0.bin.json` — VFX, SpellObjects, CharacterRecord, stats
- **Ikony traitów:** `https://raw.communitydragon.org/latest/game/assets/ux/traiticons/`
- **Splash championów:** `https://raw.communitydragon.org/latest/game/assets/ux/tft/championsplashes/`
- **Indeks wszystkich plików:** `https://raw.communitydragon.org/latest/cdragon/files.exported.txt` (51 MiB listing)

**Patch live vs PBE:** zamień `/latest/` ↔ `/pbe/`. TFT17 championi są obecnie TYLKO na `/pbe/`.

**Historyczne patche:** CDragon RAW ma tylko `latest` i `pbe`. Archiwum per patch wymaga własnego snapshotowania albo `CommunityDragon/CDTB` lokalnie.

### C) Map bin — indeks setu

`https://raw.communitydragon.org/latest/game/data/maps/shipping/map22/map22.bin.json` (53 MiB)

Mapa 22 = TFT. Zawiera wszystkie referencje do aktualnie zaciągniętych charakterów, augmentów, itemów, trait breakpointów. To "indeks" który mówi co w ogóle jest live. **Tutaj siedzą też wpisy typu `TftChampionChoice` / `TftHeroAugment`** dla multi-choose mechanik.

---

## 3. Raw game client data (bin/wad)

Nie musisz ściągać klienta — CDragon robi to za ciebie. CDTB rozpakowuje WAD-y i konwertuje BIN do JSON.

**Format BIN:** typed structured data z hashowanymi kluczami (FNV1a32). CDragon częściowo rozwija hashe używając listy z `CommunityDragon/Data`. Nierozwinięte pola zostają jako `{hex}`.

**Narzędzia (gdyby potrzeba własnego pipeline'u):**
- [`CommunityDragon/CDTB`](https://github.com/CommunityDragon/CDTB) — Python scraper + unpacker + bin→json
- [`LeagueToolKit/LeagueToolkit`](https://github.com/LeagueToolKit/LeagueToolkit) — C# reader WAD/BIN
- [`moonshadow565/Obsidian`](https://github.com/moonshadow565/Obsidian) — UI viewer
- [`Morilli/ritoddstats`](https://github.com/Morilli) — czytanie binów

**Stabilne repo z dumpami na GitHub:**
- [`InFinity54/TFT_DDragon`](https://github.com/InFinity54/TFT_DDragon) — mirror oficjalnych JSON-ów + ekstra dla starszych setów
- [`CommunityDragon/CDTB`](https://github.com/CommunityDragon/CDTB) + [`CommunityDragon/Data`](https://github.com/CommunityDragon/Data) — tooling + hashlisty
- [`CommunityDragon/Docs`](https://github.com/CommunityDragon/Docs/) — [assets.md](https://github.com/CommunityDragon/Docs/blob/master/assets.md) i [binfile.md](https://github.com/CommunityDragon/Docs/blob/master/binfile.md)

---

## 4. Inne źródła (gorszy wybór)

- **Meraki Analytics / [`lolstaticdata`](https://github.com/meraki-analytics/lolstaticdata)** — tylko LoL, ich TFT projekt nieaktywny od Set 6.
- **Fandom wiki** (`Module:TFTChampionData/data` etc.) — Lua tables, community-maintained. Dobre do cross-checkingu, nie jako primary (opóźnienie, human errors).
- **[datatft.com](https://datatft.com)** — własne JSON-y ale bez publicznego API, scraping.
- **Riot API TFT-MATCH-V5** — to inny pipeline (match aggregation, meta stats), nie dla static data.

---

## 5. Jak robią to agregatory

Publicznych blogpostów praktycznie nie ma. Wnioski z analizy ich buildów JS, network requestów i dev discordów:

**Match data (live stats, tier listy):** Riot TFT-MATCH-V5 → crawl Challenger/GM/Master + sampling. Wszyscy robią to samo.

**Static data (championi, traity, itemy, mechaniki):**
- **MetaTFT, tactics.tools, MobaLytics, Blitz, TFTacademy, LoLCheese, Metabot.gg** — wszyscy zaczynają od `raw.communitydragon.org/latest/cdragon/tft/en_us.json`. Widać to po identycznych `apiName`, strukturach `ability.variables`, i tych samych nietłumaczonych polach w UI.
- Do mechanik custom dodatkowo parsują `skins/skin0.bin.json` + `map22.bin.json`.
- Ikony/splashe bezpośrednio z `raw.communitydragon.org/latest/game/assets/...`.
- **TFTactics.gg** dodatkowo scrape'uje oficjalne Riot patch notes do `description`/`changelog`.
- **MetaTFT** ma osobnego agenta (OverWolf) do telemetrii gracza — tylko live stats, nie static.

[hextechdocs](https://hextechdocs.dev/) (projekt półoficjalny, współpracujący z Riotem) potwierdza ścieżkę: "zacznij od DataDragon, brakujące rzeczy w CDragon, bin-y dla szczegółów".

---

## 6. Case study: Miss Fortune (TFT17) — wybór traita

MF w Set 17 przy wystawieniu daje wybór między **Channeler Mode / Challenger Mode / Replicator Mode**, każdy zmienia ability i dołącza inny trait. Potwierdzone przez [MobaLytics Set17 MF](https://mobalytics.gg/tft/set17/champions/missfortune) i [Metabot.gg guide](https://metabot.gg/en/TFT/news/4b5a3d05-9b2e-4f55-ac37-fb2c969a9006).

**Lokalizacja (zweryfikowane na PBE):**
```
https://raw.communitydragon.org/pbe/game/data/characters/tft17_missfortune/
├── skins/
│   ├── root.bin.json      (511 B — linkuje do character records)
│   ├── skin0.bin.json     (503.6 KiB — VFX + character + spells)
│   └── ...
└── animations/
```

**W `skin0.bin.json` znalezione partykuły trzech wariantów ability:**
- `TFT17_MissFortune_Base_R_ChannelerTrait_Mis_Child02` (Channeler = AP/mana wariant)
- `TFT17_MissFortune_Base_Q_ASTrait_Mis` (AS = Challenger wariant)
- (trzeci — Replicator — w tym samym pliku)

**Logika wyboru** (wzorzec z poprzednich setów, np. Hero Augments z Set 8/9, Headliner z Set 10):
1. **Multi-spell CharacterRecord** — w `CharacterRecords/Root.spellNames[]` jest **wiele wpisów**, jeden per mode. Każdy `SpellObject` ma własne `mDataValues`, `mEffectAmount`, `mLinkedTrait`/`mChampionTraitBits`.
2. **UI choice enumeration** — zazwyczaj parametryzowane w `map22.bin.json` pod kluczem `TftChampionChoice` / `TftHeroAugment`.

**Sygnatura multi-choose:** `CharacterRecords/Root.spellNames[].length > 1` na championie. To jest generyczny detektor który powinien łapać każdy podobny przypadek w przyszłych setach.

**Do weryfikacji lokalnie:** dokładny klucz pod którym siedzi enumeracja wyborów (`TftChampionChoice`, `mChoices[]`, `HeroAugment`, czy coś nowego dla Set 17). WebFetch padł na 10MB limicie pliku — trzeba `curl`-em ściągnąć `skin0.bin.json` + `map22.bin.json` i wygrepować `MissFortune` + `Trait` + `Choice`/`Mode`.

**Wzorzec resolucji spelli** ([hextechdocs](https://hextechdocs.dev/resolving-variables-in-spell-textsa/)):
1. Wejdź w `Characters/{name}/CharacterRecords/Root`
2. Przeczytaj `spellNames[]` — ścieżki względne do `Characters/{name}/Spells/{spellName}`
3. Każdy spell ma `mDataValues`, `mEffectAmount`, `mSpellCalculations`
4. W `desc` rozwiąż `@name@` przez `mDataValues` lub fallback przez `FNV1a32(lowercase(name))` jako hex key

---

## 7. Rekomendowany pipeline dla Laravela

### Tier 1 — szybki 80% coverage (1 dzień)
- `ImportTftStaticDataCommand` → pobiera `cdragon/tft/en_us.json` (i `pl_pl.json` dla PL lokalizacji)
- Parsuje `setData[]`, filtruje po `number == current_set`, wypełnia tabele `champions`, `traits`, `items`, `augments`
- Template rendering `ability.desc` → podmiana `@var@` z `variables[].value[starLevel]`
- Ikony: link bezpośrednio do CDragon URL-i, opcjonalnie mirror do `storage/app/public/tft/`

### Tier 2 — mechaniki custom (+1-2 dni)
- `ImportTftCharacterBinsCommand` → iteruje po `champions[].apiName`, pobiera `game/data/characters/{apiName_lowercase}/skins/skin0.bin.json`
- Wyciąga `CharacterRecords/Root.spellNames[]` + każdy `SpellObject`
- **Flag na championie:** `has_multiple_abilities = (spellNames.length > 1)` + zapis w tabeli `champion_ability_variants`
- Osobno: `ImportTftMap22Command` → fetch `map22.bin.json`, parse wpisów typu `TftChampionChoice` / `TftHeroAugment`

### Tier 3 — archiwum i historia (+1 dzień)
- Każdy import → snapshot do `storage/app/tft-snapshots/{YYYY-MM-DD}-{patch}.json` (gitignored)
- Model `DataImport` (już jest w migracjach) trackuje: `patch_version`, `source_url`, `hash`, `timestamp`, `diff_vs_previous`

### Jedno źródło czy wiele?

**CommunityDragon jako primary wystarczy na 95%.** Uzupełnij:
- **Data Dragon** — tylko do `versions.json` (detekcja patcha) i fallback tłumaczeń
- **Riot TFT-MATCH-V5** — osobny pipeline dla meta stats (model `MetaComp`)
- **Fandom wiki** — tylko jako manual debug fallback

### Automatyzacja patchy

1. **Cron co 1h:** `GET api/versions.json` → compare z ostatnim znanym
2. **Cron co 1h:** `HEAD raw.communitydragon.org/latest/cdragon/tft/en_us.json` → jeśli `Last-Modified` nowszy, trigger full re-import
3. **Detekcja nowego setu:** po każdym imporcie `max(setData[].number)`. Jeśli wzrosło → event `NewSetDetected` + auto-insert do `sets` + alert
4. **PBE tracking (opcjonalnie):** równolegle `/pbe/cdragon/tft/en_us.json` do osobnego schematu `tft_pbe.*` — widać zmiany 1-2 tygodnie przed live

---

## 8. Checklist akcji (Laravel)

### Setup jednorazowy
- [ ] `app/Services/Import/CommunityDragonClient.php` — Guzzle client, base URL, timeout 120s, retry 3x
- [ ] `config/tft.php` — `current_set`, `cdragon_base_url`, `ddragon_base_url`, `supported_locales`, `channel` (live/pbe)
- [ ] Storage: `storage/app/tft-snapshots/` (gitignored) + `storage/app/public/tft/icons/`
- [ ] `.env`: `TFT_IMPORT_CHANNEL=pbe` (dopóki Set 17 tylko na PBE)

### Artisan commands
- [ ] `tft:import-static {--locale=en_us} {--channel=live}`
- [ ] `tft:import-bins {--champion=*}`
- [ ] `tft:import-map22`
- [ ] `tft:check-patch` (exit 0 = nic nowego, exit 1 = nowy patch — dla cron chaining)
- [ ] `tft:mirror-assets`

### Scheduler
- [ ] `tft:check-patch` — co 1h
- [ ] `tft:import-static` — co 6h + on-demand po check-patch
- [ ] `tft:import-bins` — raz dziennie (noc)
- [ ] `tft:import-map22` — raz dziennie
- [ ] Monitoring przez model `DataImport` (success, patch_version, duration_ms, items_imported, errors)

### Template resolver
- [ ] `app/Services/Tft/AbilityTextRenderer.php` — `desc` + `variables` + `starLevel` → HTML/text. Obsługa `@var@`, formatowania liczb, znaczników (`%i:scaleAP%`)

### Testy
- [ ] Fixture `tests/Fixtures/cdragon_tft_en_us_sample.json` (~5 championów łącznie z TFT17_MissFortune)
- [ ] Feature test `ImportTftStaticDataCommandTest` — mockowany HTTP, weryfikacja że MF dostaje `has_multiple_abilities = true`
- [ ] Snapshot test dla `AbilityTextRenderer`

### Ręcznie po pierwszym imporcie
- [ ] `curl -o mf.json https://raw.communitydragon.org/pbe/game/data/characters/tft17_missfortune/skins/skin0.bin.json`
- [ ] Wygrepować `spellNames`, `ChoiceUI`, `Replicator`, `Channeler` żeby zidentyfikować dokładny klucz mechaniki wyboru
- [ ] Dodać znaleziony pattern do `ImportTftCharacterBinsCommand` jako **generyczny extractor** (NIE hardcode'ować MF — w kolejnych setach będą inne dziwaki)

---

## Niepewne / do weryfikacji ręcznie

1. **Dokładny klucz logiki wyboru traita MF** w `skin0.bin.json` / `map22.bin.json`. Agent nie potwierdził bit-by-bit (WebFetch 10MB limit). Wymagane lokalne pobranie plików.
2. **Root bin championa** — zweryfikowane że `tft17_missfortune.bin.json` w rocie folderu **NIE istnieje**. Tylko `skins/` i `animations/`. Cała logika w `skins/skin0.bin.json` + `skins/root.bin.json`.
3. **Historyczne snapshoty per patch na CDragon** — tylko `latest` i `pbe` publicznie. Starsze = `CDTB` lokalnie lub własne archiwum.
4. **Exact top-level keys w `en_us.json`** — niepotwierdzone bit-by-bit (10MB limit), ale zgodne z dokumentacją CDragon i praktyką agregatorów: `{items, setData, sets, heroAugments, tacticians, arenas}`.

---

## Sources

- [CommunityDragon RAW — TFT cdragon index](https://raw.communitydragon.org/latest/cdragon/tft/)
- [CommunityDragon Docs — assets.md](https://github.com/CommunityDragon/Docs/blob/master/assets.md)
- [CommunityDragon Docs — binfile.md](https://github.com/CommunityDragon/Docs/blob/master/binfile.md)
- [CommunityDragon CDTB (scraper)](https://github.com/CommunityDragon/CDTB)
- [CommunityDragon Data (hash lists)](https://github.com/CommunityDragon/Data)
- [Riot Developer Portal — TFT docs](https://developer.riotgames.com/docs/tft)
- [RiotGames/developer-relations issue #138 — Data Dragon for TFT](https://github.com/RiotGames/developer-relations/issues/138)
- [Hextechdocs — Static Data](https://hextechdocs.dev/static-data/)
- [Hextechdocs — Resolving spell variables](https://hextechdocs.dev/resolving-variables-in-spell-textsa/)
- [InFinity54/TFT_DDragon mirror](https://github.com/InFinity54/TFT_DDragon)
- [MobaLytics — Miss Fortune TFT Set 17](https://mobalytics.gg/tft/set17/champions/missfortune)
- [Metabot.gg — TFT Set 17 guide](https://metabot.gg/en/TFT/news/4b5a3d05-9b2e-4f55-ac37-fb2c969a9006)
