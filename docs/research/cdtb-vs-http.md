# CDTB vs HTTP-only — decyzja pipeline'u

**Status:** research complete (2026-04-13)
**Decyzja:** HTTP-only przez `raw.communitydragon.org`, **bez** lokalnego CDTB mirrora.

---

## TL;DR

Nie stawiamy lokalnego CDTB dump. Dalej fetchujemy z `raw.communitydragon.org` przez HTTP — to robią wszyscy agregatorzy i to wystarcza. Mechaniki niestandardowe (jak Miss Fortune Set 17 z 3 wariantami traitu) **są dostępne przez HTTP** jako `game/data/characters/{name}/{name}.bin.json` — nie trzeba ściągać klienta.

---

## Co to jest CDTB

[`CommunityDragon/CDTB`](https://github.com/CommunityDragon/CDTB) — Python CLI + library pełniący trzy role:

1. **Downloader** — ściąga pliki klienta LoL z Riot CDN (live + PBE), ten sam patcher co oficjalny klient
2. **Unpacker** — rozpakowuje `.wad` (format Riot), rozwija BIN-y do JSON, konwertuje SKN i inne formaty
3. **Exporter** — generuje strukturę serwowaną przez `raw.communitydragon.org`

Istnieje też [Rust port `cdragon-rs`](https://github.com/CommunityDragon/cdragon-rs) — szybszy, nowsze featury.

**Instalacja na Windows:** `pip install cdtb` + `cdtb fetch-hashes`. Czysty Python, Herd nieistotny.

**Przykładowe komendy:**
```bash
cdtb -v download -s cdn patch=               # live, najnowszy patch
cdtb -v download -s cdn --patchline pbe patch=main
cdtb download -s cdn --no-lang patch=        # bez tłumaczeń
cdtb wad-extract path/to/assets.wad
cdtb export -s cdn --patchline pbe --full main
```

**Output:** struktura odwzorowująca `raw.communitydragon.org/latest/` — BIN-y już dumpowane do `.bin.json`, assets rozpakowane.

---

## Dlaczego to overkill dla nas

### Rozmiar
| Scenariusz | Rozmiar |
|---|---|
| Pełny export (wszystkie języki, game + LCU) | **30-60 GB / patch** |
| `--no-lang` (bez tłumaczeń, bez VO) | 15-25 GB |
| Tylko game client (minimum z TFT) | 8-15 GB |

### Brak "tylko TFT" flagi
TFT siedzi wewnątrz `lol_game_client` razem z LoL-em. Nie da się pobrać selektywnie — nawet najodchudzony dump to 8-15 GB **głównie rzeczy które nam niepotrzebne** (skórki LoL, VFX, audio).

### Maintenance overhead
- Brak wbudowanego schedulera — musisz sam robić Windows Task Scheduler
- Re-sync po każdym patchu (~tydzień cykl)
- Hashlisty są niekompletne — część pól w BIN-ach lądują jako `{0x1234abcd}` dopóki CommunityDragon/Data nie doda mapowania
- PBE/live drift — nowy patch często wprowadza struktury, których jeszcze nikt nie rozwinął

### Nie rozwiązuje naszego problemu
Sprawdzaliśmy CDTB głównie dlatego że agregowany JSON `cdragon/tft/en_us.json` nie ma mechaniki Miss Fortune Set 17 (wybór traita zmieniający ability). Ale **rozwiązanie nie wymaga mirrora** — raw BIN jest dostępny przez HTTP.

---

## HTTP-only pipeline — co jest dostępne

### Oficjalny layout (`raw.communitydragon.org`)

Z [`CommunityDragon/Docs/assets.md`](https://github.com/CommunityDragon/Docs/blob/master/assets.md):

```
https://raw.communitydragon.org/{patch|latest|pbe}/
├── game/                                       # game client files
│   ├── data/
│   │   ├── characters/
│   │   │   ├── tft17_missfortune/
│   │   │   │   ├── tft17_missfortune.bin.json  # ← champion root (kluczowe)
│   │   │   │   ├── skins/
│   │   │   │   └── animations/
│   │   │   └── tft17_.../
│   │   └── maps/shipping/map22/
│   │       └── map22.bin.json                  # set index (53 MB)
│   └── assets/ux/
│       ├── traiticons/                         # ikony traitów
│       └── tft/championsplashes/               # splashe championów
├── plugins/rcp-be-lol-game-data/global/default/   # LCU assets
└── cdragon/
    ├── tft/{locale}.json                       # agregowany JSON TFT
    ├── files.exported.txt                      # master listing (51 MB)
    └── content-metadata.json                   # wersja patcha
```

### Kluczowe endpointy do zakładek

| URL | Po co |
|---|---|
| `raw.communitydragon.org/latest/cdragon/tft/en_us.json` | Primary source, 80% danych, ~20 MB |
| `raw.communitydragon.org/json/latest/game/data/characters/` | **JSON directory listing** — discovery wszystkich championów |
| `raw.communitydragon.org/latest/game/data/characters/{name}/{name}.bin.json` | Champion root BIN — mechaniki niestandardowe (MF variants) |
| `raw.communitydragon.org/latest/game/data/maps/shipping/map22/map22.bin.json` | Set index, Hero Augments, Champion Choice |
| `raw.communitydragon.org/latest/cdragon/content-metadata.json` | Wersja patcha (do detekcji zmiany) |
| `raw.communitydragon.org/binviewer/` | Web UI do przeglądania BIN-ów z PBE (debug tool) |
| `raw.communitydragon.org/latest/cdragon/files.exported.txt` | Master listing wszystkiego co jest |

**Uwaga (do zweryfikowania):** dwa researche dały **sprzeczne** informacje o tym czy plik `tft17_missfortune.bin.json` istnieje w rocie folderu championa, czy całość siedzi w `skins/skin0.bin.json`. `assets.md` (oficjalna dokumentacja) cytuje pierwszą wersję:

> "Detailed champion data are available in bin files, usually from `game/data/characters/<name>/<name>.bin.json`"

**To trzeba zweryfikować empirycznie** przez `curl` + `ls` (JSON listing) przed designem importera.

---

## Rekomendowany pipeline dla Laravela (updated)

### Layer 1 — agregat (jak teraz)
```
GET https://raw.communitydragon.org/latest/cdragon/tft/en_us.json
```
- Fetch raz na import, cache ETag/Last-Modified w `data_imports`
- Parsuj `setData[]`, `items`, `heroAugments`

### Layer 2 — champion root BIN (nowy, dla mechanik)
```
GET https://raw.communitydragon.org/latest/game/data/characters/{apiName_lower}/{apiName_lower}.bin.json
```
- Trigger **tylko** dla championów których potrzebujemy (np. flaga w kodzie: "MF wymaga bin parse" albo auto-detect po ilości spellów)
- **Lepiej:** trigger dla wszystkich, auto-detect po `CharacterRecords/Root.spellNames[].length > 1` → znacznik `has_multiple_abilities`

### Layer 3 — map22 BIN (opcjonalny, dla indeksu setu)
```
GET https://raw.communitydragon.org/latest/game/data/maps/shipping/map22/map22.bin.json
```
- 53 MB, raz dziennie
- Parsuj wpisy `TftChampionChoice` / `TftHeroAugment` jako dane referencyjne do layer 2

### Discovery nowych championów
```
GET https://raw.communitydragon.org/json/latest/game/data/characters/
```
- JSON listing, filtr po prefixie `tft{set_number}_`
- Porównaj z DB → auto-detekcja nowych championów po patchu

### HTTP pułapki do obsłużenia
- **Rate limiting:** throttle 5-10 req/s, Laravel `Http::retry(3, 2000)`
- **`latest` może flipnąć w trakcie importu do nowego patcha** — pinnij konkretny `patch_version` z `content-metadata.json` na starcie runu, resztę fetche rób pod tym pinnem
- **Nieznane hashe w bin.json** (`{0x1234abcd}`) — parser musi tolerować, nie rzucać

---

## Opcjonalny selective cache (dla dev/research, nie produkcji)

Jeśli chcesz móc robić `grep -r` po BIN-ach lokalnie bez ściągania 15 GB:

```bash
# Prosty selective dump, ~500 MB
mkdir -p storage/tft-bin-cache
curl -s https://raw.communitydragon.org/json/latest/game/data/characters/ \
  | jq -r '.[] | select(.name | startswith("tft17_")) | .name' \
  | while read dir; do
      curl -s -o "storage/tft-bin-cache/$dir.bin.json" \
        "https://raw.communitydragon.org/latest/game/data/characters/$dir/$dir.bin.json"
    done
curl -s -o "storage/tft-bin-cache/map22.bin.json" \
  https://raw.communitydragon.org/latest/game/data/maps/shipping/map22/map22.bin.json
```

Po tym masz lokalny `grep -r "MissFortune" storage/tft-bin-cache/` do eksploracji. Ale to **tool dev-time**, nie część importera.

---

## Kiedy CDTB jednak miałby sens

Wyłącznie jeśli:
1. Natrafisz na BIN którego CDragon jeszcze nie wystawił jako `.bin.json` (rzadkie, zazwyczaj fix w ciągu 24h)
2. Musisz inspectować WAD archive bezpośrednio przed rozpakowaniem
3. Budujesz własny hashlist / researchujesz nowy format

Wtedy jednorazowo `pip install cdtb && cdtb download -s ./cdn --no-lang patch=` — potraktuj jako debugging tool na zewnętrznym dysku, nie component pipeline'u.

---

## Sources

- [CommunityDragon/CDTB](https://github.com/CommunityDragon/CDTB)
- [CommunityDragon/cdragon-rs](https://github.com/CommunityDragon/cdragon-rs)
- [CommunityDragon/Docs/README.md](https://github.com/CommunityDragon/Docs/blob/master/README.md)
- [CommunityDragon/Docs/assets.md](https://github.com/CommunityDragon/Docs/blob/master/assets.md) — **must-read**
- [CommunityDragon/Docs/binfile.md](https://github.com/CommunityDragon/Docs/blob/master/binfile.md)
- [CommunityDragon/Docs/wad.md](https://github.com/CommunityDragon/Docs/blob/master/wad.md)
- [CDragon Discord](https://discord.gg/rZQwuek) — live support
