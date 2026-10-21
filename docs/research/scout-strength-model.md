# Scout — model siły planszy (engine v2)

**Status:** 2026-10-21, MetaTFT 18.4b (Gold+, 2 dni), snapshot `tmp/scout-eval/context-18.4b.json`.
Kod: `resources/js/workers/scout/strength.ts`, `scorer.ts`, `polish.ts`, ewaluacja `scripts/scout-cli/commands/eval.ts`.

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

### Skala: surowe miejsce ≠ miejsce

Lifty się nakładają (lift pary zawiera już resztę jej typowej planszy), więc waga 5 rozciąga plansze ~4×
szerzej niż realne średnie: na meta compach model 1.56–5.24, real 4.14–6.29; najlepsze plansze z wyszukiwania
wychodzą poniżej 1. Surowe `place` tylko **rankuje**. Do pokazania jest `breakdown.avgPlace` =
`clamp(3.83 + 0.25 · raw, 1, 8)` — regresja liniowa real ~ raw na meta compach (`STRENGTH.calibration`).
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

## Znane słabości / następne kroki

- **Martwe jednostki** częstsze niż na meta compach (Kayle, Karma, Teemo bez aktywnego traitu, bo ich lifty par
  są silne). Meta compy to centroidy klastrów, więc 0.02 zaniża realne plansze; nie karać na siłę bez danych.
- **Liniowa kalibracja** z 60 punktów i ekstrapolacja poza zakres meta compów — `avgPlace` najlepszych plansz to
  oszacowanie, nie obietnica.
- **Itemy / carry** (`item_detail`, `unit_builds`) i **prawdopodobieństwo trafienia** (ekonomia, pula sklepu) —
  jeszcze nie w modelu.
