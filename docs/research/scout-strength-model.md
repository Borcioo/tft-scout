# Scout — model siły planszy (engine v2)

**Status:** 2026-10-21, MetaTFT 18.4b (Gold+, 2 dni), snapshot `tmp/scout-eval/context-18.4b.json`, wyrocznia
`tmp/scout-eval/oracle-18.4b.json`. Kod: `resources/js/workers/scout/strength.ts`, `scorer.ts`, `polish.ts`,
ewaluacja `scripts/scout-cli/commands/eval.ts` + `eval-oracle.ts`, dane `scripts/scout-cli/commands/oracle.ts`.

## Zasada

Silnik nie kopiuje meta. Wszystkie liczby z MetaTFT to "średnie miejsce plansz, które miały X" (jednostka, para
jednostek, poziom traitu u jednostki); model je tylko składa. Meta compy (`comps_data`) służą wyłącznie jako
**zbiór testowy** (`scout eval`) i do odznaki "Meta" w UI — nigdy jako cel ani punktacja za podobieństwo.

## Model

Dla każdej jednostki `i` na planszy (wszystko z shrinkage empirical Bayes: jednostka 500 pseudo-gier do 4.5,
lift 100 pseudo-gier do 0):

| Składnik | Źródło | Znaczenie |
|---|---|---|
| `base_i` | `unitRatings` | średnie miejsce plansz z `i` |
| `lift_ij` | `companions` | miejsce `i` na planszach z `j` − średnia `i` |
| `lift_ikb` | `affinity` | miejsce `i` przy traicie `k` na poziomie `b` − średnia `i` |
| `lift_ik0` | `unitRatings` − Σ `affinity` | `i` z **nieaktywnym** własnym traitem `k` (np. Murkwolf bez Ravagera 5.26 vs 4.27) |

`est_i = base_i + 5 · mean_j lift_ij + 1 · mean(lift_ikb aktywnych, lift_ik0 nieaktywnych własnych)`,
plansza = średnia `est_i` (średnia, więc rozmiar planszy jej nie pompuje). Do tego kary w tej samej jednostce:
balans ról (`roleBalancePenalty`) i jednostki ponad realną podaż sklepu na danym poziomie (`costPenalty`, ten sam
prior co w team-builderze, więc wyszukiwanie i ranking optymalizują jedno). `score = (4.5 − place) · 100`.

- **Rival** ma breakpointy `[1, 1, 2]`; aktywny poziom to pierwszy z równych progów (pozycja 1 = 800k gier).
- **Kha'Zix**: Rival w `unscoredTraits` — widoczny, ale nie daje liftu (tylko u Rengara).
- **Waga par 5** wybrana 10-fold CV na meta compach; **waga traitów 1** to decyzja produktowa (CV wybrałoby 0,
  koszt ~0.05 Spearmana), bo bez niej breakpointy, emblematy i ewolucje Kha'Zixa nie miałyby znaczenia.
  Obie potwierdzone na 3.9k granych planszach (niżej): regresja daje pary 6.3× i traity 1.4× jednostek.

### Skala: surowe miejsce ≠ miejsce

Lifty się nakładają (lift pary zawiera już resztę jej typowej planszy), więc waga 5 rozciąga plansze ~2×
szerzej niż realne średnie granych plansz, a najlepsze plansze z wyszukiwania wychodzą poniżej 1. Surowe `place`
tylko **rankuje**. Do pokazania jest `breakdown.avgPlace` = `clamp(a[rozmiar] + 0.51 · raw, 1.5, 8)`, a = 1.34 /
1.21 / 0.77 dla 7 / 8 / 9 jednostek (`STRENGTH.calibration`): ważona liczbą gier regresja realnego średniego
miejsca 3.9k plansz granych ≥300 razy na surowym miejscu. Liniowa w całym zakresie (10% najlepiej ocenionych:
przewidywane 2.39, realne 2.41). Większa plansza przy tym samym surowym miejscu kończy wyżej (dojście do lvl 9 to
już oznaka wygrywania). Podłoga 1.5 = najlepsza realna średnia z tych plansz; wyszukiwanie na lvl 9 dochodzi do
surowego ~0.8, gdy żadna grana plansza nie zeszła poniżej 1.28, więc szacunek nie ekstrapoluje dalej.
`scout eval` drukuje bieżące dopasowanie; przy zmianie patcha/danych sprawdzić dryf i przestawić stałe.

## Wyszukiwanie

Fazy synergy-graph generują kandydatów jak dotąd (quick-score liczy ten sam model). Potem `polishTeam`:
best-improvement, zamiana jednej jednostki na najlepszą legalną (bramka poziomu, limit 5-costów, trait locki,
role, grupy wykluczeń, ten sam `slotsUsed`), do 4 rund. Polerowanie dzieje się **w trakcie wyboru slate'u**:
po kolei od najlepszych, zamiany prowadzące do duplikatu (≥ 75% wspólnego rdzenia) już przyjętej planszy są
zabronione. Wcześniejsze polerowanie przed dedupe zbiegało sąsiednie plansze do jednego optimum, dedupe je
wyrzucał, a lukę wypełniały niepolerowane — 8/10 wyników dało się poprawić jedną zamianą.

## Wyniki (`npm run scout -- eval`, 18.4b)

| Metryka | Stary scorer (punkty) | v2 |
|---|---|---|
| Spearman vs realne miejsce 60 meta compów | 0.03 | 0.49 [0.30, 0.66] |
| Lvl 8: wyniki poprawialne 1 zamianą | — | 1/10 (+0.2 pkt) |
| Lvl 9: wyniki poprawialne 1 zamianą | — | 0/10 |
| Czas lvl 8 / lvl 9 (ten sam kontener) | 4.3 s / 7.2 s | 2.3 s / 3.6 s |
| Czas lock Vanguard 6 (lvl 10) / Coven 5 + emblemat (lvl 9) | 2.3 s / 5.6 s | 1.6 s / 4.0 s |
| Wyników w slate (Vanguard 6 / Coven 5, topN 30) | 27 / 15 | 30 / 22 |
| Martwe jednostki / plansza (lvl 8 / 9) | — | 0.50 / 0.30 (meta compy: 0.02) |
| Traity o 1 od progu / plansza (lvl 8 / 9) | — | 2.83 / 1.83 (meta compy: 1.63) |
| Udział wyników = meta comp | — | 10% / 7% |

## Weryfikacja na granych planszach (`scout oracle`)

Explorer MetaTFT odpowiada na "plansze zawierające te jednostki → histogram miejsc", a `/units_unique` z takim
filtrem zwraca **każde dopełnienie** z własnym histogramem. Jedno zapytanie o planszę bez jednej jednostki = realny
wynik tej planszy i każdej granej alternatywy na brakujący slot. `scout oracle` pyta tak o 60 meta compów i 20
wyników silnika (644 zapytania, raz, wznawialne) → 11.5k plansz z ≥30 grami, z tego 3.9k z ≥300. To zbiór
testowy i treningowy, nigdy wejście silnika.

| Metryka (`scout eval`, plansze ≥300 gier) | Wynik |
|---|---|
| Spearman model vs realne miejsce, 3.9k plansz | 0.61 |
| "Którą jednostkę dodać" (248 grup): Spearman w grupie | 0.60 |
| Strata wyboru modelu vs najlepsze dopełnienie | 0.10 miejsca (losowo 0.62, same jednostki bez synergii 0.28) |
| Trafienie najlepszego dopełnienia | 54% |
| Wagi na odłożonych planszach (5-fold po planszy źródłowej) | obecne 5/1 ≥ dopasowane; zmiana w granicach szumu |
| Plansze silnika grane jako całość / z graną planszą o 1 jednostkę obok | 1 / 3 z 20 (wszystkie na lvl 8) |
| Te 3: przewidywane → realne średnie miejsce sąsiadów | 2.38 → 1.97, 2.37 → 2.38, 2.59 → 2.54 |

Wnioski:
- **Struktura i wagi trzymają się na danych spoza meta compów.** Strojenie wag, priorów (ilość gier jest tak duża,
  że priory nic nie zmieniają) i kary za nieaktywny trait rusza metryki o ±0.01.
- **Reszty** (realne − przewidywane): drogie plansze (3+ 5-costy −0.47, suma kosztów 35+ −0.57) i 9-jednostkowe
  (−0.48) kończą lepiej niż model przewiduje; plansze z 1–2 "martwymi" jednostkami też (−0.22 / −0.29). To w dużej
  mierze **przeżywalność**: końcowe plansze zwycięzców są bogatsze, więc nie jest to sygnał do wbudowania w ranking
  (silnik porównuje plansze na tym samym poziomie). Rozmiar planszy siedzi w kalibracji.
- **Kara za koszt jest neutralna** dla rankingu granych plansz (limity tanich kosztów: 0.605 → 0.610). Pozorna
  poprawa po jej wyłączeniu to artefakt: obserwacja "zawiera 8 jednostek" obejmuje plansze z poziomu 9, a ocena
  liczyła je jako poziom 8, więc limit 5-costów karał je niesłusznie. W silniku limit 5-costów pokrywa się z twardą
  bramką poziomu.
- **Brak przekleństwa optymalizatora w zakresie danych**: kalibracja liniowa także w górnym decylu, a plansze
  silnika mają pokrycie parami (średni log10 gier pary 4.99) w zakresie granych plansz (4.66–5.70). Dla plansz o
  słabszym pokryciu model jest raczej zbyt pesymistyczny (−0.23). Plansze lvl 9 silnika są jednak poza zakresem
  surowego miejsca czegokolwiek granego — tego dane nie potwierdzą, dopóki ktoś ich nie zagra.
- **"Najczęściej grane dopełnienie" to zła miara**: strata 1.15 (gorzej niż losowo), bo standardowe plansze grają
  wszyscy, a nietypowe dodatki (np. 5-cost) wybiera się z mocnej pozycji. Ta sama przeżywalność co wyżej.

### Czy da się to policzyć ze statystyk gry?

Pomysł: siła = f(HP, pancerz, AD, AS, skalowanie gwiazdek, bonusy traitów), np. prawo kwadratowe Lanchestera
(siła drużyny ∝ ΣDPS · ΣEHP). Sprawdzone 2026-10-21:
- **Set 18 nie publikuje liczb umiejętności**: spelle w binach CDragon mają tylko `DataValue`/`OtherValue`
  (Kayle `[0,1,2,10,160,200,240]`), obliczenia są zahashowane (`{d678dbfb}`). Bez spelli DPS casterów jest nieznany.
- **Statystyki bazowe nie przewidują siły jednostki** poza kosztem: w obrębie kosztu korelacja "moc statystyk vs
  średnie miejsce" jest zerowa albo odwrotna (1-costy: +0.56, n=14) — Riot balansuje statystyki *przeciw*
  umiejętnościom (tank: dużo HP, słaby spell). Koszt sam daje −0.60.
- Bonusy traitów są nazwanymi wartościami (`AttackSpeed`, `MaxHealthShield`, `CritChance`…), ale większość to
  warunkowe mechaniki — bez spelli i itemów nie złożą się w siłę planszy.
- To, co się da policzyć matematycznie, to **gwiazdki i sklep**: explorer w jednym zapytaniu daje jednostka ×
  gwiazdki × liczba itemów (`tmp/scout-eval/unit-star-items-18.4b.json`, 2.2k wierszy), np. Soraka 1★ 4.87 → 2★ 3.51,
  Azir 3★ z 3 itemami 3.08 vs 2★ 5.13. Z szansami sklepu i rozmiarem puli daje to wartość oczekiwaną planszy
  z uwzględnieniem szansy trafienia — następny krok.

## Znane słabości / następne kroki

- **Martwe jednostki** częstsze niż na meta compach (Kayle, Karma, Teemo bez aktywnego traitu, bo ich lifty par
  są silne). Meta compy to centroidy klastrów, więc 0.02 zaniża realne plansze; nie karać na siłę bez danych.
- **Plansze silnika są nowe**: 17/20 nie ma żadnej granej planszy w odległości jednej jednostki, lvl 9 żadna.
  Gdzie da się sprawdzić, trafiają w realne 2.0–2.5; reszta to ekstrapolacja modelu par.
- **Gwiazdki i prawdopodobieństwo trafienia** (szanse sklepu, pula, 3★ w reroll compach) i **itemy / carry**
  (`item_detail`, `unit_builds`, dane jednostka × gwiazdki × itemy) — jeszcze nie w modelu.
