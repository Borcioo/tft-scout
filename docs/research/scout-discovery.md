# Scout — odkrywanie plansz ("perełki")

**Status:** 2026-10-21, prototyp offline (`npm run scout -- discover`), dane 18.4b. Kod:
`scripts/scout-cli/commands/discover.ts`, `oracle.ts` (`--rank`), `top-games.ts`. Model siły: `scout-strength-model.md`.

## Cel

Znaleźć compy, wariacje i jednostki, które działają, a których prawie nikt nie gra — zanim potwierdzą je
masowe statystyki. Najlepsi gracze odkrywają takie rzeczy pierwsi; ich gier jest mało, ale wygrywają nimi.

## Pułapki i jak je obchodzimy

| Pułapka | Rozwiązanie |
|---|---|
| Topowi gracze wygrywają czymkolwiek | porównania wewnątrz rangi: lobby dobierane rangą → średnia w Master+ = 4.5 |
| Mała próbka = szczęście (z tysięcy rzadkich plansz część wygląda świetnie losowo) | Bayes: dowód z gier ważony liczbą gier, ściągany do modelu |
| "Bogate plansze wygrywają" (zwycięzcy dochodzą do 9 i kupują 5-costy) | porównania tylko w warstwie: ten sam rozmiar planszy i liczba 5-costów |
| 3★ 4/5-costy | zmierzone: ~1% gier jednostki, przesuwa jej średnią o 0.02–0.04 — pomijalne; w modelu gwiazdek 3★ tylko dla 1–3 costów |
| Ekstrapolacja modelu poza dane | estymata modelu zatrzymana na najlepszym sprawdzonym surowym miejscu w warstwie ("edge") |

## Metoda (`scout discover`)

Dla planszy θ = jej średnie miejsce wśród graczy Master+. Trzy źródła, każde z własną, **zmierzoną** niepewnością
(rozkład normalny, precyzje się sumują, średnia ważona precyzją):

| Źródło | Średnia | Wariancja |
|---|---|---|
| model (siła planszy) | `a + b·raw` dopasowane na planszach z ≥300 grami w Master+, + poprawka optymizmu zmierzona na rzadkich | τ² ≈ 0.64² |
| Gold+ (szeroka próba) | wynik planszy przeliczony na skalę Master+ (zgodność ρ = 0.94) | 0.17² + b²·σ²/n_Gold |
| Master+ | średnie miejsce tej planszy | σ²/n_Master, σ² ≈ 3.0 |

σ²/τ² ≈ 7: **~7–10 gier planszy w Master+ waży tyle co cały model.** Ranking: oczekiwana poprawa względem
najlepszej sprawdzonej planszy w warstwie, `EI = E[max(0, best − θ)]` (optymalizacja bayesowska) — premiuje dobrą
średnią i niepewny potencjał w górę, a nie samo "najlepsze znane". Etykiety: **proven** (≥300 gier w Master+),
**rising** (10–299), **experimental** (<10 — mówi model i ewentualnie Gold+).

## Wyniki (18.4b)

- Model na Master+: Spearman 0.55 (2.2k plansz z ≥50 grami); kalibracja ostrzejsza niż w Gold+ (nachylenie 0.60 vs 0.52).
- Ta sama plansza w Gold+ i Master+: ρ 0.94 — wysoka ranga to ten sam ranking, ostrzej oceniany.
- **Plansze, które top gracze grają relatywnie częściej, wypadają u nich gorzej** (ρ −0.23 z realnym miejscem).
  Wniosek (nie pewnik): na wysokiej randze meta jest kontestowana. Odwrotnie — rzadko grane mocne plansze
  wygrywają, bo nikt ich nie kontestuje.

**Test z wyprzedzeniem** (wyniki Master+ ukryte, 2 816 rzadkich plansz z 10–299 grami w Master+):

| Źródła | ρ z realnym miejscem w Master+ | 80% przedziały pokrywają | Top 10% prognozy → realnie (reszta) |
|---|---|---|---|
| sam model | 0.52 | 74% | 2.31 (3.43) |
| model + Gold+ | 0.91 | 81% | 2.00 (3.47) |

Metoda przewiduje wynik u najlepszych graczy, zanim ci zagrają planszę, a jej niepewność jest uczciwa.

Przykład (8 jednostek, bez 5-costów; najlepsza sprawdzona 1.92): Azir, Kayle, Leona, Sejuani, Soraka, Yunara,
Fiddlesticks, Karma — 122 gry w Master+, średnio 1.72; ta sama rodzina co najwyższe propozycje silnika na lvl 8.

## Top 200 graczy (`scout top-games`, 18.4, 14 dni)

6 037 ich własnych plansz z 5 294 meczów, 201 zapytań (`tmp/scout-eval/top-games-18.json`).

- **Co grają częściej niż reszta, nie wypada u nich lepiej** (ρ 0.05) — ten sam sygnał co w Master+: popularność ≠ siła.
- **Jednostki "słabe" dla mas, dobre u najlepszych** — typowa różnica ogół → top 200 to 1.1 miejsca, tu 1.5–2.3:

  | Jednostka | Ogólnie | Top 200 | 3★ u top | Itemy (top) | Z kim |
  |---|---|---|---|---|---|
  | Camille | 5.55 | 3.26 | 92% | Sterak 54%, IE 32%, HoJ 26% | Akali, Varus, Leona, Kayle, Sejuani |
  | Elise | 5.11 | 3.32 | 80% | Titan 69%, Guinsoo 63%, Gargoyle 62% | Diana, Sentinel, Morgana, Cassiopeia |
  | Kha'Zix | 4.52 | 2.93 | 71% | HoJ 94%, Rabadon 48% | Diana, Fiddlesticks, Hecarim, Ezreal |
  | Akali (AD) | 4.90 | 3.35 | 76% | HoJ, Jeweled, EoN | Varus, Leona, Camille, Kayle |

  Prawie zawsze to **reroll 1-costów do 3★ z konkretnymi itemami**. Średnia ogólna miesza to z graniem tych jednostek
  na 1–2★ bez itemów, więc wygląda fatalnie. **Największa luka silnika: nie modeluje gwiazdek** — liczy Camille po
  5.55 i nigdy nie zaproponuje rerollu Camille. Reroll 1–2 costów do 3★ to plan (osiągalny wg puli i szans sklepu),
  nie fart jak 3★ 4/5-costów.
- Rodzina Azir/Rammus/Soraka/Teemo/Veigar/Zyra/Fiddlesticks/Lux: 11 gier top 200 ze średnią 1.55 — ten sam układ
  `discover` oznaczył jako "rising" w Master+ (40 gier, 1.55). Dwa niezależne źródła.
- Pojedyncze plansze top 200 vs model: ρ 0.27 — jedna gra to szum (miejsce 1–8); agregaty z explorera dają 0.55–0.6.
- Kolumna "Master+" przy planszach top 200 to tylko pokrycie naszego zbioru `oracle` (sąsiedztwa meta + wyniki
  silnika), nie "nikt tego nie gra".

## Dane

**Zasada:** MetaTFT to nieoficjalne API współdzielone z ich stroną — za dużo zapytań = ban. Wszystkie narzędzia
CLI idą przez `scripts/scout-cli/metatft-http.ts`: kopia każdej odpowiedzi w `tmp/metatft-cache` (pełne mecze na
zawsze, zapytania o patch 7 dni, drabinka/profile 1 dzień), jedno zapytanie na 2 s, bezpiecznik 1000 zapytań na
uruchomienie i 3000 na dzień; po przekroczeniu narzędzie zapisuje postęp i kończy. Pełny `oracle` (~650 zapytań)
trwa ~22 minuty zamiast iść jedną serią. `top-games` domyślnie bierze tylko własne plansze graczy z profilu (1 zapytanie na gracza); pełne lobby
(`--lobbies`, 1 zapytanie na mecz) tylko gdy potrzebne. W aplikacji dane mają być naszą kopią w DB odświeżaną
przyrostowo w syncu (to, co już mamy, nie jest pobierane ponownie); przeglądarka nigdy nie pyta MetaTFT.

- `scout oracle --rank MASTER,GRANDMASTER,CHALLENGER --min-games 10` → `tmp/scout-eval/oracle-18.4b-master.json`
  (5.6k plansz z ≥10 grami, mediana 34). Explorer: `unit_tier_numitems_unique={api}-{kopia}_{gwiazdki}_{itemy}`.
- MetaTFT trzyma starsze patche: w oknie `days=20` są 18.3b (21.9M gier), 18.4 (3.4M), 18.4b (44M; okno 2-dniowe
  to 6.2M). Przy przypiętym patchu dłuższe okno = 5–7× więcej danych bez mieszania patchy.
- `scout top-games`: pełne plansze top N graczy drabinki (jednostki, gwiazdki, itemy, poziom, traity, miejsce,
  wersja gry) dla całych lobby; zapisuje tylko plansze, bez puuid/nicków. Domyślnie przez MetaTFT, bez klucza:
  `api.metatft.com/tft-leaderboard/v2/global` (top 1000 wg LP ze wszystkich regionów; `/v2/pro` = zawodowcy),
  `/public/profile/lookup_by_puuid/{region}/{puuid}` (ostatnie 40 meczów, ~10 dni — profile nie są odświeżane na
  bieżąco), pełny mecz pod `match_data_url` w formacie match-v1 Riotu. `--source riot` = to samo z API Riotu
  (`RIOT_API_KEY`).

## Następne kroki

1. **Test wsteczny między patchami**: perełki znalezione na 18.3b → wynik i popularność na 18.4b.
2. **Integracja w aplikacji**: tryb "Odkrywanie" z etykietami i liczbą dowodów. Decyzja o źródle danych dla
   produkcji: MetaTFT (explorer ~1.3k zapytań + drabinka/profile/mecze top graczy; API nieoficjalne) vs Riot API
   (oficjalne, klucz).
3. **Gwiazdki i plany w silniku** (największa luka): siła jednostki zależna od planu — 1–2 costy jako 3★ reroll
   carry z itemami (dane: jednostka × gwiazdki × itemy, `tmp/scout-eval/unit-star-items-18.4b.json`), szansa
   trafienia 3★ z puli i szans sklepu na danym poziomie; 3★ tylko dla 1–3 costów.
4. **Potencjał jednostek** ("źle budowane"): jak top gracze je budują (itemy, gwiazdki, z kim) — pokazywać w UI.
5. **Okno całego patcha** w syncu (więcej danych dla małych prób).
