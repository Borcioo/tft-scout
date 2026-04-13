# Hard filter cost→minLevel dla generowania teamów

**Data:** 2026-04-09
**Status:** Zatwierdzony do implementacji

## Problem

Obecny generator używa `SHOP_ODDS` w `costPenalty()` (`client/src/algorithm/synergy-graph.js:274`) jako **miękką karę** za spamowanie wysokokosztowych championów na niskich leveli. Kara nie jest wystarczająca — algorytm nadal generuje teamy z 4-costami na lvl 5 (2% szans na drop) mimo że w grze praktycznie niemożliwe jest ich zebranie.

Dodatkowo miękka kara marnuje budżet iteracji — algorytm generuje „śmieciowe" teamy które są potem odrzucane w rankingu, zamiast skupić się na realistycznych kompozycjach.

## Cele

1. **Hard filter** — champion danego kosztu nie może pojawić się w teamie jeśli gracz nie jest na wystarczającym poziomie.
2. **Locked champi bypass'ują regułę** — jeśli gracz zalockuje wysokokosztową postać (bo trafił fartem), zostaje w teamie i algorytm optymalizuje pozostałe sloty POD nią.
3. **Optymalizacja iteracji** — nie marnujemy budżetu generowania na teamy które i tak zostaną odfiltrowane. Fazy które nie mogą wygenerować legalnych teamów są pomijane.
4. **`costPenalty` zostaje** — jako drugorzędna ochrona przed spamem już-dozwolonych wysokokosztowych jednostek (np. 6 × 4-cost na lvl 8).

Cel pozanakresowy: refactor `expectedStarPower` / fallback scoringu — to osobny dług architektoniczny.

## Reguła cost→minLevel

Nowa stała w `client/src/algorithm/config.js`:

```js
// Minimalny poziom gracza dla każdego kosztu championa.
// Progi oparte na SHOP_ODDS — champion jest dozwolony gdy realna
// szansa na zaciągnięcie w sklepie wynosi ≥10%.
export const MIN_LEVEL_BY_COST = {
  1: 1,
  2: 3,
  3: 4,
  4: 7,
  5: 9,
};
```

| Cost | Min lvl | Szansa w sklepie na tym lvl |
|------|---------|-----------------------------|
| 1    | 1       | 100%                        |
| 2    | 3       | 25%                         |
| 3    | 4       | 15%                         |
| 4    | 7       | 10%                         |
| 5    | 9       | 15%                         |

Zasada jako funkcja:
```js
isCostAllowed(cost, level) => level >= MIN_LEVEL_BY_COST[cost]
```

Locked championi zawsze są dozwoleni, niezależnie od swojego kosztu.

## Architektura — prefilter pool na wejściu

Zamiast filtrować per-miejsce, budujemy zbiór `allowedSet` **raz** na początku `runAlgorithm` w `synergy-graph.js:731`. Wszystkie fazy operują na tym zbiorze.

### Nowa funkcja — `buildAllowedSet`

```js
// client/src/algorithm/synergy-graph.js
import { MIN_LEVEL_BY_COST } from './config.js';

function buildAllowedSet(graph, level, lockedChamps) {
  // Brak level → wszystko dozwolone (kompatybilność wsteczna).
  if (!level) return new Set(Object.keys(graph.nodes));

  const allowed = new Set(lockedChamps);  // locked ZAWSZE dozwolone
  for (const [api, node] of Object.entries(graph.nodes)) {
    const cost = node.cost || 1;
    const minLvl = MIN_LEVEL_BY_COST[cost];
    if (minLvl != null && level >= minLvl) allowed.add(api);
  }
  return allowed;
}
```

### Propagacja przez context

`allowedSet` dołączony do obiektu `context` przekazywanego do wszystkich faz przez `phaseCtx`. W `runAlgorithm`:

```js
const allowedSet = buildAllowedSet(graph, level, lockedChamps);
const context = { ..., allowedSet, lockedSet: new Set(lockedChamps) };
```

`lockedSet` dołączony osobno, żeby `costPenalty` i `buildOneTeam` mogły łatwo sprawdzać „czy to locked".

## Zmiany per-faza

Każda z 7 faz eksploracji wymaga targetowanej zmiany. Wszystko w `client/src/algorithm/synergy-graph.js`.

### `buildOneTeam` (linie 324-413) — główna pętla growth

Obecnie filtruje tylko `used`, `seen`, `excludedSet`, oraz hard-filter 5-costów (`atFiveCostLimit`). Zastępujemy `atFiveCostLimit` ogólnym sprawdzeniem `allowedSet`.

**Neighbors loop (linia 362):**
```js
for (const edge of (adjacency[member] || [])) {
  if (used.has(edge.champ) || seen.has(edge.champ) || excludedSet.has(edge.champ)) continue;
  if (!context.allowedSet.has(edge.champ)) continue;  // ← NOWE
  // ... reszta bez zmian
}
```

**Fill loop (linia 374):**
```js
if (candidates.length < 15) {
  for (const api of Object.keys(nodes)) {
    if (used.has(api) || seen.has(api) || excludedSet.has(api)) continue;
    if (!context.allowedSet.has(api)) continue;  // ← NOWE
    // ... reszta bez zmian
  }
}
```

Stary `max5Cost` / `atFiveCostLimit` pozostaje jako dodatkowa kontrola limitu 5-costów (osobna semantyka — „max N piątek w teamie nawet gdy dozwolone").

### `phaseTemperatureSweep` (linia 420)

Bez zmian. Deleguje do `buildOneTeam`, które filtruje.

### `phaseTraitSeeded` (linia 429)

Filtruje listę członków traitu przed wyborem seedów:
```js
const members = traitMap[trait.apiName] || [];
const available = members.filter(api => context.allowedSet.has(api) && !excludedSet.has(api));
if (available.length < 2) continue;  // skip trait
```

### `phaseDeepVertical` (linia 448)

Filtruje trait members, jeśli po filtrze nie starcza członków do pierwszego breakpointa → skip:
```js
const members = (traitMap[trait.apiName] || []).filter(api => context.allowedSet.has(api));
if (members.length < bps[0]) continue;  // nie dojedzie do breakpointa
```

### `phasePairSynergy` (linia 494)

Oba traity filtrowane:
```js
const m1 = (traitMap[t1.apiName] || []).filter(api => context.allowedSet.has(api));
const m2 = (traitMap[t2.apiName] || []).filter(api => context.allowedSet.has(api));
if (m1.length < 2 || m2.length < 2) continue;
```

### `phaseCompanionSeeded` (linia 526)

Seedy filtrowane:
```js
const filteredSeeds = seeds.filter(api => context.allowedSet.has(api));
if (filteredSeeds.length < 2) continue;
addResult(buildOneTeam(graph, teamSize, filteredSeeds, context, ...));
```

### `phaseCrossover` (linia 549)

Geny (championi z top teamów) filtrowane:
```js
const childGenes = [...].filter(api => context.allowedSet.has(api));
```

### `phaseMetaCompSeeded` (linia 653) — TWARDE CIĘCIE

Meta compy to całościowe archetypy — okrojony seed (np. bez kluczowych 4-costów) zniszczyłby sens. Więc: jeśli jakikolwiek champion meta compa jest poza `allowedSet` (i nie locked), pomijamy cały comp.

```js
for (const metaComp of metaComps) {
  const hasDisallowed = metaComp.champions.some(api =>
    !context.allowedSet.has(api)
  );
  if (hasDisallowed) continue;  // skip cały comp
  // ... reszta bez zmian
}
```

## Zmiany w `costPenalty`

`costPenalty` zostaje, ale z dwiema modyfikacjami:

1. **Locked champi wykluczeni z liczenia kary** — sacred, algorytm nie powinien ich karać.
2. **`teamSize` do wyliczenia limitów bazuje tylko na non-locked slotach** — żeby budżet kosztów był sensowny gdy kilka slotów jest już zajętych przez locked.

```js
function costPenalty(champApis, graph, level, lockedSet = new Set()) {
  if (!level) return 0;
  const odds = SHOP_ODDS[level] || SHOP_ODDS[8];
  const nonLocked = champApis.filter(api => !lockedSet.has(api));
  const teamSize = nonLocked.length;  // ← budżet bez locked

  const limits = odds.map(o => {
    if (o === 0) return 0;
    if (o <= 0.05) return 1;
    if (o <= 0.15) return 2;
    return Math.ceil(o * teamSize) + 1;
  });

  const costCounts = [0, 0, 0, 0, 0];
  for (const api of nonLocked) {  // ← tylko non-locked
    const cost = graph.nodes[api]?.cost || 3;
    if (cost >= 1 && cost <= 5) costCounts[cost - 1]++;
  }

  let penalty = 0;
  for (let i = 0; i < 5; i++) {
    const excess = costCounts[i] - limits[i];
    if (excess > 0) penalty += excess * 12;
  }
  return penalty;
}
```

Wywołania w `buildOneTeam` (linie 368, 380) muszą przekazywać `context.lockedSet`:
```js
const score = quickScore(testTeam, graph, emblems) - costPenalty(testTeam, graph, context.level, context.lockedSet);
```

## Co zostaje niezmienione

- `client/src/algorithm/scorer.js` — nie ruszamy. `expectedStarPower` to osobny architektoniczny dług (zanotowany w memory `project_fallback_scoring_debt.md`).
- `client/src/algorithm/engine.js` — `runEngine` nie wymaga zmian, filtry są wewnątrz `runAlgorithm` w synergy-graph.
- `SHOP_ODDS` stała w `synergy-graph.js:261` — zostaje bez zmian, nadal źródło prawdy dla `costPenalty`.
- `MIN_LEVEL_BY_COST` jest wyliczona ręcznie z `SHOP_ODDS` (nie derivowana) — ewentualna automatyzacja to osobny temat.

## Kompatybilność wsteczna

- Wywołania `runAlgorithm` bez `level` → `buildAllowedSet` zwraca pełny zbiór węzłów, stare zachowanie zachowane.
- Stary parametr `max5Cost` pozostaje jako niezależna kontrola limitu 5-costów (używany gdy gracz chce ręcznie ograniczyć liczbę legendarych nawet na lvl 9+).

## Testowanie

Nie ma obecnie testów jednostkowych dla `synergy-graph.js`. Plan weryfikacji ręcznej:

1. **Lvl 5, bez lock** — wygeneruj 20 teamów, sprawdź że żaden nie zawiera 4- ani 5-costów.
2. **Lvl 5, lock 1 × 4-cost** — wygeneruj 20 teamów, sprawdź że wszystkie zawierają lockowanego championa, reszta składu to 1-3 costy.
3. **Lvl 5, lock 1 × 5-cost** — analogicznie.
4. **Lvl 6 vs lvl 7** — porównaj generacje, na lvl 7 powinny pojawić się 4-costy, na lvl 6 nie.
5. **Lvl 9** — 5-costy powinny się pojawiać.
6. **Bez level (API legacy)** — powinno działać jak przed zmianą.
7. **Meta comp z 5-costem na lvl 6** — cały comp pomijany, brak seeda z tego archetypu.
8. **Performance** — porównaj czas generacji dla lvl 5, powinien być równy lub szybszy (mniej odrzucania).

## Otwarte pytania / follow-upy

- Rewizja `expectedStarPower` / fallback scoringu — osobny brainstorm (patrz memory).
- Automatyczne wyliczanie `MIN_LEVEL_BY_COST` z `SHOP_ODDS` (np. pierwszy lvl gdzie odds ≥ threshold) — drobna poprawa, niski priorytet.
- Dodanie testów jednostkowych dla fazy prefilter + filter — gdy pojawi się infrastruktura testowa dla client/.
